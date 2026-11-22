import { spawn } from 'node:child_process';
import {
  getDiffStats,
  getFileDiff,
  getGitContext,
  listTrackedFiles,
  readFileAtRef,
} from './git.js';
import {
  ackDirective,
  saveBriefingRecord,
  saveOutlineRecord,
  StoredBriefingRecord,
  StoredOutlineRecord,
  verifyOutline,
} from './store.js';
import {
  AnalysisDepth,
  AnnotationDirective,
  BlockingCondition,
  BriefingClaim,
  BriefingReport,
  BriefingVerificationResult,
  DeclaredImpact,
  DiffFileStat,
  EvidenceAnchor,
  FileRoleItem,
  GitContext,
  ModuleOutlineReport,
  VerificationSignal,
} from './types.js';
import { verifyBriefing } from './verifier.js';

export type AnalyzerProvider = 'openai-compatible' | 'cli-claude' | 'cli-codex' | 'cli-gemini';

export interface AnalyzerConfig {
  provider: AnalyzerProvider;
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  cliCommand?: string;
  timeoutMs?: number;
}

export interface AnalyzeRequest {
  repoRoot: string;
  scope: 'branch' | 'node';
  depth?: AnalysisDepth;
  baseRef: string;
  nodeTitle?: string;
  nodeKind?: string;
  nodePath?: string;
  lang?: 'zh' | 'en';
  config: AnalyzerConfig;
  onProgress?: (stage: string) => void;
  executorOverride?: (prompt: string) => Promise<string>;
}

const MAX_PACKED_CONTEXT_BYTES = 32 * 1024;
const MAX_DIFF_SECTION_BYTES = 12 * 1024;
const MAX_SINGLE_FILE_BYTES = 14 * 1024;
const MAX_NODE_DIRECTORY_FILES = 8;
const DEFAULT_TIMEOUT_MS = 180_000;

export interface PackedFileSnippet {
  path: string;
  totalLines: number;
  truncated: boolean;
  numberedContent: string;
}

export interface PackedAnalysisContext {
  git: GitContext;
  changedFiles: string[];
  diffSection: string;
  filesSection: string;
  packedFiles: PackedFileSnippet[];
  truncatedPaths: string[];
}

function normalizePosixPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/^\.\//, '');
}

/**
 * Prepends exact 1-based line numbers (`1: ...`, `2: ...`) matching `verifier.ts` line splitting.
 */
export function formatLineNumberedSnippet(
  content: string,
  maxBytes = MAX_SINGLE_FILE_BYTES
): { numberedContent: string; totalLines: number; truncated: boolean } {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const outLines: string[] = [];
  let usedBytes = 0;
  let truncated = false;

  for (let i = 0; i < lines.length; i++) {
    const numberedLine = `${i + 1}: ${lines[i]}`;
    const lineBytes = Buffer.byteLength(numberedLine, 'utf-8') + 1;
    if (usedBytes + lineBytes > maxBytes && outLines.length > 0) {
      truncated = true;
      break;
    }
    outLines.push(numberedLine);
    usedBytes += lineBytes;
  }

  return {
    numberedContent: outLines.join('\n'),
    totalLines,
    truncated,
  };
}

const ASSET_EXT_SET = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.avif', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.webm', '.mov', '.mp3', '.wav',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar', '.wasm', '.bin', '.exe', '.dll', '.so', '.dylib',
]);
const DOC_EXT_SET = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const CONFIG_EXT_SET = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.lock', '.xml']);
const LOCKFILE_SET = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'cargo.lock', 'poetry.lock', 'uv.lock', 'go.sum',
]);

type RunnerFileKind = 'code' | 'test' | 'ci' | 'config' | 'docs' | 'asset';

function classifyRunnerFile(relPath: string): RunnerFileKind {
  const lower = normalizePosixPath(relPath).toLowerCase();
  const base = lower.split('/').pop() || lower;
  const dotIdx = base.lastIndexOf('.');
  const ext = dotIdx >= 0 ? base.slice(dotIdx) : '';

  if (lower.startsWith('.github/') || lower.startsWith('.gitlab-ci') || lower.startsWith('.circleci/')) {
    return 'ci';
  }
  if (ASSET_EXT_SET.has(ext)) {
    return 'asset';
  }
  if (DOC_EXT_SET.has(ext) || lower.startsWith('docs/') || base === 'license' || base === 'changelog') {
    return 'docs';
  }
  if (
    lower.startsWith('test/') ||
    lower.startsWith('tests/') ||
    lower.includes('/__tests__/') ||
    lower.includes('/tests/') ||
    /\.(test|spec)\.[^.]+$/.test(base) ||
    /_test\.[^.]+$/.test(base)
  ) {
    return 'test';
  }
  if (LOCKFILE_SET.has(base) || base.startsWith('.') || CONFIG_EXT_SET.has(ext)) {
    return 'config';
  }
  return 'code';
}

function artifactPriority(relPath: string): number {
  const kind = classifyRunnerFile(relPath);
  switch (kind) {
    case 'code':
      return 0;
    case 'test':
      return 1;
    case 'ci':
      return 2;
    case 'config':
      return 3;
    case 'docs':
      return 4;
    case 'asset':
    default:
      return 5;
  }
}

function isEntrypointLike(relPath: string): boolean {
  const base = relPath.split('/').pop()?.toLowerCase() ?? '';
  return /^(index|main|mod|lib|app|server|extension|client|router|engine)\.[^.]+$/.test(base);
}

