import * as readline from 'node:readline';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  getBranchCommits,
  getChangedLinesForFiles,
  getDiffStats,
  getFileDiff,
  getGitContext,
  getRepoRoot,
  listTrackedFiles,
  readFileAtRef,
} from '../core/git.js';
import {
  exportManifestDraft,
  loadAtlasManifestResult,
  switchRepoStorageMode,
  verifyManifest,
} from '../core/manifest.js';
import { analyzeRepositoryArchitecture } from '../core/indexer.js';
import { enrichArchitectureWithWorkspace, scanScopeExternalEdges } from '../core/workspace.js';
import {
  buildAstOutlineForFiles,
  CuratedFileSymbols,
  extractCuratedSymbolsForFiles,
} from '../core/astAnalyzer.js';
import { AtlasGraphData, buildAtlasGraph, CanvasViewMode } from '../core/graph.js';
import { verifyBriefing } from '../core/verifier.js';
import {
  ackDirective,
  claimDirective,
  clearAllDirectives,
  createDirective,
  deleteDirective,
  listDirectives,
  listStoredBriefings,
  loadAllOutlines,
  loadLatestBriefingRecord,
  loadRepoConfig,
  saveBriefingRecord,
  saveOutlineRecord,
  StoredBriefingRecord,
  verifyOutline,
} from '../core/store.js';
import {
  AnnotationDirective,
  BriefingReport,
  BriefingVerificationResult,
  EvidenceAnchor,
  ManifestDriftIssue,
  ModuleOutlineReport,
  StorageMode,
} from '../core/types.js';
import {
  discoverCandidateRepos,
  DiscoveredRepoItem,
  listDirectoryEntries,
  openNativeFolderDialog,
} from '../core/repoPicker.js';
import { getCanvasHtml } from '../webview/canvasHtml.js';

export const APP_URI = 'ui://codeatlas/app.html';
const MAX_TOOL_RESULT_BYTES = 900_000; // Strictly under Antigravity's 1 MiB trajectory cap
const MAX_DIFF_TEXT_BYTES = 200_000;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface DiscoveredBriefing {
  label: string;
  path: string;
  isExample?: boolean;
}

interface RepoUiSession {
  mode: CanvasViewMode;
  baseRef: string;
  scopeRoot: string;
  expandedDomainIds: Set<string>;
  expandedFolderIds: Set<string>;
  expandedFilePaths: Set<string>;
  pruneUnchanged: boolean;
  showSupportAssets: boolean;
  activeBriefingPath: string;
  userSelectedBriefing: boolean;
  lang: 'zh' | 'en';
}

interface ToolCallResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const cliRepoArgIdx = process.argv.indexOf('--repo');
const defaultCliRepo = cliRepoArgIdx >= 0 ? process.argv[cliRepoArgIdx + 1] : undefined;

const sessionsByRepo = new Map<string, RepoUiSession>();
let lastActiveRepoRoot = '';
const recentRepoRoots: string[] = [];
let globalFallbackMode: CanvasViewMode = 'hybrid';
let globalFallbackLang: 'zh' | 'en' = 'zh';

function recordRecentRepo(repoRoot: string): void {
  const clean = path.resolve(repoRoot);
  const existingIdx = recentRepoRoots.findIndex((p) =>
    process.platform === 'win32'
      ? p.toLowerCase() === clean.toLowerCase()
      : p === clean
  );
  if (existingIdx >= 0) recentRepoRoots.splice(existingIdx, 1);
  recentRepoRoots.unshift(clean);
  if (recentRepoRoots.length > 15) recentRepoRoots.length = 15;
}

function getSession(repoRoot: string): RepoUiSession {
  const key = path.normalize(repoRoot);
  let session = sessionsByRepo.get(key);
  if (!session) {
    session = {
      mode: globalFallbackMode,
      baseRef: '',
      scopeRoot: '',
      expandedDomainIds: new Set<string>(),
      expandedFolderIds: new Set<string>(),
      expandedFilePaths: new Set<string>(),
      pruneUnchanged: false,
      showSupportAssets: false,
      activeBriefingPath: '',
      userSelectedBriefing: false,
      lang: globalFallbackLang,
    };
    sessionsByRepo.set(key, session);
  }
  return session;
}