function rankDiffStats(stats: DiffFileStat[]): DiffFileStat[] {
  return [...stats].sort((a, b) => {
    const aDeleted = a.status.startsWith('D') ? 1 : 0;
    const bDeleted = b.status.startsWith('D') ? 1 : 0;
    if (aDeleted !== bDeleted) return aDeleted - bDeleted;

    const prioDiff = artifactPriority(a.path) - artifactPriority(b.path);
    if (prioDiff !== 0) return prioDiff;

    const aChanges = a.additions + a.deletions;
    const bChanges = b.additions + b.deletions;
    return bChanges - aChanges;
  });
}

function rankNodeCandidateFiles(paths: string[], changedSet: Set<string>): string[] {
  return [...paths].sort((a, b) => {
    const prioDiff = artifactPriority(a) - artifactPriority(b);
    if (prioDiff !== 0) return prioDiff;

    const aChanged = changedSet.has(a) ? 0 : 1;
    const bChanged = changedSet.has(b) ? 0 : 1;
    if (aChanged !== bChanged) return aChanged - bChanged;

    const aEntry = isEntrypointLike(a) ? 0 : 1;
    const bEntry = isEntrypointLike(b) ? 0 : 1;
    if (aEntry !== bEntry) return aEntry - bEntry;

    const aDepth = a.split('/').length;
    const bDepth = b.split('/').length;
    if (aDepth !== bDepth) return aDepth - bDepth;

    return a.localeCompare(b);
  });
}

export async function packAnalysisContext(req: AnalyzeRequest): Promise<PackedAnalysisContext> {
  const git = await getGitContext(req.repoRoot);
  const repoRoot = git.repoRoot;
  const diffStats = await getDiffStats(repoRoot, req.baseRef);
  const changedFiles = diffStats
    .filter((d) => !d.status.startsWith('D'))
    .map((d) => normalizePosixPath(d.path));
  const changedSet = new Set(changedFiles);

  let totalBudgetRemaining = MAX_PACKED_CONTEXT_BYTES;
  const diffChunks: string[] = [];
  const packedFiles: PackedFileSnippet[] = [];
  const truncatedPaths: string[] = [];

  if (req.scope === 'branch') {
    const rankedDiffs = rankDiffStats(diffStats);
    let diffBudgetRemaining = Math.min(MAX_DIFF_SECTION_BYTES, totalBudgetRemaining);

    for (const stat of rankedDiffs) {
      if (diffBudgetRemaining <= 256) break;
      const posixPath = normalizePosixPath(stat.path);
      const rawDiff = await getFileDiff(repoRoot, posixPath, req.baseRef);
      if (!rawDiff.trim()) continue;

      const header = `--- git diff ${posixPath} (${stat.status}, +${stat.additions}/-${stat.deletions}) ---\n`;
      const maxSlice = Math.max(0, diffBudgetRemaining - Buffer.byteLength(header, 'utf-8'));
      if (maxSlice <= 0) break;

      let body = rawDiff.trimEnd();
      if (Buffer.byteLength(body, 'utf-8') > maxSlice) {
        body = body.slice(0, maxSlice) + '\n... [diff truncated]';
      }
      const chunk = `${header}${body}`;
      const bytes = Buffer.byteLength(chunk, 'utf-8') + 2;
      diffChunks.push(chunk);
      diffBudgetRemaining -= bytes;
      totalBudgetRemaining -= bytes;
    }

    let candidateFiles = rankedDiffs
      .filter((s) => !s.status.startsWith('D') && classifyRunnerFile(s.path) !== 'asset')
      .map((s) => normalizePosixPath(s.path));

    if (candidateFiles.length === 0) {
      const tracked = await listTrackedFiles(repoRoot);
      candidateFiles = rankNodeCandidateFiles(
        tracked.filter((f) => classifyRunnerFile(f) !== 'asset'),
        changedSet
      ).slice(0, MAX_NODE_DIRECTORY_FILES);
    }

    for (const relPath of candidateFiles) {
      if (totalBudgetRemaining <= 384) {
        truncatedPaths.push(relPath);
        continue;
      }
      const content = await readFileAtRef(repoRoot, relPath, 'WORKTREE');
      if (content === undefined) continue;

      const perFileCap = Math.min(MAX_SINGLE_FILE_BYTES, Math.max(512, totalBudgetRemaining - 128));
      const formatted = formatLineNumberedSnippet(content, perFileCap);
      packedFiles.push({
        path: relPath,
        totalLines: formatted.totalLines,
        truncated: formatted.truncated,
        numberedContent: formatted.numberedContent,
      });
      if (formatted.truncated) {
        truncatedPaths.push(relPath);
      }
      totalBudgetRemaining -= Buffer.byteLength(formatted.numberedContent, 'utf-8') + 96;
    }
  } else {
    const targetPath = normalizePosixPath(req.nodePath ?? '');
    const directFileContent = targetPath
      ? await readFileAtRef(repoRoot, targetPath, 'WORKTREE')
      : undefined;

    if (targetPath && directFileContent !== undefined) {
      const rawDiff = await getFileDiff(repoRoot, targetPath, req.baseRef);
      if (rawDiff.trim()) {
        const header = `--- git diff ${targetPath} ---\n`;
        const maxDiffBytes = Math.min(MAX_DIFF_SECTION_BYTES, Math.floor(totalBudgetRemaining * 0.4));
        let body = rawDiff.trimEnd();
        if (Buffer.byteLength(body, 'utf-8') > maxDiffBytes) {
          body = body.slice(0, maxDiffBytes) + '\n... [diff truncated]';
        }
        const chunk = `${header}${body}`;
        diffChunks.push(chunk);
        totalBudgetRemaining -= Buffer.byteLength(chunk, 'utf-8') + 2;
      }

      const fileCap = Math.max(1024, totalBudgetRemaining - 128);
      const formatted = formatLineNumberedSnippet(directFileContent, fileCap);
      packedFiles.push({
        path: targetPath,
        totalLines: formatted.totalLines,
        truncated: formatted.truncated,
        numberedContent: formatted.numberedContent,
      });
      if (formatted.truncated) {
        truncatedPaths.push(targetPath);
      }
    } else {
      const tracked = await listTrackedFiles(repoRoot);
      const allKnown = Array.from(new Set([...tracked.map(normalizePosixPath), ...changedFiles]));
      const scoped = targetPath
        ? allKnown.filter((f) => f === targetPath || f.startsWith(`${targetPath}/`))
        : allKnown;

      const nonAsset = scoped.filter((f) => classifyRunnerFile(f) !== 'asset');
      const codeOnly = nonAsset.filter((f) => classifyRunnerFile(f) === 'code');
      const pool = codeOnly.length > 0 ? codeOnly : nonAsset;
      const ranked = rankNodeCandidateFiles(pool, changedSet);
      const selected = ranked.slice(0, MAX_NODE_DIRECTORY_FILES);
      if (ranked.length > selected.length) {
        truncatedPaths.push(...ranked.slice(MAX_NODE_DIRECTORY_FILES));
      }

      // Include compact diffs for changed files inside this node scope first
      let diffBudgetRemaining = Math.min(8 * 1024, Math.floor(totalBudgetRemaining * 0.3));
      for (const relPath of selected) {
        if (!changedSet.has(relPath) || diffBudgetRemaining <= 256) continue;
        const rawDiff = await getFileDiff(repoRoot, relPath, req.baseRef);
        if (!rawDiff.trim()) continue;
        const header = `--- git diff ${relPath} ---\n`;
        let body = rawDiff.trimEnd();
        if (Buffer.byteLength(body, 'utf-8') > diffBudgetRemaining) {
          body = body.slice(0, diffBudgetRemaining) + '\n... [diff truncated]';
        }
        const chunk = `${header}${body}`;
        const bytes = Buffer.byteLength(chunk, 'utf-8') + 2;
        diffChunks.push(chunk);
        diffBudgetRemaining -= bytes;
        totalBudgetRemaining -= bytes;
      }

      for (const relPath of selected) {
        if (totalBudgetRemaining <= 384) {
          truncatedPaths.push(relPath);
          continue;
        }
        const content = await readFileAtRef(repoRoot, relPath, 'WORKTREE');
        if (content === undefined) continue;

        const perFileCap = Math.min(
          MAX_SINGLE_FILE_BYTES,
          Math.max(512, totalBudgetRemaining - 128)
        );
        const formatted = formatLineNumberedSnippet(content, perFileCap);
        packedFiles.push({
          path: relPath,
          totalLines: formatted.totalLines,
          truncated: formatted.truncated,
          numberedContent: formatted.numberedContent,
        });
        if (formatted.truncated) {
          truncatedPaths.push(relPath);
        }
        totalBudgetRemaining -= Buffer.byteLength(formatted.numberedContent, 'utf-8') + 96;
      }
    }
  }

  const diffSection =
    diffChunks.length > 0 ? diffChunks.join('\n\n') : '(no git diff changes against baseRef)';
  const filesSection = packedFiles
    .map(
      (f) =>
        `=== FILE: ${f.path} (totalLines: ${f.totalLines}${f.truncated ? ', truncated' : ''}) ===\n${f.numberedContent}`
    )
    .join('\n\n');

  return {
    git,
    changedFiles,
    diffSection,
    filesSection,
    packedFiles,
    truncatedPaths,
  };
}

function buildInitialPrompt(req: AnalyzeRequest, ctx: PackedAnalysisContext): string {
  const lang = req.lang ?? 'zh';
  const languageDirective =
    lang === 'en'
      ? 'Write human-readable prose fields (`title`, `summary`, claim `title`/`statement`, `condition`/`outcome`, `description`, `blindSpots`) in concise English.'
      : '请使用清晰、简洁的中文撰写人类可读字段（`title`、`summary`、`claims` 的 `title`/`statement`、`blockingConditions`、`impacts`、`blindSpots`、`verificationSignals.description`）。';

  const targetDescription =
    req.scope === 'branch'
      ? `Branch causal diff analysis on branch "${ctx.git.branch}" (HEAD ${ctx.git.shortSha}) vs baseRef "${req.baseRef}"`
      : `Module/Node analysis for ${req.nodeKind ?? 'module'} "${req.nodeTitle ?? (req.nodePath || 'root')}"${req.nodePath ? ` (path: ${req.nodePath})` : ''} on branch "${ctx.git.branch}"`;

  const baseRefFieldLine =
    req.scope === 'branch' ? `  "baseRef": ${JSON.stringify(req.baseRef)},\n` : '';

  const changedRule =
    req.scope === 'branch'
      ? ctx.changedFiles.length > 0
        ? `- Changed files in git diff (${ctx.changedFiles.length}): ${ctx.changedFiles.join(', ')}.\n- Set \`"expectChanged": true\` ONLY on claims anchored to files in that changed-files list. If you include \`impacts[]\`, \`sourceAnchor.path\` MUST also be one of those changed files.`
        : `- No files differ from \`${req.baseRef}\` right now: set \`"expectChanged": false\` on all claims and leave \`"impacts": []\`.`
      : `- Omit \`baseRef\` (or leave unset) and set \`"expectChanged": false\` unless specifically claiming a diff.`;

  const depthGuidance =
    req.depth === 'flow'
      ? `- Depth Mode: **L2 Flow & Collaboration ("flow")**. Focus ONLY on 3–5 core call chains / collaboration flows across the module's key files (\`claims[]\`). Keep \`"blockingConditions": []\` and \`"impacts": []\` empty unless critical, avoiding line-by-line edge-case overload.`
      : `- Depth Mode: **L3 Deep Verification ("deep")**. Include key behavioral \`claims[]\`, explicit guard/edge-case \`blockingConditions[]\`, cross-boundary \`impacts[]\`, and architectural \`blindSpots[]\`.`;

  return [
    `You are CodeAtlas's deterministic verification briefing generator.`,
    `Do NOT invoke shell commands, tools, or markdown prose. Output ONLY a single raw JSON object matching \`BriefingReport\` (\`schemaVersion: "0.2"\`).`,
    languageDirective,
    ``,
    `## Target`,
    `- Scope: ${targetDescription}`,
    depthGuidance,
    `- Repository Root: ${ctx.git.repoRoot}`,
    `- Target Ref: "WORKTREE"`,
    ``,
    `## Strict Deterministic Anchor Rules (Verified by CodeAtlas Verifier)`,
    `- Every source file below is prefixed with exact 1-based line numbers (\`1: ...\`, \`2: ...\`).`,
    `- Every \`EvidenceAnchor\` (\`claims[].anchors[]\`, \`blockingConditions[].anchor\`, \`impacts[].sourceAnchor\`, \`impacts[].targetAnchor\`) MUST use:`,
    `  1. \`path\`: exact POSIX relative path from the \`=== FILE: <path> ===\` header below.`,
    `  2. \`startLine\` & \`endLine\`: exact 1-based integer line numbers copied from the \`N: \` prefixes (\`1 <= startLine <= endLine <= totalLines\`).`,
    `  3. \`symbol\`: an exact identifier or code substring that literally appears on lines \`startLine..endLine\` of that file (never invent or paraphrase symbols!).`,
    `- Use \`"claimType": "fact"\` for all code-evidenced claims so deterministic verification marks them \`verified\`.`,
    changedRule,
    `- For \`verificationSignals[]\`, report static/test status honestly (use \`"status": "not-run"\` for tests not executed here).`,
    ``,
    `## Required JSON Schema`,
    `{`,
    `  "schemaVersion": "0.2",`,
    `  "title": "string",`,
    baseRefFieldLine + `  "targetRef": "WORKTREE",`,
    `  "summary": "string",`,
    `  "blockingConditions": [`,
    `    { "id": "B1", "condition": "string", "outcome": "string", "anchor": { "path": "string", "startLine": 1, "endLine": 2, "symbol": "exactSubstring" } }`,
    `  ],`,
    `  "claims": [`,
    `    {`,
    `      "id": "C1",`,
    `      "title": "string",`,
    `      "statement": "string",`,
    `      "claimType": "fact",`,
    `      "expectChanged": ${req.scope === 'branch' && ctx.changedFiles.length > 0 ? 'true' : 'false'},`,
    `      "anchors": [`,
    `        { "path": "string", "startLine": 1, "endLine": 3, "symbol": "exactIdentifier" }`,
    `      ]`,
    `    }`,
    `  ],`,
    `  "impacts": [`,
    `    {`,
    `      "id": "I1",`,
    `      "relation": "ipc | event | schema | runtime | other",`,
    `      "description": "string",`,
    `      "sourceAnchor": { "path": "string", "startLine": 1, "endLine": 2, "symbol": "exactIdentifier" },`,
    `      "targetAnchor": { "path": "string", "startLine": 1, "endLine": 2, "symbol": "exactIdentifier" }`,
    `    }`,
    `  ],`,
    `  "blindSpots": ["string"],`,
    `  "verificationSignals": [`,
    `    { "kind": "unit-test | integration-test | typecheck | lint | manual | other", "status": "not-run", "description": "string" }`,
    `  ]`,
    `}`,
    ``,
    `## Git Diff`,
    ctx.diffSection,
    ``,
    `## Line-Numbered Source Files (1-based)`,
    ctx.filesSection || '(no readable source files found in scope)',
  ].join('\n');
}