function writeResponse(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function sendResult(id: string | number | null, result: unknown): void {
  writeResponse({ jsonrpc: '2.0', id, result });
}

function sendError(id: string | number | null, code: number, message: string): void {
  writeResponse({ jsonrpc: '2.0', id, error: { code, message } });
}

async function tryGetRepoRoot(candidate?: string): Promise<string | undefined> {
  if (!candidate || !candidate.trim()) return undefined;
  try {
    return await getRepoRoot(candidate.trim());
  } catch {
    return undefined;
  }
}

async function resolveOptionalRepoForUi(worktreePath?: unknown): Promise<{
  repoRoot?: string;
  attemptedPath?: string;
  error?: string;
}> {
  if (typeof worktreePath === 'string' && worktreePath.trim()) {
    const raw = worktreePath.trim();
    try {
      const repoRoot = await getRepoRoot(raw);
      lastActiveRepoRoot = repoRoot;
      return { repoRoot };
    } catch (err: unknown) {
      return {
        attemptedPath: raw,
        error: `无法打开 Git 仓库 "${raw}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const fallbackCandidates = [lastActiveRepoRoot, defaultCliRepo, process.cwd()].filter(
    (c): c is string => Boolean(c && c.trim())
  );
  for (const cand of fallbackCandidates) {
    const resolved = await tryGetRepoRoot(cand);
    if (resolved) {
      lastActiveRepoRoot = resolved;
      return { repoRoot: resolved };
    }
  }

  return {};
}

async function resolveTargetRepo(worktreePath?: unknown): Promise<string> {
  const explicit =
    typeof worktreePath === 'string' && worktreePath.trim() ? worktreePath.trim() : undefined;
  if (explicit) {
    const root = await getRepoRoot(explicit);
    lastActiveRepoRoot = root;
    return root;
  }
  if (defaultCliRepo) {
    const root = await getRepoRoot(defaultCliRepo);
    lastActiveRepoRoot = root;
    return root;
  }
  if (lastActiveRepoRoot) {
    const root = await tryGetRepoRoot(lastActiveRepoRoot);
    if (root) return root;
  }
  const cwdRoot = await tryGetRepoRoot(process.cwd());
  if (cwdRoot) {
    lastActiveRepoRoot = cwdRoot;
    return cwdRoot;
  }
  throw new Error(
    'Missing required parameter "worktreePath" (or start MCP server with --repo <path>).'
  );
}

async function isValidBriefingFile(filePath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BriefingReport & StoredBriefingRecord>;
    const target = parsed?.briefing ?? parsed;
    return (
      (target?.schemaVersion === '0.1' || target?.schemaVersion === '0.2') &&
      Array.isArray(target?.claims)
    );
  } catch {
    return false;
  }
}

async function discoverBriefings(repoRoot: string): Promise<DiscoveredBriefing[]> {
  const candidates: DiscoveredBriefing[] = [];
  const stored = await listStoredBriefings(repoRoot);
  candidates.push(...stored);

  const examplesDir = path.join(repoRoot, 'examples');
  try {
    const entries = await fs.readdir(examplesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        const fullPath = path.join(examplesDir, entry.name);
        if (await isValidBriefingFile(fullPath)) {
          const rel = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
          candidates.push({ label: rel, path: fullPath, isExample: true });
        }
      }
    }
  } catch {
    // ignore missing examples dir
  }

  const rootBriefing = path.join(repoRoot, 'briefing.json');
  if (await isValidBriefingFile(rootBriefing)) {
    candidates.unshift({ label: 'briefing.json', path: rootBriefing });
  }
  return candidates;
}

async function loadBriefingAndVerification(
  repoRoot: string,
  filePath: string
): Promise<{ briefing?: BriefingReport; verification?: BriefingVerificationResult }> {
  if (!filePath) return {};
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BriefingReport & StoredBriefingRecord>;
    const briefing = (parsed.briefing ?? parsed) as BriefingReport;
    if (!briefing || !Array.isArray(briefing.claims)) return {};
    const verification = await verifyBriefing(repoRoot, briefing, filePath);
    return { briefing, verification };
  } catch {
    return {};
  }
}

async function loadVerificationForPath(
  repoRoot: string,
  filePath: string
): Promise<BriefingVerificationResult | undefined> {
  const res = await loadBriefingAndVerification(repoRoot, filePath);
  return res.verification;
}

function buildEmptyCanvasPayload(params: {
  mode: CanvasViewMode;
  lang: 'zh' | 'en';
  worktreePath: string;
  discoveredRepos?: DiscoveredRepoItem[];
  error?: string;
}): Record<string, unknown> {
  const { mode, lang, worktreePath, discoveredRepos = [] } = params;
  const defaultPrompt =
    lang === 'zh'
      ? '请点击左上角仓库胶囊直接选择本地仓库 / 文件夹，或输入 Git 仓库路径。'
      : 'Click the repository pill in the top bar to select a local folder or Git repository.';
  return {
    git: null,
    baseRef: 'HEAD',
    graph: {
      mode,
      nodes: [],
      edges: [],
      architecture: null,
      branchSummary: null,
      summary: {
        verified: 0,
        mismatch: 0,
        stale: 0,
        unverified: 0,
        unknown: 0,
        blockingCount: 0,
        blockingMismatch: 0,
        changedFiles: 0,
        directiveCount: 0,
        isStale: false,
        baseRef: 'HEAD',
        signals: [],
        blindSpots: [],
        guardrails: [],
        hasBriefing: false,
        prunedCount: 0,
        impactCount: 0,
        manifestIssues: [],
        hiddenSupportDomains: 0,
        hiddenSupportFiles: 0,
      },
    },
    availableBriefings: [],
    activeBriefingPath: '',
    discoveredRepos,
    pruneUnchanged: false,
    showSupportAssets: false,
    lang,
    worktreePath,
    error: params.error || defaultPrompt,
  };
}

function collectAnchoredLinesByFile(
  verification: BriefingVerificationResult | undefined,
  directives: AnnotationDirective[]
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  const mark = (rawPath?: string, line?: number) => {
    if (!rawPath || !line || line < 1) return;
    const clean = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    let set = map.get(clean);
    if (!set) {
      set = new Set<number>();
      map.set(clean, set);
    }
    set.add(line);
  };
  for (const d of directives) {
    mark(d.path, d.startLine);
  }
  if (verification) {
    for (const c of verification.claims) {
      for (const a of c.claim.anchors) mark(a.path, a.startLine);
    }
    for (const b of verification.blockingConditions) {
      mark(b.item.anchor?.path, b.item.anchor?.startLine);
    }
    for (const imp of verification.impacts ?? []) {
      mark(imp.item.sourceAnchor.path, imp.item.sourceAnchor.startLine);
    }
  }
  return map;
}

async function buildRepoCanvasPayload(repoRoot: string): Promise<{
  payload: Record<string, unknown>;
  summaryText: string;
}> {
  const session = getSession(repoRoot);
  const git = await getGitContext(repoRoot);
  recordRecentRepo(git.repoRoot);

  if (!session.baseRef || !git.recentRefs.includes(session.baseRef)) {
    session.baseRef = git.recentRefs[0] || 'HEAD';
  }

  const availableBriefings = await discoverBriefings(git.repoRoot);
  const defaultNonExample = availableBriefings.find((b) => !b.isExample);
  if (!session.userSelectedBriefing) {
    session.activeBriefingPath = defaultNonExample?.path ?? '';
  } else if (
    session.activeBriefingPath &&
    !availableBriefings.some((b) => b.path === session.activeBriefingPath)
  ) {
    // Keep custom path if still readable, otherwise fallback to newest non-example briefing
    if (!(await isValidBriefingFile(session.activeBriefingPath))) {
      session.activeBriefingPath = defaultNonExample?.path ?? '';
      session.userSelectedBriefing = false;
    }
  }

  const { briefing: activeBriefing, verification } = await loadBriefingAndVerification(
    git.repoRoot,
    session.activeBriefingPath
  );

  const [
    diffStats,
    manifestRes,
    trackedFiles,
    commits,
    directives,
    repoCfg,
    outlines,
    discoveredRepos,
  ] = await Promise.all([
    getDiffStats(git.repoRoot, session.baseRef),
    loadAtlasManifestResult(git.repoRoot),
    listTrackedFiles(git.repoRoot),
    getBranchCommits(git.repoRoot, session.baseRef),
    listDirectives(git.repoRoot, true),
    loadRepoConfig(git.repoRoot),
    loadAllOutlines(git.repoRoot),
    discoverCandidateRepos({
      currentRepoRoot: git.repoRoot,
      extraRoots: defaultCliRepo ? [path.dirname(path.resolve(defaultCliRepo))] : [],
      recentPaths: recentRepoRoots,
    }),
  ]);

  const manifest = manifestRes.status === 'ok' ? manifestRes.manifest : undefined;
  let manifestIssues: ManifestDriftIssue[] = [];
  if (manifestRes.status === 'invalid') {
    manifestIssues = manifestRes.errors.map((e) => ({
      severity: 'error',
      domainId: '(manifest)',
      field: 'path',
      target: 'manifest.json',
      message: e,
    }));
  } else if (manifest) {
    const ver = await verifyManifest(git.repoRoot, manifest);
    manifestIssues = ver.issues;
  }

  const arch = analyzeRepositoryArchitecture(trackedFiles, manifest, session.lang);
  await enrichArchitectureWithWorkspace(git.repoRoot, arch);

  const scopeBoundaries = session.scopeRoot
    ? await scanScopeExternalEdges(git.repoRoot, trackedFiles, session.scopeRoot, arch)
    : [];

  let fileSymbols: Map<string, CuratedFileSymbols> | undefined;
  if (session.expandedFilePaths.size > 0) {
    const expFiles = [...session.expandedFilePaths];
    const changedLinesByFile = await getChangedLinesForFiles(
      git.repoRoot,
      session.baseRef,
      expFiles,
      diffStats
    );
    const anchoredLinesByFile = collectAnchoredLinesByFile(verification, directives);
    fileSymbols = await extractCuratedSymbolsForFiles({
      repoRoot: git.repoRoot,
      files: expFiles,
      changedLinesByFile,
      anchoredLinesByFile,
    });
  }

  const makeGraph = (
    expandedDom: string[],
    expandedFold: string[],
    expandedFiles: string[]
  ): AtlasGraphData =>
    buildAtlasGraph({
      git,
      manifest,
      manifestIssues,
      archOverride: arch,
      hasManifest: manifestRes.status === 'ok',
      storageMode: repoCfg.storageMode,
      scopeRoot: session.scopeRoot,
      outlines,
      scopeBoundaries,
      briefingDepth: activeBriefing?.depth,
      briefingScopePath: activeBriefing?.scopePath,
      diffStats,
      trackedFiles,
      commits,
      verification,
      directives,
      mode: session.mode,
      baseRef: session.baseRef,
      expandedDomainIds: expandedDom,
      expandedFolderIds: expandedFold,
      expandedFilePaths: expandedFiles,
      fileSymbols,
      pruneUnchanged: session.pruneUnchanged,
      showSupportAssets: session.showSupportAssets,
      lang: session.lang,
    });

  let graph = makeGraph(
    [...session.expandedDomainIds],
    [...session.expandedFolderIds],
    [...session.expandedFilePaths]
  );

  const assemblePayload = (g: AtlasGraphData): Record<string, unknown> => ({
    git,
    baseRef: session.baseRef,
    scopeRoot: session.scopeRoot,
    storageMode: repoCfg.storageMode,
    graph: g,
    availableBriefings,
    activeBriefingPath: session.activeBriefingPath,
    discoveredRepos,
    pruneUnchanged: session.pruneUnchanged,
    showSupportAssets: session.showSupportAssets,
    lang: session.lang,
    worktreePath: git.repoRoot,
  });

  let payload = assemblePayload(graph);
  if (Buffer.byteLength(JSON.stringify(payload), 'utf-8') > MAX_TOOL_RESULT_BYTES) {
    // Collapse expanded folders/domains/symbols so CallToolResult stays strictly below 1 MiB
    session.expandedFolderIds.clear();
    session.expandedDomainIds.clear();
    session.expandedFilePaths.clear();
    graph = makeGraph([], [], []);
    payload = assemblePayload(graph);
  }

  const openDirCount = directives.filter(
    (d) => d.status !== 'resolved' && d.status !== 'dismissed'
  ).length;
  const briefingNote = verification
    ? `Active briefing "${verification.briefingTitle}" (${verification.overallBadge.toUpperCase()}${verification.isStale ? ', STALE' : ''}).`
    : 'No active briefing loaded.';
  const summaryText = `CodeAtlas opened for ${git.repoRoot} (${git.branch} @ ${git.shortSha}, mode=${session.mode}, base=${session.baseRef}): ${graph.architecture.domainCount} domains (${graph.architecture.totalFiles} tracked files), ${diffStats.length} changed files, ${openDirCount} open directives. ${briefingNote}`;

  return { payload, summaryText };
}

async function readMcpAppClientJs(): Promise<string> {
  const candidates = [
    path.join(__dirname, 'mcp-app-client.js'),
    path.resolve(process.cwd(), 'dist', 'mcp-app-client.js'),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8');
      // Prevent any literal </script inside bundled strings/regexes from prematurely terminating the inline <script> tag
      return raw.replace(/<\/script/gi, '<\\/script');
    } catch {
      // try next candidate
    }
  }
  return '';
}

async function buildAppHtmlResource(): Promise<string> {
  const overrideHtmlPath = process.env.CODEATLAS_APP_HTML;
  if (overrideHtmlPath) {
    return fs.readFile(overrideHtmlPath, 'utf-8');
  }

  const inlineClientJs = await readMcpAppClientJs();
  const resolved = await resolveOptionalRepoForUi(undefined);
  const initialWorktreePath = resolved.repoRoot ?? defaultCliRepo ?? '';

  // Prefer fresh disk-built dist/canvas-html.js on reopen so UI iterations don't require server restart
  const diskCanvasCandidates = [
    path.join(__dirname, 'canvas-html.js'),
    path.resolve(process.cwd(), 'dist', 'canvas-html.js'),
  ];
  for (const p of diskCanvasCandidates) {
    try {
      await fs.access(p);
      const resolvedMod = require.resolve(p);
      delete require.cache[resolvedMod];
      const mod = require(resolvedMod) as { getCanvasHtml?: typeof getCanvasHtml };
      if (typeof mod.getCanvasHtml === 'function') {
        return mod.getCanvasHtml('', {
          host: 'mcp-app',
          inlineClientJs,
          initialWorktreePath,
        });
      }
    } catch {
      // fallback to bundled getCanvasHtml
    }
  }

  return getCanvasHtml('', {
    host: 'mcp-app',
    inlineClientJs,
    initialWorktreePath,
  });
}

const TOOLS = [
  {
    name: 'open_atlas',
    title: 'CodeAtlas',
    description:
      'Open or update the interactive CodeAtlas architecture, git-anchored causal briefing verification, and directive canvas in Antigravity.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreePath: {
          type: 'string',
          description:
            'Optional path to the target Git repository or worktree directory. Defaults to the current or last active repository.',
        },
        mode: {
          type: 'string',
          enum: ['hybrid', 'atlas', 'briefing'],
          description: 'Optional initial view mode (hybrid, atlas, or briefing).',
        },
        scopeRoot: {
          type: 'string',
          description:
            'Optional relative directory path (e.g. "src/core" or "crates/aster-app") to focus as the Canvas view root. Pass "" to reset to full repository root.',
        },
        expandFiles: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of repository-relative file paths (e.g. ["src/core/verifier.ts"]) whose structured Tree-sitter AST Symbol sub-layer should be expanded on open.',
        },
      },
    },
    _meta: {
      ui: {
        resourceUri: APP_URI,
        visibility: ['model', 'app'],
      },
      'com.google.antigravity/ui': {
        entrypoints: [
          { type: 'aux_pane', title: 'CodeAtlas' },
          { type: 'global', title: 'CodeAtlas' },
        ],
      },
    },
  },
  {
    name: 'atlas_app_action',
    title: 'CodeAtlas App Action',
    description:
      'App-only interactive UI action and shared <git-dir>/codeatlas/ state handler for the CodeAtlas MCP App.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        worktreePath: { type: 'string' },
        action: { type: 'string' },
        payload: { type: 'object' },
      },
    },
    _meta: {
      ui: {
        visibility: ['app'],
      },
    },
  },
  {
    name: 'atlas_get_context',
    description:
      'Read repository Git state, .atlas/manifest.json architectural domains & guardrails, manifest drift checks, Tree-sitter AST symbol/import/guard outline (exact 1-based line spans), active briefing summary, and open directives.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreePath: {
          type: 'string',
          description: 'Absolute path to the target Git worktree directory.',
        },
        scopePath: {
          type: 'string',
          description:
            'Optional relative module/directory or file path (e.g. "src/core" or "crates/aster-app") to pre-extract exact Tree-sitter AST symbol spans and guard clauses.',
        },
        baseRef: {
          type: 'string',
          description: 'Optional Git base ref (e.g. "HEAD~1") to extract AST symbols for modified files.',
        },
      },
    },
  },
  {
    name: 'atlas_submit_outline',
    description:
      'Submit a lightweight L1 Module Tour / Responsibility Outline (schema v0.2) that hydrates a directory/module card and each of its child files/subfolders in-place with concise 1-sentence role descriptions. Every path is deterministically verified against the repository.',
    inputSchema: {
      type: 'object',
      required: ['outline'],
      properties: {
        worktreePath: { type: 'string' },
        outline: {
          type: 'object',
          required: ['schemaVersion', 'scopePath', 'title', 'summary', 'children'],
          properties: {
            schemaVersion: { type: 'string', enum: ['0.2'] },
            scopePath: { type: 'string' },
            targetRef: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            recommendedEntry: { type: 'string' },
            children: {
              type: 'array',
              items: {
                type: 'object',
                required: ['path', 'summary'],
                properties: {
                  path: { type: 'string' },
                  summary: { type: 'string' },
                  role: {
                    type: 'string',
                    enum: ['entry', 'core', 'types', 'util', 'test', 'config'],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'atlas_submit_briefing',
    description:
      'Submit a structured causal change briefing (schema v0.1 or v0.2). CodeAtlas deterministically verifies every claim, blocking condition, and impact anchor immediately and returns any MISMATCH/STALE issues.',
    inputSchema: {
      type: 'object',
      required: ['briefing'],
      properties: {
        worktreePath: { type: 'string' },
        briefing: { type: 'object' },
      },
    },
  },
  {
    name: 'atlas_fetch_directives',
    description:
      'Fetch open/claimed CodeAtlas directives for a worktree (with dynamic staleness). Optionally atomically claim available directives with a lease TTL.',
    inputSchema: {
      type: 'object',
      properties: {
        worktreePath: { type: 'string' },
        agentId: { type: 'string' },
        claim: { type: 'boolean', default: false },
        leaseMinutes: { type: 'number', default: 15 },
      },
    },
  },
  {
    name: 'atlas_ack_directive',
    description:
      'Acknowledge and resolve a directive using optimistic revision CAS. Rejects rework acks when no code changes exist.',
    inputSchema: {
      type: 'object',
      required: ['id', 'expectedRevision', 'agentId', 'summary'],
      properties: {
        worktreePath: { type: 'string' },
        id: { type: 'string' },
        expectedRevision: { type: 'number' },
        agentId: { type: 'string' },
        summary: { type: 'string' },
        evidenceAnchor: { type: 'object' },
      },
    },
  },
];

async function handleOpenAtlas(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const requestedMode =
    args.mode === 'atlas' || args.mode === 'briefing' || args.mode === 'hybrid'
      ? args.mode
      : undefined;
  if (requestedMode) {
    globalFallbackMode = requestedMode;
  }

  const resolved = await resolveOptionalRepoForUi(args.worktreePath);
  if (!resolved.repoRoot) {
    const discoveredRepos = await discoverCandidateRepos({
      recentPaths: recentRepoRoots,
      extraRoots: defaultCliRepo ? [path.dirname(path.resolve(defaultCliRepo))] : [],
    });
    const emptyPayload = buildEmptyCanvasPayload({
      mode: globalFallbackMode,
      lang: globalFallbackLang,
      worktreePath: resolved.attemptedPath ?? '',
      discoveredRepos,
      error: resolved.error,
    });
    const msg =
      resolved.error ??
      'CodeAtlas Canvas opened without an active Git repository. Enter a local repository path in the top bar or call open_atlas with worktreePath.';
    return {
      content: [{ type: 'text', text: msg }],
      structuredContent: emptyPayload,
    };
  }

  const session = getSession(resolved.repoRoot);
  if (requestedMode) {
    session.mode = requestedMode;
  }
  if (typeof args.scopeRoot === 'string') {
    session.scopeRoot = args.scopeRoot.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }
  if (Array.isArray(args.expandFiles)) {
    const tracked = await listTrackedFiles(resolved.repoRoot);
    const manifestRes = await loadAtlasManifestResult(resolved.repoRoot);
    const arch = analyzeRepositoryArchitecture(
      tracked,
      manifestRes.status === 'ok' ? manifestRes.manifest : undefined,
      session.lang
    );
    for (const raw of args.expandFiles) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const clean = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
      if (!clean) continue;
      session.expandedFilePaths.add(clean);
      for (const dom of arch.domains) {
        if (
          dom.files.includes(clean) ||
          dom.paths.some((dp) => {
            const p0 = dp.replace(/\\/g, '/').replace(/\/+$/, '');
            return p0 && (clean === p0 || clean.startsWith(`${p0}/`));
          })
        ) {
          session.expandedDomainIds.add(dom.id);
        }
      }
    }
  }

  const { payload, summaryText } = await buildRepoCanvasPayload(resolved.repoRoot);
  return {
    content: [{ type: 'text', text: summaryText }],
    structuredContent: payload,
  };
}

async function handleSnippetAction(
  repoRoot: string | undefined,
  session: RepoUiSession | undefined,
  payloadObj: Record<string, unknown>
): Promise<ToolCallResponse> {
  const nodeId = String(payloadObj.nodeId ?? '');
  const relPath = typeof payloadObj.path === 'string' ? payloadObj.path : '';
  const startLine = typeof payloadObj.startLine === 'number' ? payloadObj.startLine : undefined;
  const endLine = typeof payloadObj.endLine === 'number' ? payloadObj.endLine : undefined;
  const fromBriefing = Boolean(payloadObj.fromBriefing);

  if (!repoRoot || !relPath) {
    const snippet = { nodeId, lines: [], error: 'No workspace or file path.' };
    return {
      content: [{ type: 'text', text: snippet.error }],
      structuredContent: { type: 'snippet', snippet, payload: snippet, ...snippet },
    };
  }

  try {
    const gitCtx = await getGitContext(repoRoot);
    let targetRef = 'WORKTREE';
    if (fromBriefing && session?.activeBriefingPath) {
      const ver = await loadVerificationForPath(gitCtx.repoRoot, session.activeBriefingPath);
      if (ver?.targetRefClaimed) {
        targetRef = ver.targetRefClaimed;
      }
    }

    const content = await readFileAtRef(gitCtx.repoRoot, relPath, targetRef);
    if (content === undefined) {
      const snippet = {
        nodeId,
        lines: [],
        refUsed: targetRef,
        error: `File "${relPath}" not found at ref "${targetRef}".`,
      };
      return {
        content: [{ type: 'text', text: snippet.error }],
        structuredContent: { type: 'snippet', snippet, payload: snippet, ...snippet },
      };
    }

    const allLines = content.split(/\r?\n/);
    const start = Math.max(1, (startLine ?? 1) - 4);
    const cappedTargetEnd = endLine ? Math.min(endLine, (startLine ?? 1) + 90) : (startLine ?? 1);
    const end = Math.min(allLines.length, cappedTargetEnd + 8);
    const hlStart = startLine ?? 1;
    const hlEnd = endLine ?? hlStart;

    const lines = [];
    for (let i = start; i <= end; i++) {
      lines.push({
        num: i,
        text: allLines[i - 1] ?? '',
        highlight: i >= hlStart && i <= hlEnd,
      });
    }
    const snippet = { nodeId, lines, refUsed: targetRef };
    return {
      content: [{ type: 'text', text: `Loaded snippet for ${relPath} (${lines.length} lines).` }],
      structuredContent: { type: 'snippet', snippet, payload: snippet, ...snippet },
    };
  } catch (err: unknown) {
    const snippet = {
      nodeId,
      lines: [],
      error: err instanceof Error ? err.message : String(err),
    };
    return {
      content: [{ type: 'text', text: snippet.error }],
      structuredContent: { type: 'snippet', snippet, payload: snippet, ...snippet },
    };
  }
}

async function handleDiffAction(
  repoRoot: string | undefined,
  session: RepoUiSession | undefined,
  payloadObj: Record<string, unknown>
): Promise<ToolCallResponse> {
  const nodeId = String(payloadObj.nodeId ?? '');
  const relPath = typeof payloadObj.path === 'string' ? payloadObj.path : '';

  if (!repoRoot || !relPath) {
    const fileDiff = { nodeId, diff: '' };
    return {
      content: [{ type: 'text', text: 'No workspace or file path.' }],
      structuredContent: { type: 'fileDiff', fileDiff, payload: fileDiff, ...fileDiff },
    };
  }

  try {
    const gitCtx = await getGitContext(repoRoot);
    const effectiveBase = session?.baseRef || gitCtx.recentRefs[0] || 'HEAD';
    let diff = await getFileDiff(gitCtx.repoRoot, relPath, effectiveBase);
    if (Buffer.byteLength(diff, 'utf-8') > MAX_DIFF_TEXT_BYTES) {
      diff = diff.slice(0, MAX_DIFF_TEXT_BYTES) + '\n... [diff truncated at 200 KB] ...\n';
    }
    const fileDiff = { nodeId, diff };
    return {
      content: [{ type: 'text', text: `Loaded diff for ${relPath}.` }],
      structuredContent: { type: 'fileDiff', fileDiff, payload: fileDiff, ...fileDiff },
    };
  } catch {
    const fileDiff = { nodeId, diff: '' };
    return {
      content: [{ type: 'text', text: `Empty diff for ${relPath}.` }],
      structuredContent: { type: 'fileDiff', fileDiff, payload: fileDiff, ...fileDiff },
    };
  }
}

async function handleAtlasAppAction(args: Record<string, unknown>): Promise<ToolCallResponse> {
  const action = String(args.action ?? '');
  const payloadObj =
    args.payload && typeof args.payload === 'object'
      ? (args.payload as Record<string, unknown>)
      : {};

  if (action === 'setLang') {
    if (payloadObj.lang === 'zh' || payloadObj.lang === 'en') {
      globalFallbackLang = payloadObj.lang;
    }
  }

  const candidatePath =
    action === 'setWorktreePath'
      ? (payloadObj.worktreePath ?? args.worktreePath)
      : (args.worktreePath ?? payloadObj.worktreePath);

  const resolved = await resolveOptionalRepoForUi(candidatePath);

  if (action === 'browseDirectory') {
    const reqDir = typeof payloadObj.dirPath === 'string' ? payloadObj.dirPath : undefined;
    const fallbackStart = resolved.repoRoot
      ? path.dirname(resolved.repoRoot)
      : lastActiveRepoRoot
        ? path.dirname(lastActiveRepoRoot)
        : process.cwd();
    const listing = await listDirectoryEntries(reqDir, fallbackStart);
    return {
      content: [{ type: 'text', text: `Listed directory ${listing.currentPath || 'drives'}.` }],
      structuredContent: { type: 'dirListing', listing, payload: listing },
    };
  }

  if (action === 'pickWorktreeDialog') {
    const startDir = resolved.repoRoot
      ? path.dirname(resolved.repoRoot)
      : lastActiveRepoRoot
        ? path.dirname(lastActiveRepoRoot)
        : process.cwd();
    const picked = await openNativeFolderDialog(startDir);
    if (!picked) {
      return {
        content: [{ type: 'text', text: 'Folder selection cancelled.' }],
        structuredContent: { type: 'pickCancelled', cancelled: true },
      };
    }
    const pickedRepo = await tryGetRepoRoot(picked);
    if (pickedRepo) {
      lastActiveRepoRoot = pickedRepo;
      const { payload, summaryText } = await buildRepoCanvasPayload(pickedRepo);
      return {
        content: [{ type: 'text', text: summaryText }],
        structuredContent: payload,
      };
    }
    const listing = await listDirectoryEntries(picked, startDir);
    return {
      content: [
        {
          type: 'text',
          text: `Selected folder "${picked}" is not a Git repository; opened child directory browser.`,
        },
      ],
      structuredContent: {
        type: 'dirListing',
        listing,
        nonRepoNotice: picked,
        payload: { ...listing, nonRepoNotice: picked },
      },
    };
  }

  if (action === 'requestSnippet') {
    const session = resolved.repoRoot ? getSession(resolved.repoRoot) : undefined;
    return handleSnippetAction(resolved.repoRoot, session, payloadObj);
  }

  if (action === 'requestDiff') {
    const session = resolved.repoRoot ? getSession(resolved.repoRoot) : undefined;
    return handleDiffAction(resolved.repoRoot, session, payloadObj);
  }

  if (!resolved.repoRoot) {
    if (
      action === 'setMode' &&
      (payloadObj.mode === 'atlas' ||
        payloadObj.mode === 'briefing' ||
        payloadObj.mode === 'hybrid')
    ) {
      globalFallbackMode = payloadObj.mode;
    }
    const discoveredRepos = await discoverCandidateRepos({
      recentPaths: recentRepoRoots,
      extraRoots: defaultCliRepo ? [path.dirname(path.resolve(defaultCliRepo))] : [],
    });
    const emptyPayload = buildEmptyCanvasPayload({
      mode: globalFallbackMode,
      lang: globalFallbackLang,
      worktreePath: resolved.attemptedPath ?? '',
      discoveredRepos,
      error: resolved.error,
    });
    return {
      content: [{ type: 'text', text: String(emptyPayload.error ?? 'No active Git repository.') }],
      structuredContent: emptyPayload,
    };
  }

  const repoRoot = resolved.repoRoot;
  const session = getSession(repoRoot);

  let createdDirective: AnnotationDirective | undefined;

  switch (action) {
    case 'ready':
    case 'setWorktreePath':
      break;

    case 'setScopeRoot': {
      const nextScope =
        typeof payloadObj.scopeRoot === 'string'
          ? payloadObj.scopeRoot.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
          : '';
      session.scopeRoot = nextScope === '(root)' || nextScope === '.' ? '' : nextScope;
      session.expandedDomainIds.clear();
      session.expandedFolderIds.clear();
      session.expandedFilePaths.clear();
      break;
    }

    case 'setStorageMode': {
      const m = payloadObj.storageMode;
      if (m === 'git-hidden' || m === 'worktree-excluded' || m === 'worktree-tracked') {
        await switchRepoStorageMode(repoRoot, m as StorageMode);
      }
      break;
    }

    case 'refresh': {
      if (typeof payloadObj.baseRef === 'string' && payloadObj.baseRef) {
        session.baseRef = payloadObj.baseRef;
      }
      break;
    }

    case 'setMode': {
      if (
        payloadObj.mode === 'atlas' ||
        payloadObj.mode === 'briefing' ||
        payloadObj.mode === 'hybrid'
      ) {
        session.mode = payloadObj.mode;
        globalFallbackMode = payloadObj.mode;
      }
      break;
    }

    case 'setBaseRef': {
      if (typeof payloadObj.baseRef === 'string' && payloadObj.baseRef) {
        session.baseRef = payloadObj.baseRef;
      }
      break;
    }

    case 'setLang': {
      if (payloadObj.lang === 'zh' || payloadObj.lang === 'en') {
        session.lang = payloadObj.lang;
        globalFallbackLang = payloadObj.lang;
      }
      break;
    }

    case 'toggleDomainFiles': {
      const domainId = typeof payloadObj.domainId === 'string' ? payloadObj.domainId : '';
      if (domainId) {
        if (session.expandedDomainIds.has(domainId)) {
          session.expandedDomainIds.delete(domainId);
        } else {
          session.expandedDomainIds.add(domainId);
        }
      }
      break;
    }

    case 'expandDomainFiles': {
      const domainId = typeof payloadObj.domainId === 'string' ? payloadObj.domainId : '';
      if (domainId) {
        session.expandedDomainIds.add(domainId);
      }
      break;
    }

    case 'expandAllFiles': {
      if (Array.isArray(payloadObj.domainIds)) {
        for (const id of payloadObj.domainIds) {
          if (typeof id === 'string' && id) session.expandedDomainIds.add(id);
        }
      }
      break;
    }

    case 'collapseAllFiles': {
      session.expandedDomainIds.clear();
      session.expandedFolderIds.clear();
      session.expandedFilePaths.clear();
      break;
    }

    case 'toggleFolderFiles': {
      const folderId = typeof payloadObj.folderId === 'string' ? payloadObj.folderId : '';
      if (folderId) {
        if (session.expandedFolderIds.has(folderId)) {
          session.expandedFolderIds.delete(folderId);
        } else {
          session.expandedFolderIds.add(folderId);
        }
      }
      break;
    }

    case 'toggleFileSymbols': {
      const rawPath = typeof payloadObj.path === 'string' ? payloadObj.path : '';
      const cleanPath = rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
      if (cleanPath) {
        if (session.expandedFilePaths.has(cleanPath)) {
          session.expandedFilePaths.delete(cleanPath);
        } else {
          session.expandedFilePaths.add(cleanPath);
        }
      }
      break;
    }

    case 'toggleSupportAssets': {
      session.showSupportAssets = !session.showSupportAssets;
      break;
    }

    case 'setPruneUnchanged': {
      session.pruneUnchanged = Boolean(payloadObj.value);
      break;
    }

    case 'selectBriefing': {
      if (typeof payloadObj.path === 'string') {
        session.activeBriefingPath = payloadObj.path;
        session.userSelectedBriefing = Boolean(payloadObj.path);
      }
      break;
    }

    case 'addDirective': {
      const kind =
        payloadObj.kind === 'constraint' ||
        payloadObj.kind === 'question' ||
        payloadObj.kind === 'rework'
          ? payloadObj.kind
          : 'question';
      const dirPath = typeof payloadObj.path === 'string' ? payloadObj.path.trim() : '';
      const note = typeof payloadObj.note === 'string' ? payloadObj.note.trim() : '';
      const startLine =
        typeof payloadObj.startLine === 'number' && Number.isFinite(payloadObj.startLine)
          ? payloadObj.startLine
          : undefined;
      const targetNodeId =
        typeof payloadObj.targetNodeId === 'string' && payloadObj.targetNodeId
          ? payloadObj.targetNodeId
          : undefined;
      if (dirPath && note) {
        const gitCtx = await getGitContext(repoRoot);
        createdDirective = await createDirective(gitCtx.repoRoot, {
          ref: gitCtx.headSha || 'WORKTREE',
          path: dirPath,
          startLine,
          targetNodeId,
          kind,
          note,
        });
      }
      break;
    }

    case 'removeDirective': {
      const id = typeof payloadObj.id === 'string' ? payloadObj.id : '';
      if (id) {
        await deleteDirective(repoRoot, id);
      }
      break;
    }

    case 'clearDirectives': {
      await clearAllDirectives(repoRoot);
      break;
    }

    case 'initManifestDraft': {
      const tracked = await listTrackedFiles(repoRoot);
      const arch = analyzeRepositoryArchitecture(tracked, undefined, session.lang);
      await enrichArchitectureWithWorkspace(repoRoot, arch);
      await exportManifestDraft(repoRoot, arch, Boolean(payloadObj.overwrite ?? true));
      break;
    }

    default:
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown atlas_app_action: ${action}` }],
      };
  }

  const { payload, summaryText } = await buildRepoCanvasPayload(repoRoot);
  if (createdDirective) {
    payload.createdDirective = createdDirective;
  }
  return {
    content: [{ type: 'text', text: summaryText }],
    structuredContent: payload,
  };
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResponse> {
  if (name === 'open_atlas') {
    return handleOpenAtlas(args);
  }

  if (name === 'atlas_app_action') {
    return handleAtlasAppAction(args);
  }

  const repoRoot = await resolveTargetRepo(args.worktreePath);

  if (name === 'atlas_get_context') {
    const scopePath =
      typeof args.scopePath === 'string'
        ? args.scopePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
        : '';
    const baseRefArg = typeof args.baseRef === 'string' && args.baseRef ? args.baseRef : '';

    const [gitContext, manifestResult, latestBriefing, openDirectives, tracked] = await Promise.all([
      getGitContext(repoRoot),
      loadAtlasManifestResult(repoRoot),
      loadLatestBriefingRecord(repoRoot),
      listDirectives(repoRoot, false),
      listTrackedFiles(repoRoot),
    ]);
    const manifestVerification =
      manifestResult.status === 'ok'
        ? await verifyManifest(repoRoot, manifestResult.manifest)
        : undefined;

    let candidateAstFiles: string[] = [];
    if (scopePath) {
      candidateAstFiles = tracked.filter(
        (f) => f === scopePath || f.startsWith(`${scopePath}/`)
      );
    } else {
      const effectiveBase = baseRefArg || gitContext.recentRefs[0] || 'HEAD';
      try {
        const diff = await getDiffStats(repoRoot, effectiveBase);
        candidateAstFiles = diff.map((d) => d.path);
      } catch {
        candidateAstFiles = [];
      }
    }
    const astOutline =
      candidateAstFiles.length > 0
        ? await buildAstOutlineForFiles(repoRoot, candidateAstFiles, 24)
        : [];

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              gitContext,
              manifestResult,
              manifestVerification,
              astOutline,
              latestBriefingSummary: latestBriefing
                ? {
                    id: latestBriefing.id,
                    title: latestBriefing.briefing.title,
                    overallBadge: latestBriefing.verification.overallBadge,
                    isStale: latestBriefing.verification.isStale,
                    storedAt: latestBriefing.storedAt,
                  }
                : null,
              openDirectives,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === 'atlas_submit_outline') {
    const outline = args.outline as ModuleOutlineReport;
    if (!outline || typeof outline !== 'object' || !Array.isArray(outline.children)) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid outline payload: missing children array.' }],
      };
    }
    const verification = await verifyOutline(repoRoot, outline);
    const stored = await saveOutlineRecord(repoRoot, outline, verification);

    // Auto-expand matching domain/folder in session so user sees hydrated files right away!
    const session = getSession(repoRoot);
    const scopeClean = stored.outline.scopePath;
    if (scopeClean) {
      const tracked = await listTrackedFiles(repoRoot);
      const manifestRes = await loadAtlasManifestResult(repoRoot);
      const arch = analyzeRepositoryArchitecture(
        tracked,
        manifestRes.status === 'ok' ? manifestRes.manifest : undefined,
        session.lang
      );
      for (const d of arch.domains) {
        const dp = (d.paths[0] ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
        if (dp === scopeClean || scopeClean.startsWith(`${dp}/`)) {
          session.expandedDomainIds.add(d.id);
        }
      }
    }

    return {
      isError: verification.overallBadge === 'mismatch',
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              storedId: stored.id,
              storedPath: stored.filePath,
              verification,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === 'atlas_submit_briefing') {
    const briefing = args.briefing as BriefingReport;
    if (!briefing || typeof briefing !== 'object' || !Array.isArray(briefing.claims)) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Invalid briefing payload: missing claims array.' }],
      };
    }
    const verification = await verifyBriefing(repoRoot, briefing);
    const stored = await saveBriefingRecord(repoRoot, briefing, verification);
    const session = getSession(repoRoot);
    session.activeBriefingPath = stored.filePath;
    session.userSelectedBriefing = false;

    return {
      isError: verification.overallBadge === 'mismatch',
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              storedId: stored.id,
              storedPath: stored.filePath,
              verification,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === 'atlas_fetch_directives') {
    const open = await listDirectives(repoRoot, false);
    const shouldClaim = Boolean(args.claim);
    const agentId =
      typeof args.agentId === 'string' && args.agentId ? args.agentId : 'unknown-agent';
    const leaseMinutes =
      typeof args.leaseMinutes === 'number' && args.leaseMinutes > 0 ? args.leaseMinutes : 15;

    if (!shouldClaim) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ directives: open }, null, 2) }],
      };
    }

    const claimed = [];
    for (const d of open) {
      const c = await claimDirective(repoRoot, d.id, agentId, leaseMinutes);
      if (c) claimed.push({ ...c, isStale: d.isStale });
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ directives: claimed }, null, 2) }],
    };
  }

  if (name === 'atlas_ack_directive') {
    const res = await ackDirective(repoRoot, {
      id: String(args.id ?? ''),
      expectedRevision: Number(args.expectedRevision),
      agentId: String(args.agentId ?? 'unknown-agent'),
      summary: String(args.summary ?? ''),
      evidenceAnchor: args.evidenceAnchor as EvidenceAnchor | undefined,
    });
    return {
      isError: !res.ok,
      content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
    };
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
  };
}

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  const id = req.id ?? null;
  if (req.method === 'notifications/initialized' || req.method.startsWith('notifications/')) {
    return;
  }
  if (req.method === 'ping') {
    sendResult(id, {});
    return;
  }
  if (req.method === 'initialize') {
    sendResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'codeatlas-mcp', version: '0.2.0' },
    });
    return;
  }
  if (req.method === 'resources/list') {
    sendResult(id, {
      resources: [
        {
          uri: APP_URI,
          name: 'CodeAtlas Canvas',
          description:
            'Interactive CodeAtlas architecture, git-anchored briefing verification, and directive canvas.',
          mimeType: 'text/html;profile=mcp-app',
          _meta: {
            ui: {
              prefersBorder: false,
            },
          },
        },
      ],
    });
    return;
  }
  if (req.method === 'resources/read') {
    const uri = String(req.params?.uri ?? '');
    if (uri !== APP_URI) {
      sendError(id, -32602, `Resource not found: ${uri}`);
      return;
    }
    try {
      const html = await buildAppHtmlResource();
      sendResult(id, {
        contents: [
          {
            uri: APP_URI,
            mimeType: 'text/html;profile=mcp-app',
            text: html,
            _meta: {
              ui: {
                prefersBorder: false,
              },
            },
          },
        ],
      });
    } catch (err: unknown) {
      sendError(id, -32603, err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (req.method === 'tools/list') {
    sendResult(id, { tools: TOOLS });
    return;
  }
  if (req.method === 'tools/call') {
    const params = req.params ?? {};
    const name = String(params.name ?? '');
    const toolArgs = (params.arguments as Record<string, unknown>) ?? {};
    try {
      const result = await handleToolCall(name, toolArgs);
      sendResult(id, result);
    } catch (err: unknown) {
      sendError(id, -32602, err instanceof Error ? err.message : String(err));
    }
    return;
  }
  if (id !== null) {
    sendError(id, -32601, `Method not found: ${req.method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed) as JsonRpcRequest;
    void handleRequest(req).catch((err: unknown) => {
      process.stderr.write(`[codeatlas-mcp] Unhandled error: ${String(err)}\n`);
    });
  } catch (err: unknown) {
    process.stderr.write(`[codeatlas-mcp] Invalid JSON: ${String(err)}\n`);
  }
});