export function collectMismatchNotes(verification: BriefingVerificationResult): string[] {
  const notes: string[] = [];

  for (const c of verification.claims) {
    if (c.badge !== 'mismatch') continue;
    for (const n of c.notes) {
      notes.push(`[Claim ${c.claim.id}] ${n}`);
    }
    for (const a of c.anchors) {
      if (a.badge !== 'mismatch') continue;
      const loc = `${a.anchor.path}:${a.anchor.startLine ?? '?'}-${a.anchor.endLine ?? '?'}${
        a.anchor.symbol ? ` (symbol="${a.anchor.symbol}")` : ''
      }`;
      notes.push(`[Claim ${c.claim.id} -> ${loc}] ${a.notes.join(' ')}`);
    }
  }

  for (const b of verification.blockingConditions) {
    if (b.badge !== 'mismatch') continue;
    if (b.anchorResult) {
      const a = b.anchorResult;
      const loc = `${a.anchor.path}:${a.anchor.startLine ?? '?'}-${a.anchor.endLine ?? '?'}${
        a.anchor.symbol ? ` (symbol="${a.anchor.symbol}")` : ''
      }`;
      notes.push(`[BlockingCondition ${b.item.id} -> ${loc}] ${a.notes.join(' ')}`);
    } else {
      notes.push(`[BlockingCondition ${b.item.id}] Anchor verification failed.`);
    }
  }

  for (const imp of verification.impacts) {
    if (imp.badge !== 'mismatch') continue;
    if (imp.sourceResult?.badge === 'mismatch') {
      const a = imp.sourceResult;
      const loc = `${a.anchor.path}:${a.anchor.startLine ?? '?'}-${a.anchor.endLine ?? '?'}${
        a.anchor.symbol ? ` (symbol="${a.anchor.symbol}")` : ''
      }`;
      notes.push(`[Impact ${imp.item.id} sourceAnchor -> ${loc}] ${a.notes.join(' ')}`);
    }
    if (imp.targetResult?.badge === 'mismatch') {
      const a = imp.targetResult;
      const loc = `${a.anchor.path}:${a.anchor.startLine ?? '?'}-${a.anchor.endLine ?? '?'}${
        a.anchor.symbol ? ` (symbol="${a.anchor.symbol}")` : ''
      }`;
      notes.push(`[Impact ${imp.item.id} targetAnchor -> ${loc}] ${a.notes.join(' ')}`);
    }
    if (imp.sourceResult?.badge !== 'mismatch' && imp.targetResult?.badge !== 'mismatch') {
      notes.push(`[Impact ${imp.item.id}] ${imp.notes.join(' ')}`);
    }
  }

  return notes;
}

function buildRetryPrompt(
  req: AnalyzeRequest,
  ctx: PackedAnalysisContext,
  previousBriefing: BriefingReport,
  mismatchNotes: string[],
  extraFilesSection: string
): string {
  return [
    `Your previous BriefingReport JSON failed CodeAtlas deterministic verification with \`overallBadge: "mismatch"\`.`,
    `Fix EVERY mismatch error listed below using the exact 1-based line numbers (\`1: ...\`, \`2: ...\`) and verbatim symbols from the packed source files.`,
    `Output ONLY the corrected raw JSON object matching \`BriefingReport\` (\`schemaVersion: "0.2"\`, \`targetRef: "WORKTREE"\`${
      req.scope === 'branch' ? `, \`baseRef: ${JSON.stringify(req.baseRef)}\`` : ''
    }). Do NOT include markdown prose.`,
    ``,
    `## Deterministic Verification Mismatch Errors`,
    ...mismatchNotes.map((n, idx) => `${idx + 1}. ${n}`),
    ``,
    `## Previous Briefing JSON (Fix invalid paths, line ranges, and symbols)`,
    JSON.stringify(previousBriefing, null, 2),
    ``,
    `## Line-Numbered Source Files (1-based)`,
    ctx.filesSection,
    ...(extraFilesSection ? [``, extraFilesSection] : []),
  ].join('\n');
}

export function stripMarkdownJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const match = /^```(?:json|JSON)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/.exec(trimmed);
    if (match) {
      return match[1].trim();
    }
  }
  const embedded = /```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n```/.exec(trimmed);
  if (embedded) {
    return embedded[1].trim();
  }
  return trimmed;
}

function normalizeAnchor(raw: unknown): EvidenceAnchor | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.path !== 'string' || !obj.path.trim()) return undefined;
  const anchor: EvidenceAnchor = {
    path: normalizePosixPath(obj.path.trim()),
  };
  if (typeof obj.startLine === 'number' && Number.isFinite(obj.startLine)) {
    anchor.startLine = Math.trunc(obj.startLine);
  }
  if (typeof obj.endLine === 'number' && Number.isFinite(obj.endLine)) {
    anchor.endLine = Math.trunc(obj.endLine);
  }
  if (typeof obj.symbol === 'string' && obj.symbol.trim()) {
    anchor.symbol = obj.symbol.trim();
  }
  if (typeof obj.excerpt === 'string' && obj.excerpt.trim()) {
    anchor.excerpt = obj.excerpt;
  }
  return anchor;
}

export function parseBriefingResponse(raw: string, req: AnalyzeRequest): BriefingReport {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Analyzer returned an empty response.');
  }

  const candidates: string[] = [trimmed];
  const stripped = stripMarkdownJsonFences(trimmed);
  if (stripped !== trimmed && !candidates.includes(stripped)) {
    candidates.push(stripped);
  }
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = stripped.slice(firstBrace, lastBrace + 1);
    if (!candidates.includes(sliced)) {
      candidates.push(sliced);
    }
  }

  let parsed: unknown;
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'not an object');
    throw new Error(`Failed to parse BriefingReport JSON from analyzer output: ${detail}`);
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.claims)) {
    throw new Error('Invalid BriefingReport JSON: missing `claims` array.');
  }

  const claims: BriefingClaim[] = obj.claims
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
    .map((c, idx) => {
      const claimType =
        c.claimType === 'fact' || c.claimType === 'inference' || c.claimType === 'unknown'
          ? c.claimType
          : 'fact';
      const rawAnchors = Array.isArray(c.anchors) ? c.anchors : [];
      const anchors = rawAnchors
        .map(normalizeAnchor)
        .filter((a): a is EvidenceAnchor => a !== undefined);
      return {
        id: typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `C${idx + 1}`,
        title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : `Claim ${idx + 1}`,
        statement: typeof c.statement === 'string' ? c.statement : '',
        claimType,
        expectChanged: typeof c.expectChanged === 'boolean' ? c.expectChanged : undefined,
        anchors,
      };
    });

  const blockingConditions: BlockingCondition[] | undefined = Array.isArray(obj.blockingConditions)
    ? obj.blockingConditions
        .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === 'object'))
        .map((b, idx) => ({
          id: typeof b.id === 'string' && b.id.trim() ? b.id.trim() : `B${idx + 1}`,
          condition: typeof b.condition === 'string' ? b.condition : '',
          outcome: typeof b.outcome === 'string' ? b.outcome : '',
          anchor: normalizeAnchor(b.anchor),
        }))
    : undefined;

  const validRelations = new Set(['ipc', 'event', 'schema', 'runtime', 'other']);
  const impacts: DeclaredImpact[] | undefined = Array.isArray(obj.impacts)
    ? obj.impacts
        .filter((imp): imp is Record<string, unknown> => Boolean(imp && typeof imp === 'object'))
        .map((imp, idx) => {
          const sourceAnchor = normalizeAnchor(imp.sourceAnchor);
          const targetAnchor = normalizeAnchor(imp.targetAnchor);
          if (!sourceAnchor || !targetAnchor) return undefined;
          const rel =
            typeof imp.relation === 'string' && validRelations.has(imp.relation)
              ? (imp.relation as DeclaredImpact['relation'])
              : 'other';
          return {
            id: typeof imp.id === 'string' && imp.id.trim() ? imp.id.trim() : `I${idx + 1}`,
            relation: rel,
            description: typeof imp.description === 'string' ? imp.description : '',
            sourceAnchor,
            targetAnchor,
          };
        })
        .filter((imp): imp is DeclaredImpact => imp !== undefined)
    : undefined;

  const validSignalKinds = new Set([
    'unit-test',
    'integration-test',
    'typecheck',
    'lint',
    'manual',
    'other',
  ]);
  const validSignalStatuses = new Set(['passed', 'failed', 'not-run', 'unknown']);
  const verificationSignals: VerificationSignal[] | undefined = Array.isArray(
    obj.verificationSignals
  )
    ? obj.verificationSignals
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
        .map((s) => ({
          kind:
            typeof s.kind === 'string' && validSignalKinds.has(s.kind)
              ? (s.kind as VerificationSignal['kind'])
              : 'other',
          status:
            typeof s.status === 'string' && validSignalStatuses.has(s.status)
              ? (s.status as VerificationSignal['status'])
              : 'not-run',
          command: typeof s.command === 'string' ? s.command : undefined,
          description: typeof s.description === 'string' ? s.description : '',
          evidencePath: typeof s.evidencePath === 'string' ? s.evidencePath : undefined,
        }))
    : undefined;

  const blindSpots: string[] | undefined = Array.isArray(obj.blindSpots)
    ? obj.blindSpots.filter((x): x is string => typeof x === 'string')
    : undefined;

  const schemaVersion =
    obj.schemaVersion === '0.1' || obj.schemaVersion === '0.2' ? obj.schemaVersion : '0.2';

  const defaultTitle =
    req.scope === 'branch'
      ? `Branch Briefing (${req.baseRef} -> WORKTREE)`
      : `Module Briefing: ${req.nodeTitle ?? (req.nodePath || 'Repository')}`;

  const baseRef =
    typeof obj.baseRef === 'string' && obj.baseRef.trim()
      ? obj.baseRef.trim()
      : req.scope === 'branch'
        ? req.baseRef
        : undefined;

  return {
    schemaVersion,
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : defaultTitle,
    author:
      typeof obj.author === 'string' && obj.author.trim()
        ? obj.author.trim()
        : `codeatlas:${req.config.provider}`,
    baseRef,
    targetRef:
      typeof obj.targetRef === 'string' && obj.targetRef.trim()
        ? obj.targetRef.trim()
        : 'WORKTREE',
    depth: req.depth === 'flow' ? 'flow' : 'deep',
    scopePath: req.nodePath ? normalizePosixPath(req.nodePath) : undefined,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    blockingConditions,
    claims,
    impacts,
    verificationSignals,
    blindSpots,
  };
}

async function executeOpenAiCompatible(prompt: string, config: AnalyzerConfig): Promise<string> {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error(
      'Missing apiKey for "openai-compatible" analyzer provider. Configure `codeatlas.analyzer.apiKey` or select a CLI provider.'
    );
  }

  const baseUrl = (config.apiBaseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = config.model?.trim() || 'gpt-4.1';
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'You are CodeAtlas deterministic static verification analyzer. Output ONLY a valid JSON object matching BriefingReport (schemaVersion "0.2").',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(
      `OpenAI-compatible endpoint failed (${response.status} ${response.statusText}): ${errBody.slice(0, 400)}`
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }

  throw new Error('OpenAI-compatible endpoint returned no message content.');
}

function resolveCliInvocation(config: AnalyzerConfig): { command: string; args: string[] } {
  const customCmd = config.cliCommand?.trim();
  switch (config.provider) {
    case 'cli-claude':
      return {
        command: customCmd || 'claude',
        args: ['-p', '--output-format', 'text'],
      };
    case 'cli-codex':
      return {
        command: customCmd || 'codex',
        args: ['exec', '-s', 'read-only', '--ephemeral', '-'],
      };
    case 'cli-gemini':
      return {
        command: customCmd || 'gemini',
        args: ['-p', ''],
      };
    default:
      throw new Error(`Unsupported CLI provider: ${String(config.provider)}`);
  }
}

async function executeCliProvider(
  prompt: string,
  repoRoot: string,
  config: AnalyzerConfig
): Promise<string> {
  const { command, args } = resolveCliInvocation(config);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Analyzer CLI "${command}" timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.stdin.on('error', () => {
      // Ignore EPIPE when child exits before reading full stdin; close handler reports exit code.
    });

    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to spawn analyzer CLI "${command}": ${err.message}`));
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (code !== 0) {
        const detail = stderr || stdout || `exit code ${String(code)}`;
        reject(
          new Error(`Analyzer CLI "${command}" exited with code ${String(code)}: ${detail.slice(0, 500)}`)
        );
        return;
      }

      if (!stdout) {
        reject(
          new Error(
            `Analyzer CLI "${command}" produced empty stdout${stderr ? ` (stderr: ${stderr.slice(0, 300)})` : ''}.`
          )
        );
        return;
      }

      resolve(stdout);
    });

    child.stdin.end(prompt, 'utf-8');
  });
}

async function runAnalyzerExecutor(
  prompt: string,
  repoRoot: string,
  req: AnalyzeRequest
): Promise<string> {
  if (req.executorOverride) {
    return req.executorOverride(prompt);
  }
  if (req.config.provider === 'openai-compatible') {
    return executeOpenAiCompatible(prompt, req.config);
  }
  return executeCliProvider(prompt, repoRoot, req.config);
}

async function buildExtraMismatchFilesSection(
  repoRoot: string,
  ctx: PackedAnalysisContext,
  verification: BriefingVerificationResult
): Promise<string> {
  const alreadyPacked = new Set(ctx.packedFiles.map((f) => f.path));
  const referencedPaths = new Set<string>();

  for (const c of verification.claims) {
    for (const a of c.anchors) {
      if (a.badge === 'mismatch' && a.fileExists) {
        referencedPaths.add(normalizePosixPath(a.anchor.path));
      }
    }
  }
  for (const b of verification.blockingConditions) {
    if (b.badge === 'mismatch' && b.anchorResult?.fileExists) {
      referencedPaths.add(normalizePosixPath(b.anchorResult.anchor.path));
    }
  }
  for (const imp of verification.impacts) {
    if (imp.sourceResult?.badge === 'mismatch' && imp.sourceResult.fileExists) {
      referencedPaths.add(normalizePosixPath(imp.sourceResult.anchor.path));
    }
    if (imp.targetResult?.badge === 'mismatch' && imp.targetResult.fileExists) {
      referencedPaths.add(normalizePosixPath(imp.targetResult.anchor.path));
    }
  }

  const extraSnippets: string[] = [];
  let extraBudget = 8 * 1024;
  for (const relPath of Array.from(referencedPaths)) {
    if (alreadyPacked.has(relPath) || extraBudget <= 512) continue;
    const content = await readFileAtRef(repoRoot, relPath, 'WORKTREE');
    if (content === undefined) continue;
    const formatted = formatLineNumberedSnippet(content, Math.min(4 * 1024, extraBudget));
    const block = `=== FILE: ${relPath} (totalLines: ${formatted.totalLines}${formatted.truncated ? ', truncated' : ''}) ===\n${formatted.numberedContent}`;
    extraSnippets.push(block);
    extraBudget -= Buffer.byteLength(block, 'utf-8');
  }

  return extraSnippets.join('\n\n');
}

export async function runClickToAnalyze(req: AnalyzeRequest): Promise<StoredBriefingRecord> {
  req.onProgress?.('context');
  const ctx = await packAnalysisContext(req);
  const repoRoot = ctx.git.repoRoot;
  const initialPrompt = buildInitialPrompt(req, ctx);

  req.onProgress?.('analyzing');
  const rawInitial = await runAnalyzerExecutor(initialPrompt, repoRoot, req);
  let finalBriefing = parseBriefingResponse(rawInitial, req);

  req.onProgress?.('verifying');
  let finalVerification = await verifyBriefing(repoRoot, finalBriefing);

  if (finalVerification.overallBadge === 'mismatch') {
    const mismatchNotes = collectMismatchNotes(finalVerification);
    const extraFiles = await buildExtraMismatchFilesSection(repoRoot, ctx, finalVerification);
    const retryPrompt = buildRetryPrompt(req, ctx, finalBriefing, mismatchNotes, extraFiles);

    req.onProgress?.('retrying');
    const rawRetry = await runAnalyzerExecutor(retryPrompt, repoRoot, req);
    finalBriefing = parseBriefingResponse(rawRetry, req);

    req.onProgress?.('verifying');
    finalVerification = await verifyBriefing(repoRoot, finalBriefing);
  }

  req.onProgress?.('saving');
  return saveBriefingRecord(repoRoot, finalBriefing, finalVerification);
}

// ---------------------------------------------------------------------------
// L1 Progressive Overview Runner (`runClickToOutline`) & Q&A Consultation
// ---------------------------------------------------------------------------

export async function runClickToOutline(req: AnalyzeRequest): Promise<StoredOutlineRecord> {
  req.onProgress?.('context');
  const git = await getGitContext(req.repoRoot);
  const repoRoot = git.repoRoot;
  const scopePath = normalizePosixPath(req.nodePath ?? '');
  const tracked = (await listTrackedFiles(repoRoot)).map(normalizePosixPath);

  const scopedFiles = scopePath
    ? tracked.filter((f) => f === scopePath || f.startsWith(`${scopePath}/`))
    : tracked;

  const nonAssets = scopedFiles.filter((f) => classifyRunnerFile(f) !== 'asset');
  const ranked = rankNodeCandidateFiles(nonAssets, new Set()).slice(0, 22);

  const headerBlocks: string[] = [];
  for (const rel of ranked) {
    const content = await readFileAtRef(repoRoot, rel, 'WORKTREE');
    if (!content) continue;
    const headLines = content.split(/\r?\n/).slice(0, 38).join('\n');
    headerBlocks.push(`=== FILE: ${rel} ===\n${headLines}`);
  }

  const lang = req.lang ?? 'zh';
  const langRule =
    lang === 'en'
      ? 'Write `title`, `summary`, and each `children[].summary` in concise 1-sentence English.'
      : '请用精炼的一句话中文编写 `title`、`summary` 以及每个 `children[].summary`（直击文件职责，不要废话）。';

  const prompt = [
    `You are CodeAtlas's L1 Module Tour generator. Do NOT analyze line-by-line edge cases.`,
    `Output ONLY a single raw JSON object matching \`ModuleOutlineReport\` (\`schemaVersion: "0.2"\`).`,
    langRule,
    ``,
    `## Target Scope`,
    `- Scope Path: "${scopePath}"`,
    `- Candidate Files in Scope (${ranked.length}): ${ranked.join(', ')}`,
    ``,
    `## Rules`,
    `- \`scopePath\` MUST be "${scopePath}".`,
    `- Every \`children[].path\` MUST be copied verbatim from the Candidate Files list above.`,
    `- \`recommendedEntry\` (optional) MUST be one of the Candidate Files that a newcomer should read first.`,
    `- Keep each \`children[].summary\` under 45 characters so it fits cleanly on a compact IDE file card.`,
    ``,
    `## Required JSON Schema`,
    `{`,
    `  "schemaVersion": "0.2",`,
    `  "scopePath": ${JSON.stringify(scopePath)},`,
    `  "targetRef": "WORKTREE",`,
    `  "title": "string",`,
    `  "summary": "1-2 sentence overview of what this directory/module owns",`,
    `  "recommendedEntry": "exact/path/from/list",`,
    `  "children": [`,
    `    { "path": "exact/path/from/list", "summary": "concise 1-sentence file role", "role": "entry | core | types | util | test | config" }`,
    `  ]`,
    `}`,
    ``,
    `## File Headers`,
    headerBlocks.join('\n\n') || '(no source files)',
  ].join('\n');

  req.onProgress?.('analyzing');
  const raw = await runAnalyzerExecutor(prompt, repoRoot, req);
  const stripped = stripMarkdownJsonFences(raw);
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  const jsonSlice =
    firstBrace >= 0 && lastBrace > firstBrace ? stripped.slice(firstBrace, lastBrace + 1) : stripped;
  const parsed = JSON.parse(jsonSlice) as Record<string, unknown>;

  const validSet = new Set(scopedFiles);
  const rawChildren = Array.isArray(parsed.children) ? parsed.children : [];
  const children: FileRoleItem[] = rawChildren
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
    .map((c): FileRoleItem => ({
      path: normalizePosixPath(String(c.path ?? '')),
      summary: String(c.summary ?? '').trim(),
      role:
        c.role === 'entry' ||
        c.role === 'core' ||
        c.role === 'types' ||
        c.role === 'util' ||
        c.role === 'test' ||
        c.role === 'config'
          ? (c.role as FileRoleItem['role'])
          : undefined,
    }))
    .filter((c) => c.path && c.summary && validSet.has(c.path));

  const rawRec =
    typeof parsed.recommendedEntry === 'string'
      ? normalizePosixPath(parsed.recommendedEntry)
      : undefined;

  const outline: ModuleOutlineReport = {
    schemaVersion: '0.2',
    scopePath,
    targetRef: 'WORKTREE',
    title:
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : req.nodeTitle || scopePath || 'Repository Overview',
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : '',
    recommendedEntry: rawRec && validSet.has(rawRec) ? rawRec : children[0]?.path,
    children,
  };

  req.onProgress?.('verifying');
  const verification = await verifyOutline(repoRoot, outline);
  req.onProgress?.('saving');
  return saveOutlineRecord(repoRoot, outline, verification);
}

export async function runDirectiveQuestion(params: {
  repoRoot: string;
  directive: AnnotationDirective;
  config: AnalyzerConfig;
  lang?: 'zh' | 'en';
  executorOverride?: (prompt: string) => Promise<string>;
}): Promise<string> {
  const { repoRoot, directive, config, lang = 'zh' } = params;
  const relPath = normalizePosixPath(directive.path);
  const content = relPath ? await readFileAtRef(repoRoot, relPath, 'WORKTREE') : undefined;
  let snippetBlock = '(no source file attached)';
  if (content !== undefined) {
    const formatted = formatLineNumberedSnippet(content, 12 * 1024);
    snippetBlock = `=== FILE: ${relPath} ===\n${formatted.numberedContent}`;
  }

  const prompt = [
    `You are CodeAtlas's anchored code Q&A assistant. Do NOT run shell commands.`,
    lang === 'en'
      ? `Answer the user's anchored question concisely and accurately (2-5 sentences) citing exact line numbers/symbols.`
      : `请基于下方真实源码，用简明准确的中文（2-5句话，引用具体符号或行号）直接回答用户在画布节点上提出的疑问。仅输出纯文本解答，不要包裹 JSON。`,
    ``,
    `## Anchored Question`,
    `- Path: ${relPath || '(module)'}${directive.startLine ? `:${directive.startLine}` : ''}`,
    `- Kind: ${directive.kind}`,
    `- User Note: ${directive.note}`,
    ``,
    `## Source Context`,
    snippetBlock,
  ].join('\n');

  const dummyReq: AnalyzeRequest = {
    repoRoot,
    scope: 'node',
    baseRef: 'HEAD',
    config,
    executorOverride: params.executorOverride,
  };
  const rawAnswer = (await runAnalyzerExecutor(prompt, repoRoot, dummyReq)).trim();
  if (directive.kind !== 'rework') {
    await ackDirective(repoRoot, {
      id: directive.id,
      expectedRevision: directive.revision || 1,
      agentId: `codeatlas:${config.provider}`,
      summary: rawAnswer,
    });
  }
  return rawAnswer;
}
