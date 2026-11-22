import {
  AnnotationDirective,
  AtlasManifest,
  BriefingVerificationResult,
  ClaimType,
  DiffFileStat,
  GitContext,
  IndirectImpactReport,
  ManifestDriftIssue,
  StorageMode,
  VerificationBadge,
  VerificationSignal,
} from './types.js';
import { matchDomainForPath } from './manifest.js';
import {
  analyzeRepositoryArchitecture,
  classifyFileArtifact,
  IndexedDomain,
  ProjectScale,
  RepoArchitecture,
} from './indexer.js';
import { BranchCommitInfo } from './git.js';
import { StoredOutlineRecord } from './store.js';
import { ScopeBoundaryItem } from './workspace.js';

export type CanvasViewMode = 'hybrid' | 'atlas' | 'briefing';

export type CanvasNodeKind =
  | 'root'
  | 'domain'
  | 'folder'
  | 'entrypoint'
  | 'claim'
  | 'blocking'
  | 'evidence'
  | 'diff-file'
  | 'file'
  | 'impact'
  | 'directive'
  | 'external-dep';

export type CanvasEdgeKind =
  | 'hierarchy'
  | 'flow'
  | 'blocking'
  | 'impact'
  | 'directive'
  | 'dep'
  | 'external';

export type CompletedDepth = 'none' | 'overview' | 'flow' | 'deep';

export interface AtlasGraphNode {
  id: string;
  parentId?: string;
  kind: CanvasNodeKind;
  title: string;
  subtitle?: string;
  body?: string;
  badge?: VerificationBadge;
  layer?: string;
  domainId?: string;
  folderId?: string;
  /** Canonical directory path if this node can be set as Scope Root */
  scopePath?: string;
  /** L1 in-place 1-sentence responsibility hydrated onto compact file/folder rows */
  roleSummary?: string;
  /** Highlighted by L1 outline as the recommended entry file */
  isRecommendedEntry?: boolean;
  /** Highest progressive analysis depth completed for this node/scope */
  completedDepth?: CompletedDepth;
  externalOutCount?: number;
  externalInCount?: number;
  externalDirection?: 'outbound' | 'inbound';
  fileCount?: number;
  canExpandFiles?: boolean;
  filesExpanded?: boolean;
  isSummary?: boolean;
  isSupport?: boolean;
  claimType?: ClaimType;
  condition?: string;
  outcome?: string;
  directiveId?: string;
  directiveKind?: 'constraint' | 'question' | 'rework';
  directiveStatus?: 'open' | 'claimed' | 'resolved' | 'dismissed';
  resolutionSummary?: string;
  path?: string;
  defaultDirectivePath?: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  changed?: boolean;
  additions?: number;
  deletions?: number;
  notes?: string[];
  fromBriefing?: boolean;
}

export interface AtlasGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: CanvasEdgeKind;
  label?: string;
}

export interface ImpactedDomainSummary {
  domainId: string;
  nodeId: string;
  name: string;
  layer?: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export interface BranchSummary {
  branch: string;
  baseRef: string;
  commits: BranchCommitInfo[];
  impactedDomains: ImpactedDomainSummary[];
  briefingTitle?: string;
  briefingSummary?: string;
  claimItems: Array<{ id: string; nodeId: string; title: string; badge: VerificationBadge }>;
}

export interface ScopeAncestorCrumb {
  label: string;
  scopePath: string;
}

export interface AtlasGraphData {
  mode: CanvasViewMode;
  scopeRoot: string;
  scopeAncestors: ScopeAncestorCrumb[];
  storageMode: StorageMode;
  nodes: AtlasGraphNode[];
  edges: AtlasGraphEdge[];
  architecture: {
    scale: ProjectScale;
    totalFiles: number;
    patternId: string;
    patternLabelZh: string;
    patternLabelEn: string;
    domainCount: number;
    hasManifest: boolean;
  };
  branchSummary: BranchSummary;
  summary: {
    verified: number;
    mismatch: number;
    stale: number;
    unverified: number;
    unknown: number;
    blockingCount: number;
    blockingMismatch: number;
    changedFiles: number;
    directiveCount: number;
    openDirectiveCount: number;
    isStale: boolean;
    targetRefClaimed?: string;
    baseRef: string;
    signals: VerificationSignal[];
    blindSpots: string[];
    guardrails: string[];
    hasBriefing: boolean;
    prunedCount: number;
    impactCount: number;
    externalBoundaryCount: number;
    impactStatus?: IndirectImpactReport['status'];
    impactReason?: string;
    manifestIssues: ManifestDriftIssue[];
    hiddenSupportDomains: number;
    hiddenSupportFiles: number;
  };
}

function normalizeCleanPath(raw?: string): string {
  return String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * Strips domain prefix and compresses single-child directory wrappers like `src/`.
 */
function groupFilesBySubdirectory(
  files: string[],
  domainPrefix: string
): Array<{ groupKey: string; label: string; files: string[] }> {
  const cleanPrefix = domainPrefix ? `${domainPrefix.replace(/\/+$/, '')}/` : '';
  let rels = files.map((f) => ({
    full: f,
    rel: cleanPrefix && f.startsWith(cleanPrefix) ? f.slice(cleanPrefix.length) : f,
  }));

  let compressedPrefix = '';
  for (let depth = 0; depth < 3; depth++) {
    const firstSegs = new Set<string>();
    let allHaveSubdir = true;
    for (const item of rels) {
      const idx = item.rel.indexOf('/');
      if (idx < 0) {
        allHaveSubdir = false;
        break;
      }
      firstSegs.add(item.rel.slice(0, idx));
    }
    if (allHaveSubdir && firstSegs.size === 1) {
      const onlySeg = [...firstSegs][0];
      compressedPrefix = compressedPrefix ? `${compressedPrefix}/${onlySeg}` : onlySeg;
      rels = rels.map((item) => ({
        full: item.full,
        rel: item.rel.slice(onlySeg.length + 1),
      }));
    } else {
      break;
    }
  }

  const map = new Map<string, string[]>();
  for (const item of rels) {
    const idx = item.rel.indexOf('/');
    const key = idx >= 0 ? item.rel.slice(0, idx) : '(root)';
    const arr = map.get(key) ?? [];
    arr.push(item.full);
    map.set(key, arr);
  }

  return [...map.entries()]
    .map(([key, list]) => ({
      groupKey: compressedPrefix && key !== '(root)' ? `${compressedPrefix}/${key}` : key,
      label:
        key === '(root)'
          ? compressedPrefix || '(root)'
          : compressedPrefix
            ? `${compressedPrefix}/${key}`
            : key,
      files: list,
    }))
    .sort((a, b) => b.files.length - a.files.length || a.label.localeCompare(b.label));
}

function sortFilesByImportance(
  files: string[],
  diffMap: Map<string, DiffFileStat>
): string[] {
  const kindWeight: Record<string, number> = {
    code: 0,
    test: 1,
    config: 2,
    ci: 2,
    docs: 3,
    asset: 4,
  };
  return [...files].sort((a, b) => {
    const ca = diffMap.has(a) ? 0 : 1;
    const cb = diffMap.has(b) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const ka = kindWeight[classifyFileArtifact(a)] ?? 5;
    const kb = kindWeight[classifyFileArtifact(b)] ?? 5;
    if (ka !== kb) return ka - kb;
    return a.localeCompare(b);
  });
}

function synthesizeScopedSubdomains(
  scopedFiles: string[],
  scopeRoot: string,
  lang: 'zh' | 'en'
): { subdomains: IndexedDomain[]; directRootFiles: string[] } {
  const prefix = `${scopeRoot}/`;
  const byFirstSeg = new Map<string, string[]>();
  const directRootFiles: string[] = [];

  for (const f of scopedFiles) {
    const rel = f.startsWith(prefix) ? f.slice(prefix.length) : f;
    const slash = rel.indexOf('/');
    if (slash < 0) {
      directRootFiles.push(f);
    } else {
      const seg = rel.slice(0, slash);
      const list = byFirstSeg.get(seg) ?? [];
      list.push(f);
      byFirstSeg.set(seg, list);
    }
  }

  // If there is only 1 subdirectory (e.g. `crates/aster-app/src/*`), unwrap one level so `src/` files fan out cleanly!
  if (byFirstSeg.size === 1) {
    const [onlySubdir, subFiles] = [...byFirstSeg.entries()][0];
    const nestedPrefix = `${scopeRoot}/${onlySubdir}/`;
    const nestedMap = new Map<string, string[]>();
    const nestedDirect: string[] = [...directRootFiles];

    for (const f of subFiles) {
      const rel = f.startsWith(nestedPrefix) ? f.slice(nestedPrefix.length) : f;
      const slash = rel.indexOf('/');
      if (slash < 0) {
        nestedDirect.push(f);
      } else {
        const seg = rel.slice(0, slash);
        const list = nestedMap.get(seg) ?? [];
        list.push(f);
        nestedMap.set(seg, list);
      }
    }

    if (nestedMap.size === 0) {
      return { subdomains: [], directRootFiles: scopedFiles };
    }

    const nestedDomains: IndexedDomain[] = [...nestedMap.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([seg, files]) => {
        const subPath = `${scopeRoot}/${onlySubdir}/${seg}`;
        return {
          id: `scoped:${subPath}`,
          name: `${onlySubdir}/${seg}`,
          layerRank: 50,
          description: `${files.length} ${lang === 'zh' ? '个文件' : 'files'}`,
          paths: [subPath],
          files,
          fileCount: files.length,
          entrypoints: [],
          fromManifest: false,
          isSupport: files.every((x) => {
            const k = classifyFileArtifact(x);
            return k === 'asset' || k === 'docs';
          }),
          artifactCounts: { code: files.length, test: 0, config: 0, ci: 0, docs: 0, asset: 0 },
        };
      });
    return { subdomains: nestedDomains, directRootFiles: nestedDirect };
  }

  if (byFirstSeg.size === 0) {
    return { subdomains: [], directRootFiles: scopedFiles };
  }

  const subdomains: IndexedDomain[] = [...byFirstSeg.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([seg, files]) => {
      const subPath = `${scopeRoot}/${seg}`;
      const nonCodeOnly = files.every((x) => {
        const k = classifyFileArtifact(x);
        return k === 'asset' || k === 'docs';
      });
      return {
        id: `scoped:${subPath}`,
        name: seg,
        layerRank: 50,
        description: `${subPath} · ${files.length} ${lang === 'zh' ? '个文件' : 'files'}`,
        paths: [subPath],
        files,
        fileCount: files.length,
        entrypoints: [],
        fromManifest: false,
        isSupport: nonCodeOnly,
        artifactCounts: { code: files.length, test: 0, config: 0, ci: 0, docs: 0, asset: 0 },
      };
    });

  return { subdomains, directRootFiles };
}

export function buildAtlasGraph(params: {
  git: GitContext;
  manifest?: AtlasManifest;
  manifestIssues?: ManifestDriftIssue[];
  archOverride?: RepoArchitecture;
  hasManifest?: boolean;
  storageMode?: StorageMode;
  scopeRoot?: string;
  outlines?: StoredOutlineRecord[];
  scopeBoundaries?: ScopeBoundaryItem[];
  briefingDepth?: 'flow' | 'deep';
  briefingScopePath?: string;
  diffStats: DiffFileStat[];
  trackedFiles?: string[];
  commits?: BranchCommitInfo[];
  verification?: BriefingVerificationResult;
  indirectImpact?: IndirectImpactReport;
  directives: AnnotationDirective[];
  mode?: CanvasViewMode;
  baseRef?: string;
  expandedDomainIds?: string[];
  expandedFolderIds?: string[];
  pruneUnchanged?: boolean;
  showSupportAssets?: boolean;
  lang?: 'zh' | 'en';
}): AtlasGraphData {
  const {
    git,
    manifest,
    manifestIssues = [],
    diffStats,
    trackedFiles = [],
    commits = [],
    verification,
    indirectImpact,
    directives,
    outlines = [],
    scopeBoundaries = [],
  } = params;
  const mode: CanvasViewMode = params.mode ?? 'hybrid';
  const baseRef = params.baseRef ?? 'HEAD';
  const lang = params.lang ?? 'zh';
  const storageMode: StorageMode = params.storageMode ?? 'git-hidden';
  const scopeRoot = normalizeCleanPath(params.scopeRoot);
  const expandedDomains = new Set(params.expandedDomainIds ?? []);
  const expandedFolders = new Set(params.expandedFolderIds ?? []);
  const pruneUnchanged = Boolean(params.pruneUnchanged);
  const showSupportAssets = Boolean(params.showSupportAssets);
  const hasManifest = params.hasManifest ?? Boolean(manifest);

  const fullArch =
    params.archOverride ?? analyzeRepositoryArchitecture(trackedFiles, manifest, lang);

  const isInScope = (p?: string): boolean => {
    if (!scopeRoot) return true;
    const norm = normalizeCleanPath(p);
    return norm === scopeRoot || norm.startsWith(`${scopeRoot}/`);
  };

  const normTracked = trackedFiles.map((f) => normalizeCleanPath(f));
  const trackedSet = new Set(normTracked);
  const activeTracked = scopeRoot ? normTracked.filter(isInScope) : normTracked;
  const activeDiffStats = scopeRoot
    ? diffStats.filter((d) => isInScope(d.path))
    : diffStats;
  const activeDirectives = scopeRoot
    ? directives.filter((d) => isInScope(d.path))
    : directives;

  // Build scope ancestors breadcrumb list (`[{ label: repoName, scopePath: '' }, ...]`)
  const repoName = git.repoRoot.split(/[\\/]/).filter(Boolean).pop() || 'Repository';
  const scopeAncestors: ScopeAncestorCrumb[] = [{ label: repoName, scopePath: '' }];
  if (scopeRoot) {
    const segs = scopeRoot.split('/');
    for (let i = 0; i < segs.length; i++) {
      scopeAncestors.push({
        label: segs[i],
        scopePath: segs.slice(0, i + 1).join('/'),
      });
    }
  }

  // Determine effective domains for either full repo or scoped subtree
  let effectiveDomains: IndexedDomain[] = fullArch.domains;
  let scopedDirectRootFiles: string[] = [];

  if (scopeRoot) {
    const childArchDomains = fullArch.domains.filter((d) => {
      const dp = normalizeCleanPath(d.paths[0]);
      return dp.startsWith(`${scopeRoot}/`);
    });
    if (childArchDomains.length >= 2) {
      effectiveDomains = childArchDomains;
      const covered = new Set(childArchDomains.flatMap((d) => d.files.map(normalizeCleanPath)));
      scopedDirectRootFiles = activeTracked.filter((f) => !covered.has(f));
    } else {
      const synth = synthesizeScopedSubdomains(activeTracked, scopeRoot, lang);
      effectiveDomains = synth.subdomains;
      scopedDirectRootFiles = synth.directRootFiles;
    }
  }

  const diffMap = new Map<string, DiffFileStat>();
  for (const d of activeDiffStats) {
    diffMap.set(normalizeCleanPath(d.path), d);
  }

  const domainByName = new Map<string, IndexedDomain>();
  const domainById = new Map<string, IndexedDomain>();
  for (const d of effectiveDomains) {
    domainByName.set(d.name, d);
    domainById.set(d.id, d);
  }

  const resolveDomainForPath = (normPath: string): { name: string; indexed?: IndexedDomain } => {
    for (const d of effectiveDomains) {
      if (d.files.includes(normPath)) {
        return { name: d.name, indexed: d };
      }
      const p0 = normalizeCleanPath(d.paths[0]);
      if (p0 && (normPath === p0 || normPath.startsWith(`${p0}/`))) {
        return { name: d.name, indexed: d };
      }
    }
    if (scopeRoot) {
      const rel = normPath.startsWith(`${scopeRoot}/`)
        ? normPath.slice(scopeRoot.length + 1)
        : normPath;
      const slash = rel.indexOf('/');
      const seg = slash >= 0 ? rel.slice(0, slash) : '(root)';
      return { name: seg, indexed: domainByName.get(seg) };
    }
    const fallbackName = matchDomainForPath(normPath, manifest);
    return { name: fallbackName, indexed: domainByName.get(fallbackName) };
  };

  const promotedSupportIds = new Set<string>();
  const markPathPromoted = (p?: string) => {
    if (!p || !isInScope(p)) return;
    const res = resolveDomainForPath(normalizeCleanPath(p));
    if (res.indexed?.isSupport) promotedSupportIds.add(res.indexed.id);
  };
  for (const d of activeDiffStats) markPathPromoted(d.path);
  for (const dir of activeDirectives) markPathPromoted(dir.path);
  if (verification) {
    for (const c of verification.claims) {
      for (const a of c.claim.anchors) markPathPromoted(a.path);
    }
    for (const b of verification.blockingConditions) markPathPromoted(b.item.anchor?.path);
    for (const imp of verification.impacts ?? []) {
      markPathPromoted(imp.item.sourceAnchor.path);
      markPathPromoted(imp.item.targetAnchor.path);
    }
  }

  let hiddenSupportDomains = 0;
  let hiddenSupportFiles = 0;
  for (const d of effectiveDomains) {
    if (d.isSupport && !showSupportAssets && !promotedSupportIds.has(d.id)) {
      hiddenSupportDomains += 1;
      hiddenSupportFiles += d.fileCount;
    }
  }

  const nodes: AtlasGraphNode[] = [];
  const edges: AtlasGraphEdge[] = [];

  const rootId = 'root';
  const patternLabel = lang === 'zh' ? fullArch.patternLabelZh : fullArch.patternLabelEn;
  const scaleLabel =
    lang === 'zh'
      ? fullArch.scale === 'small'
        ? '小项目'
        : fullArch.scale === 'medium'
          ? '中型项目'
          : '大型项目'
      : fullArch.scale === 'small'
        ? 'Small'
        : fullArch.scale === 'medium'
          ? 'Medium'
          : 'Large';

  const visibleDomainCount = effectiveDomains.length - hiddenSupportDomains;
  const exactArchDomain = scopeRoot
    ? fullArch.domains.find((d) => normalizeCleanPath(d.paths[0]) === scopeRoot || d.name === scopeRoot)
    : undefined;

  nodes.push({
    id: rootId,
    kind: 'root',
    title: scopeRoot ? `🎯 ${scopeRoot}` : repoName,
    scopePath: scopeRoot,
    defaultDirectivePath: scopeRoot || activeTracked[0] || '',
    subtitle: `${git.branch} @ ${git.shortSha}${git.dirtyCount > 0 ? ` · ${git.dirtyCount} dirty` : ' · clean'}`,
    layer: scopeRoot
      ? `${lang === 'zh' ? '局部视图根' : 'Scoped Root'} · ${activeTracked.length} ${lang === 'zh' ? '文件' : 'files'}`
      : `${patternLabel} · ${scaleLabel} (${fullArch.totalFiles})`,
    body: scopeRoot
      ? exactArchDomain?.description ||
        `${lang === 'zh' ? '已聚焦子目录' : 'Scoped to'} ${scopeRoot}（${activeTracked.length} ${lang === 'zh' ? '个文件' : 'files'}）`
      : verification
        ? `${lang === 'zh' ? '当前简报' : 'Briefing'}: ${verification.briefingTitle}`
        : `${visibleDomainCount} ${lang === 'zh' ? '个核心架构域' : 'code domains'}${hiddenSupportFiles > 0 ? ` · ${lang === 'zh' ? '已折叠' : 'folded'} ${hiddenSupportFiles} ${lang === 'zh' ? '个非源码资源' : 'support/assets'}` : ''}`,
    badge: !scopeRoot ? verification?.overallBadge : undefined,
  });

  const domainNodeIds = new Map<string, string>();
  const ensureDomain = (name: string, indexed?: IndexedDomain): string => {
    const existing = domainNodeIds.get(name);
    if (existing) return existing;
    const domIdKey = indexed?.id ?? name;
    const id = `domain:${domIdKey}`;
    domainNodeIds.set(name, id);
    const isExpanded = expandedDomains.has(domIdKey);
    const fileCount = indexed?.fileCount ?? 0;
    const rawFirstPath = normalizeCleanPath(
      indexed?.paths[0] ?? (scopeRoot && name !== '(root)' ? `${scopeRoot}/${name}` : name)
    );
    const dirScopeCandidate =
      indexed?.paths
        .map((p) => normalizeCleanPath(p))
        .find((p) => p && p !== '(root)' && !trackedSet.has(p)) ??
      (rawFirstPath && rawFirstPath !== '(root)' && !trackedSet.has(rawFirstPath)
        ? rawFirstPath
        : '');

    nodes.push({
      id,
      parentId: rootId,
      kind: 'domain',
      domainId: domIdKey,
      scopePath: dirScopeCandidate || undefined,
      title: name,
      layer: indexed?.layer,
      isSupport: indexed?.isSupport,
      subtitle: indexed?.packageName
        ? `${indexed.packageName}${indexed.paths.length ? ` · ${indexed.paths[0]}` : ''}`
        : indexed?.paths.length
          ? indexed.paths.join(', ')
          : fileCount > 0
            ? `${fileCount} ${lang === 'zh' ? '个文件' : 'files'}`
            : undefined,
      body: indexed?.description || (lang === 'zh' ? '逻辑职责域' : 'Responsibility domain'),
      fileCount,
      canExpandFiles: fileCount > 0,
      filesExpanded: isExpanded,
      defaultDirectivePath: rawFirstPath || indexed?.files[0],
    });
    edges.push({
      id: `e:${rootId}->${id}`,
      from: rootId,
      to: id,
      kind: 'hierarchy',
    });
    return id;
  };

  const pathToNodeId = new Map<string, string>();
  const folderNodeByPathPrefix = new Map<string, string>();

  const emitFileListUnderParent = (
    parentId: string,
    fileList: string[],
    cap: number
  ) => {
    const sorted = sortFilesByImportance(fileList, diffMap);
    const shown = sorted.slice(0, cap);
    for (const f of shown) {
      if (pathToNodeId.has(f)) continue;
      const fileNodeId = `file:${f}`;
      const diff = diffMap.get(f);
      nodes.push({
        id: fileNodeId,
        parentId,
        kind: diff ? 'diff-file' : 'file',
        title: f.split('/').pop() || f,
        subtitle: diff ? `[${diff.status}] ${f}` : f,
        path: f,
        defaultDirectivePath: f,
        startLine: 1,
        changed: Boolean(diff),
        additions: diff?.additions,
        deletions: diff?.deletions,
      });
      edges.push({
        id: `e:${parentId}->${fileNodeId}`,
        from: parentId,
        to: fileNodeId,
        kind: 'hierarchy',
      });
      pathToNodeId.set(f, fileNodeId);
    }
    if (sorted.length > cap) {
      const extra = sorted.length - cap;
      const ovId = `overflow:${parentId}`;
      nodes.push({
        id: ovId,
        parentId,
        kind: 'file',
        isSummary: true,
        title: lang === 'zh' ? `+${extra} 个未展开文件` : `+${extra} more files`,
        subtitle: `${sorted.length} ${lang === 'zh' ? '个文件（可用 / 搜索定位）' : 'files total (use / Search)'}`,
      });
      edges.push({
        id: `e:${parentId}->${ovId}`,
        from: parentId,
        to: ovId,
        kind: 'hierarchy',
      });
    }
  };

  // 1. Domains, Entrypoints, Scoped Direct Files, and 2-Level Lazy Folder/File Expansion
  if (mode !== 'briefing') {
    for (const d of effectiveDomains) {
      if (d.isSupport && !showSupportAssets && !promotedSupportIds.has(d.id)) {
        continue;
      }
      const domId = ensureDomain(d.name, d);
      const domPrefix = normalizeCleanPath(d.paths[0] ?? '');

      for (const ep of d.entrypoints) {
        const epId = `ep:${d.id}:${ep.path}:${ep.symbol ?? ep.startLine ?? 1}`;
        const normPath = normalizeCleanPath(ep.path);
        const diff = diffMap.get(normPath);
        nodes.push({
          id: epId,
          parentId: domId,
          kind: 'entrypoint',
          title: ep.symbol || normPath.split('/').pop() || normPath,
          subtitle: `${normPath}${ep.startLine ? `:${ep.startLine}` : ''}`,
          path: normPath,
          defaultDirectivePath: normPath,
          startLine: ep.startLine ?? 1,
          symbol: ep.symbol,
          changed: Boolean(diff),
          additions: diff?.additions,
          deletions: diff?.deletions,
        });
        edges.push({
          id: `e:${domId}->${epId}`,
          from: domId,
          to: epId,
          kind: 'hierarchy',
        });
        if (!pathToNodeId.has(normPath)) {
          pathToNodeId.set(normPath, epId);
        }
      }

      if (expandedDomains.has(d.id)) {
        const nonAssets: string[] = [];
        const assetFiles: string[] = [];
        for (const rawF of d.files) {
          const f = normalizeCleanPath(rawF);
          if (classifyFileArtifact(f) === 'asset' && !diffMap.has(f)) {
            assetFiles.push(f);
          } else {
            nonAssets.push(f);
          }
        }

        const groups = groupFilesBySubdirectory(nonAssets, domPrefix);
        const useFolders = nonAssets.length > 8 && groups.length >= 2;

        if (useFolders) {
          for (const g of groups) {
            const folderId = `folder:${d.id}:${g.groupKey}`;
            const isFolderExp = expandedFolders.has(folderId);
            const changedInFolder = g.files.filter((f) => diffMap.has(f)).length;
            const folderScope =
              g.groupKey === '(root)'
                ? domPrefix
                : domPrefix
                  ? `${domPrefix}/${g.groupKey}`
                  : g.groupKey;
            nodes.push({
              id: folderId,
              parentId: domId,
              kind: 'folder',
              domainId: d.id,
              folderId,
              scopePath: folderScope || undefined,
              title: g.label,
              subtitle: `${g.files.length} ${lang === 'zh' ? '个文件' : 'files'}${changedInFolder > 0 ? ` · ${changedInFolder} ${lang === 'zh' ? '处变更' : 'changed'}` : ''}`,
              fileCount: g.files.length,
              canExpandFiles: true,
              filesExpanded: isFolderExp,
              changed: changedInFolder > 0,
              defaultDirectivePath: folderScope || g.files[0],
            });
            edges.push({
              id: `e:${domId}->${folderId}`,
              from: domId,
              to: folderId,
              kind: 'hierarchy',
            });

            for (const f of g.files) {
              folderNodeByPathPrefix.set(f, folderId);
            }

            if (isFolderExp) {
              emitFileListUnderParent(folderId, g.files, 25);
            }
          }
        } else {
          emitFileListUnderParent(domId, nonAssets, 25);
        }

        if (assetFiles.length >= 3) {
          const assetSummaryId = `assets:${d.id}`;
          nodes.push({
            id: assetSummaryId,
            parentId: domId,
            kind: 'file',
            isSummary: true,
            title:
              lang === 'zh'
                ? `${assetFiles.length} 个静态资源文件（已折叠）`
                : `${assetFiles.length} static assets (collapsed)`,
            subtitle: assetFiles.slice(0, 3).map((x) => x.split('/').pop()).join(', '),
          });
          edges.push({
            id: `e:${domId}->${assetSummaryId}`,
            from: domId,
            to: assetSummaryId,
            kind: 'hierarchy',
          });
        } else if (assetFiles.length > 0) {
          emitFileListUnderParent(domId, assetFiles, 3);
        }
      }
    }

    // Emit direct files when zoomed into a leaf directory (e.g. `src/core`)
    if (scopeRoot && scopedDirectRootFiles.length > 0) {
      const nonAssets = scopedDirectRootFiles.filter(
        (f) => classifyFileArtifact(f) !== 'asset' || diffMap.has(f)
      );
      emitFileListUnderParent(rootId, nonAssets, 35);
    }

    // Internal workspace dependency edges (`dep`, rendered on-inspect in Canvas!)
    for (const d of effectiveDomains) {
      if (!d.workspaceDeps || d.workspaceDeps.length === 0) continue;
      const fromNodeId = domainNodeIds.get(d.name);
      if (!fromNodeId) continue;
      for (const depDomId of d.workspaceDeps) {
        const targetDom = domainById.get(depDomId);
        if (!targetDom) continue;
        const toNodeId = domainNodeIds.get(targetDom.name);
        if (!toNodeId || toNodeId === fromNodeId) continue;
        edges.push({
          id: `dep:${fromNodeId}->${toNodeId}`,
          from: fromNodeId,
          to: toNodeId,
          kind: 'dep',
          label: lang === 'zh' ? '依赖' : 'depends',
        });
      }
    }
  }

  // 2. Claims & Evidence Anchors (filtered to scopeRoot when scoped)
  const claimSummaryItems: Array<{
    id: string;
    nodeId: string;
    title: string;
    badge: VerificationBadge;
  }> = [];

  if (mode !== 'atlas' && verification) {
    for (const c of verification.claims) {
      const inScopeAnchors = c.claim.anchors.filter((a) => isInScope(a.path));
      if (scopeRoot && inScopeAnchors.length === 0) continue;

      const primaryPath = normalizeCleanPath((inScopeAnchors[0] ?? c.claim.anchors[0])?.path);
      let parentForClaim = rootId;
      if (mode !== 'briefing') {
        if (primaryPath && effectiveDomains.length > 0) {
          const resolved = resolveDomainForPath(primaryPath);
          if (resolved.indexed || !scopeRoot) {
            parentForClaim = ensureDomain(resolved.name, resolved.indexed);
          }
        } else if (!scopeRoot) {
          parentForClaim = ensureDomain(lang === 'zh' ? '简报声明' : 'Briefing Claims');
        }
      }

      const claimId = `claim:${c.claim.id}`;
      const anyChanged = c.claim.anchors.some((a) => diffMap.has(normalizeCleanPath(a.path)));

      nodes.push({
        id: claimId,
        parentId: parentForClaim,
        kind: 'claim',
        title: `${c.claim.id} · ${c.claim.title}`,
        subtitle: c.claim.claimType.toUpperCase(),
        body: c.claim.statement,
        badge: c.badge,
        claimType: c.claim.claimType,
        defaultDirectivePath: primaryPath,
        startLine: c.claim.anchors[0]?.startLine,
        changed: anyChanged,
        notes: c.notes,
        fromBriefing: true,
      });
      edges.push({
        id: `e:${parentForClaim}->${claimId}`,
        from: parentForClaim,
        to: claimId,
        kind: 'flow',
      });
      claimSummaryItems.push({
        id: c.claim.id,
        nodeId: claimId,
        title: c.claim.title,
        badge: c.badge,
      });

      for (let i = 0; i < c.anchors.length; i++) {
        const a = c.anchors[i];
        const normPath = normalizeCleanPath(a.anchor.path);
        if (scopeRoot && !isInScope(normPath)) continue;
        const evId = `ev:${c.claim.id}:${i}`;
        const diff = diffMap.get(normPath);
        nodes.push({
          id: evId,
          parentId: claimId,
          kind: 'evidence',
          title: a.anchor.symbol || normPath.split('/').pop() || normPath,
          subtitle: `${normPath}${a.anchor.startLine ? `:${a.anchor.startLine}${a.anchor.endLine && a.anchor.endLine !== a.anchor.startLine ? `-${a.anchor.endLine}` : ''}` : ''}`,
          badge: a.badge,
          path: normPath,
          defaultDirectivePath: normPath,
          startLine: a.anchor.startLine ?? 1,
          endLine: a.anchor.endLine,
          symbol: a.anchor.symbol,
          changed: Boolean(diff),
          additions: diff?.additions,
          deletions: diff?.deletions,
          notes: a.notes,
          fromBriefing: true,
        });
        edges.push({
          id: `e:${claimId}->${evId}`,
          from: claimId,
          to: evId,
          kind: 'flow',
        });
        pathToNodeId.set(normPath, evId);
      }
    }

    // 3. Explicit Blocking Conditions
    for (const b of verification.blockingConditions) {
      const bPath = normalizeCleanPath(b.item.anchor?.path);
      if (scopeRoot && bPath && !isInScope(bPath)) continue;

      let parentId = rootId;
      if (bPath && pathToNodeId.has(bPath)) {
        parentId = pathToNodeId.get(bPath)!;
      } else if (mode !== 'briefing' && bPath && effectiveDomains.length > 0) {
        const resolved = resolveDomainForPath(bPath);
        if (resolved.indexed || !scopeRoot) {
          parentId = ensureDomain(resolved.name, resolved.indexed);
        }
      }
      const blockId = `block:${b.item.id}`;
      nodes.push({
        id: blockId,
        parentId,
        kind: 'blocking',
        title: `${lang === 'zh' ? '阻断条件' : 'Guard'} ${b.item.id}`,
        subtitle: bPath
          ? `${bPath}${b.item.anchor?.startLine ? `:${b.item.anchor.startLine}` : ''}`
          : lang === 'zh'
            ? '显式阻断条件'
            : 'Explicit blocking condition',
        condition: b.item.condition,
        outcome: b.item.outcome,
        body: `IF ${b.item.condition} → ${b.item.outcome}`,
        badge: b.badge,
        path: bPath || undefined,
        defaultDirectivePath: bPath || undefined,
        startLine: b.item.anchor?.startLine,
        endLine: b.item.anchor?.endLine,
        symbol: b.item.anchor?.symbol,
        notes: b.anchorResult?.notes,
        fromBriefing: true,
      });
      edges.push({
        id: `e:${parentId}->${blockId}`,
        from: parentId,
        to: blockId,
        kind: 'blocking',
        label: lang === 'zh' ? '阻断分叉' : 'IF / BLOCKS',
      });
    }
  }

  // 4. Changed files from Git Diff
  if (mode !== 'briefing') {
    const MAX_DIFF_NODES = 30;
    const shownDiffs = activeDiffStats.slice(0, MAX_DIFF_NODES);
    for (const d of shownDiffs) {
      const normPath = normalizeCleanPath(d.path);
      if (pathToNodeId.has(normPath)) continue;
      let parentId = rootId;
      if (effectiveDomains.length > 0) {
        const resolved = resolveDomainForPath(normPath);
        const domId = resolved.indexed || !scopeRoot ? ensureDomain(resolved.name, resolved.indexed) : rootId;
        parentId = folderNodeByPathPrefix.get(normPath) || domId;
      }
      const diffId = `diff:${normPath}`;
      nodes.push({
        id: diffId,
        parentId,
        kind: 'diff-file',
        title: normPath.split('/').pop() || normPath,
        subtitle: `[${d.status}] ${normPath}`,
        path: normPath,
        defaultDirectivePath: normPath,
        startLine: 1,
        changed: true,
        additions: d.additions,
        deletions: d.deletions,
      });
      edges.push({
        id: `e:${parentId}->${diffId}`,
        from: parentId,
        to: diffId,
        kind: 'hierarchy',
      });
      pathToNodeId.set(normPath, diffId);
    }
    if (activeDiffStats.length > MAX_DIFF_NODES) {
      const overflowId = 'diff:overflow';
      const extra = activeDiffStats.length - MAX_DIFF_NODES;
      nodes.push({
        id: overflowId,
        parentId: rootId,
        kind: 'diff-file',
        isSummary: true,
        title: lang === 'zh' ? `+${extra} 个更多变更文件` : `+${extra} more changed files`,
        subtitle: `${activeDiffStats.length} ${lang === 'zh' ? '个变更文件总计' : 'changed files total'}`,
        changed: true,
      });
      edges.push({
        id: `e:${rootId}->${overflowId}`,
        from: rootId,
        to: overflowId,
        kind: 'hierarchy',
      });
    }
  }

  // 5. Indirect Impact Nodes
  let impactCount = 0;

  if (indirectImpact && indirectImpact.status === 'ok') {
    for (let i = 0; i < indirectImpact.lspReferences.length; i++) {
      const refImp = indirectImpact.lspReferences[i];
      if (!isInScope(refImp.sourcePath)) continue;
      const srcNodeId =
        pathToNodeId.get(normalizeCleanPath(refImp.sourcePath)) ||
        (effectiveDomains.length > 0
          ? ensureDomain(
              resolveDomainForPath(normalizeCleanPath(refImp.sourcePath)).name,
              resolveDomainForPath(normalizeCleanPath(refImp.sourcePath)).indexed
            )
          : rootId);

      if (refImp.truncated) {
        const impId = `impact:lsp-fanout:${i}`;
        impactCount += 1;
        const domText = refImp.byDomain
          .slice(0, 4)
          .map((d) => `${d.domainName}(${d.fileCount})`)
          .join(', ');
        nodes.push({
          id: impId,
          parentId: srcNodeId,
          kind: 'impact',
          title:
            lang === 'zh'
              ? `高扇出引用 · ${refImp.sourceSymbol} (${refImp.totalCallerFiles} 文件)`
              : `High-Fanout · ${refImp.sourceSymbol} (${refImp.totalCallerFiles} files)`,
          subtitle: `${refImp.totalCallSites} ${lang === 'zh' ? '处调用（按域折叠）' : 'call sites (collapsed)'}`,
          body: domText,
          badge: 'verified',
          path: refImp.byDomain[0]?.sampleFiles[0],
          startLine: 1,
        });
        edges.push({
          id: `e:${srcNodeId}->${impId}`,
          from: srcNodeId,
          to: impId,
          kind: 'impact',
          label: 'LSP',
        });
      } else {
        const uniqueFiles = new Map<string, number>();
        for (const c of refImp.callers) {
          if (!uniqueFiles.has(c.path)) uniqueFiles.set(c.path, c.line);
        }
        for (const [callerPath, callerLine] of [...uniqueFiles.entries()].slice(0, 6)) {
          const impId = `impact:lsp:${i}:${callerPath}`;
          impactCount += 1;
          nodes.push({
            id: impId,
            parentId: srcNodeId,
            kind: 'impact',
            title: `${callerPath.split('/').pop() || callerPath}:${callerLine}`,
            subtitle: `${lang === 'zh' ? '引用了' : 'calls'} ${refImp.sourceSymbol} · ${callerPath}`,
            badge: 'verified',
            path: callerPath,
            defaultDirectivePath: callerPath,
            startLine: callerLine,
          });
          edges.push({
            id: `e:${srcNodeId}->${impId}`,
            from: srcNodeId,
            to: impId,
            kind: 'impact',
            label: 'LSP',
          });
        }
      }
    }

    for (let i = 0; i < Math.min(10, indirectImpact.lspDiagnostics.length); i++) {
      const diag = indirectImpact.lspDiagnostics[i];
      if (!isInScope(diag.path)) continue;
      const domRes = resolveDomainForPath(normalizeCleanPath(diag.path));
      const parentId =
        mode === 'briefing' || effectiveDomains.length === 0
          ? rootId
          : ensureDomain(domRes.name, domRes.indexed);
      const impId = `impact:diag:${i}`;
      impactCount += 1;
      nodes.push({
        id: impId,
        parentId,
        kind: 'impact',
        title: `${lang === 'zh' ? '未改文件报错' : 'Caller Error'} · ${diag.path.split('/').pop()}:${diag.line}`,
        subtitle: diag.path,
        body: diag.message,
        badge: 'mismatch',
        path: diag.path,
        defaultDirectivePath: diag.path,
        startLine: diag.line,
      });
      edges.push({
        id: `e:${parentId}->${impId}`,
        from: parentId,
        to: impId,
        kind: 'impact',
        label: lang === 'zh' ? '编译报错' : 'LSP ERR',
      });
    }
  }

  if (mode !== 'atlas' && verification && verification.impacts && verification.impacts.length > 0) {
    for (const dimp of verification.impacts) {
      const srcPath = normalizeCleanPath(dimp.item.sourceAnchor.path);
      const tgtPath = normalizeCleanPath(dimp.item.targetAnchor.path);
      if (scopeRoot && !isInScope(srcPath) && !isInScope(tgtPath)) continue;
      const parentId = pathToNodeId.get(srcPath) || rootId;
      const impId = `impact:declared:${dimp.item.id}`;
      impactCount += 1;
      nodes.push({
        id: impId,
        parentId,
        kind: 'impact',
        scopePath: !isInScope(tgtPath) ? tgtPath.split('/').slice(0, -1).join('/') : undefined,
        title: `[${dimp.item.relation.toUpperCase()}] ${tgtPath.split('/').pop() || tgtPath}`,
        subtitle: `${tgtPath}${dimp.item.targetAnchor.startLine ? `:${dimp.item.targetAnchor.startLine}` : ''}`,
        body: dimp.item.description,
        badge: dimp.badge,
        path: tgtPath,
        defaultDirectivePath: tgtPath,
        startLine: dimp.item.targetAnchor.startLine ?? 1,
        endLine: dimp.item.targetAnchor.endLine,
        notes: dimp.notes,
        fromBriefing: true,
      });
      edges.push({
        id: `e:${parentId}->${impId}`,
        from: parentId,
        to: impId,
        kind: 'impact',
        label: dimp.item.relation,
      });
    }
  }

  // 6. Directives / Canvas Q&A & Notes
  const existingNodeIds = new Set(nodes.map((n) => n.id));
  for (const dir of activeDirectives) {
    const normPath = normalizeCleanPath(dir.path);
    let parentId =
      dir.targetNodeId && existingNodeIds.has(dir.targetNodeId)
        ? dir.targetNodeId
        : pathToNodeId.get(normPath);
    if (!parentId) {
      if (mode === 'briefing' || effectiveDomains.length === 0) {
        parentId = rootId;
      } else {
        const resolved = resolveDomainForPath(normPath);
        parentId =
          resolved.indexed || !scopeRoot
            ? ensureDomain(resolved.name, resolved.indexed)
            : rootId;
      }
    }
    const dirId = `dir:${dir.id}`;
    const statusTag = dir.status ? ` · ${dir.status}` : '';
    nodes.push({
      id: dirId,
      parentId,
      kind: 'directive',
      directiveId: dir.id,
      directiveKind: dir.kind,
      directiveStatus: dir.status,
      resolutionSummary: dir.resolution?.summary,
      title: `${dir.kind.toUpperCase()} · ${normPath.split('/').pop() || normPath}${dir.startLine ? `:${dir.startLine}` : ''}`,
      subtitle: `ref: ${dir.ref.slice(0, 8)}${statusTag}${dir.isStale ? ' (stale)' : ''}`,
      body: dir.note,
      badge: dir.status === 'resolved' ? 'verified' : dir.isStale ? 'stale' : undefined,
      path: normPath,
      defaultDirectivePath: normPath,
      startLine: dir.startLine,
      endLine: dir.endLine,
    });
    edges.push({
      id: `e:${parentId}->${dirId}`,
      from: parentId,
      to: dirId,
      kind: 'directive',
      label: dir.kind,
    });
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // 7. Scoped External Boundary Ghost Nodes (`external-dep`, revealed when owner node is selected!)
  let externalBoundaryCount = 0;
  if (scopeRoot && scopeBoundaries.length > 0 && mode !== 'briefing') {
    const findOwnerNodeId = (inScopePath: string): string => {
      const clean = normalizeCleanPath(inScopePath);
      if (pathToNodeId.has(clean)) return pathToNodeId.get(clean)!;
      if (folderNodeByPathPrefix.has(clean)) return folderNodeByPathPrefix.get(clean)!;
      // Match child domain whose scopePath prefixes clean
      for (const n of nodes) {
        if (n.kind === 'domain' && n.scopePath && (clean === n.scopePath || clean.startsWith(`${n.scopePath}/`))) {
          return n.id;
        }
      }
      return rootId;
    };

    // Deduplicate per `(ownerId, direction, externalScope)` so collapsed domains aggregate cleanly!
    const mergedBoundary = new Map<
      string,
      {
        ownerId: string;
        direction: 'outbound' | 'inbound';
        externalScope: string;
        externalTitle: string;
        samplePath: string;
        files: Set<string>;
      }
    >();

    for (const item of scopeBoundaries) {
      const ownerId = findOwnerNodeId(item.inScopePath);
      const key = `${ownerId}|${item.direction}|${item.externalScope || item.externalTitle}`;
      let cur = mergedBoundary.get(key);
      if (!cur) {
        cur = {
          ownerId,
          direction: item.direction,
          externalScope: item.externalScope,
          externalTitle: item.externalTitle,
          samplePath: item.samplePath,
          files: new Set<string>(),
        };
        mergedBoundary.set(key, cur);
      }
      for (const rf of item.relatedFiles) {
        if (cur.files.size < 5) cur.files.add(rf);
      }
    }

    for (const entry of mergedBoundary.values()) {
      externalBoundaryCount += 1;
      const owner = nodeById.get(entry.ownerId);
      if (owner) {
        if (entry.direction === 'outbound') {
          owner.externalOutCount = (owner.externalOutCount ?? 0) + 1;
        } else {
          owner.externalInCount = (owner.externalInCount ?? 0) + 1;
        }
      }
      const extId = `ext:${entry.direction}:${entry.ownerId}:${entry.externalScope || entry.externalTitle}`;
      const prefixArrow = entry.direction === 'outbound' ? '↗ ' : '↖ ';
      const fileHint = [...entry.files].slice(0, 3).join(', ');
      const newNode: AtlasGraphNode = {
        id: extId,
        parentId: entry.ownerId,
        kind: 'external-dep',
        externalDirection: entry.direction,
        scopePath: entry.externalScope || undefined,
        path: entry.samplePath || undefined,
        defaultDirectivePath: entry.samplePath || entry.externalScope,
        title: `${prefixArrow}${entry.externalTitle}`,
        subtitle: fileHint,
        body:
          entry.direction === 'outbound'
            ? lang === 'zh'
              ? `当前视图外依赖模块（点击可预览源码或切换视图根至 ${entry.externalScope || entry.externalTitle}）`
              : `Out-of-scope dependency (${entry.externalScope || entry.externalTitle})`
            : lang === 'zh'
              ? `视图外调用方（引用了当前节点，可切换视图根至 ${entry.externalScope || entry.externalTitle}）`
              : `External caller outside current scope (${entry.externalScope || entry.externalTitle})`,
      };
      nodes.push(newNode);
      nodeById.set(extId, newNode);
      edges.push({
        id: `e:${entry.ownerId}->${extId}`,
        from: entry.ownerId,
        to: extId,
        kind: 'external',
        label:
          entry.direction === 'outbound'
            ? lang === 'zh'
              ? '外部依赖'
              : 'ext dep'
            : lang === 'zh'
              ? '外部调用'
              : 'ext caller',
      });
    }
  }

  // 8. In-Place L1 Outline Hydration & Progressive Depth State (`completedDepth`)
  const outlineByScope = new Map<string, StoredOutlineRecord>();
  const roleByPath = new Map<
    string,
    { summary: string; role?: string; isRecommended: boolean }
  >();

  for (const rec of outlines) {
    if (rec.verification.overallBadge === 'mismatch') continue;
    const sc = normalizeCleanPath(rec.outline.scopePath);
    outlineByScope.set(sc, rec);
    const recEntry = normalizeCleanPath(rec.outline.recommendedEntry);
    for (const ch of rec.outline.children ?? []) {
      const cp = normalizeCleanPath(ch.path);
      if (!cp) continue;
      roleByPath.set(cp, {
        summary: ch.summary,
        role: ch.role,
        isRecommended: Boolean(recEntry && cp === recEntry),
      });
    }
  }

  const briefingCoveredPaths = new Set<string>();
  if (verification) {
    for (const c of verification.claims) {
      for (const a of c.claim.anchors) {
        briefingCoveredPaths.add(normalizeCleanPath(a.path));
      }
    }
  }
  const hasDeepBriefingGuards = Boolean(
    verification &&
      ((verification.blockingConditions && verification.blockingConditions.length > 0) ||
        params.briefingDepth === 'deep')
  );
  const briefingTargetScope = normalizeCleanPath(params.briefingScopePath);

  for (const n of nodes) {
    if (n.kind === 'claim' || n.kind === 'blocking' || n.kind === 'impact' || n.kind === 'directive' || n.kind === 'external-dep') {
      continue;
    }

    const keyPath = normalizeCleanPath(n.scopePath ?? n.path ?? '');
    const domainExtraPaths =
      n.kind === 'domain' && n.domainId
        ? (domainById.get(n.domainId)?.paths ?? []).map((p) => normalizeCleanPath(p))
        : [];
    const candidateKeys = [
      keyPath,
      normalizeCleanPath(n.defaultDirectivePath),
      ...domainExtraPaths,
    ].filter(Boolean);
    let depth: CompletedDepth = 'none';

    if (n.kind === 'root') {
      const rootOutline = outlineByScope.get(scopeRoot);
      if (rootOutline) {
        n.body = rootOutline.outline.summary;
        depth = 'overview';
      }
      if (verification && (!scopeRoot || briefingTargetScope === scopeRoot || [...briefingCoveredPaths].some((p) => isInScope(p)))) {
        depth = hasDeepBriefingGuards ? 'deep' : 'flow';
      }
      n.completedDepth = depth;
      continue;
    }

    const matchedOutlineKey = candidateKeys.find((k) => outlineByScope.has(k));
    if (matchedOutlineKey) {
      const rec = outlineByScope.get(matchedOutlineKey)!;
      n.body = rec.outline.summary;
      depth = 'overview';
    }
    const matchedRoleKey = keyPath && roleByPath.has(keyPath)
      ? keyPath
      : candidateKeys.find((k) => roleByPath.has(k));
    if (matchedRoleKey) {
      const info = roleByPath.get(matchedRoleKey)!;
      n.roleSummary = info.summary;
      if (info.isRecommended) n.isRecommendedEntry = true;
      if ((n.kind === 'domain' || n.kind === 'folder') && depth === 'none') {
        n.body = info.summary;
      }
    }

    if (candidateKeys.length > 0 && verification) {
      const hasClaimInScope = candidateKeys.some(
        (ck) =>
          briefingTargetScope === ck ||
          [...briefingCoveredPaths].some((p) => p === ck || p.startsWith(`${ck}/`))
      );
      if (hasClaimInScope) {
        depth = hasDeepBriefingGuards ? 'deep' : 'flow';
      }
    }

    n.completedDepth = depth;
  }

  // Propagate changed status up to ancestor folders/domains
  for (const n of nodes) {
    if (n.changed) {
      let cur = n.parentId ? nodeById.get(n.parentId) : undefined;
      while (cur) {
        cur.changed = true;
        cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
      }
    }
  }

  // Branch Summary
  const impactedMap = new Map<string, ImpactedDomainSummary>();
  for (const d of activeDiffStats) {
    const normPath = normalizeCleanPath(d.path);
    const resolved = resolveDomainForPath(normPath);
    const domNodeId = domainNodeIds.get(resolved.name) || rootId;
    const key = resolved.indexed?.id ?? resolved.name;
    const cur = impactedMap.get(key) ?? {
      domainId: key,
      nodeId: domNodeId,
      name: resolved.name,
      layer: resolved.indexed?.layer,
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    };
    cur.changedFiles += 1;
    cur.additions += d.additions;
    cur.deletions += d.deletions;
    impactedMap.set(key, cur);
  }
  const impactedDomains = [...impactedMap.values()].sort(
    (a, b) => b.changedFiles - a.changedFiles || b.additions - a.additions
  );

  // Branch Pruning
  let finalNodes = nodes;
  let finalEdges = edges;
  let prunedCount = 0;

  if (pruneUnchanged) {
    const keepIds = new Set<string>([rootId]);
    for (const n of nodes) {
      const relevant =
        Boolean(n.changed) ||
        Boolean(n.fromBriefing) ||
        n.kind === 'directive' ||
        n.kind === 'blocking' ||
        n.kind === 'impact';
      if (relevant) {
        let cur: AtlasGraphNode | undefined = n;
        while (cur) {
          keepIds.add(cur.id);
          cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
        }
      }
    }
    prunedCount = nodes.length - keepIds.size;
    finalNodes = nodes.filter((n) => keepIds.has(n.id));
    finalEdges = edges.filter((e) => keepIds.has(e.from) && keepIds.has(e.to));
  }

  const blockingMismatch =
    verification?.blockingConditions.filter((b) => b.badge === 'mismatch').length ?? 0;
  const openDirectiveCount = activeDirectives.filter(
    (d) => d.status === 'open' || d.status === 'claimed'
  ).length;

  return {
    mode,
    scopeRoot,
    scopeAncestors,
    storageMode,
    nodes: finalNodes,
    edges: finalEdges,
    architecture: {
      scale: fullArch.scale,
      totalFiles: scopeRoot ? activeTracked.length : fullArch.totalFiles,
      patternId: fullArch.patternId,
      patternLabelZh: fullArch.patternLabelZh,
      patternLabelEn: fullArch.patternLabelEn,
      domainCount: effectiveDomains.length,
      hasManifest,
    },
    branchSummary: {
      branch: git.branch,
      baseRef,
      commits,
      impactedDomains,
      briefingTitle: verification?.briefingTitle,
      briefingSummary: verification
        ? `${lang === 'zh' ? '已核验' : 'Verified'} ${verification.summaryCounts.verified} · ${lang === 'zh' ? '失配' : 'Mismatch'} ${verification.summaryCounts.mismatch + blockingMismatch}`
        : undefined,
      claimItems: claimSummaryItems,
    },
    summary: {
      verified: verification?.summaryCounts.verified ?? 0,
      mismatch: (verification?.summaryCounts.mismatch ?? 0) + blockingMismatch,
      stale: verification?.summaryCounts.stale ?? 0,
      unverified: verification?.summaryCounts.unverified ?? 0,
      unknown: verification?.summaryCounts.unknown ?? 0,
      blockingCount: verification?.blockingConditions.length ?? 0,
      blockingMismatch,
      changedFiles: activeDiffStats.length,
      directiveCount: activeDirectives.length,
      openDirectiveCount,
      isStale: verification?.isStale ?? false,
      targetRefClaimed: verification?.targetRefClaimed,
      baseRef,
      signals: verification?.signals ?? [],
      blindSpots: verification?.blindSpots ?? [],
      guardrails: manifest?.guardrails ?? [],
      hasBriefing: Boolean(verification),
      prunedCount,
      impactCount,
      externalBoundaryCount,
      impactStatus: indirectImpact?.status,
      impactReason: indirectImpact?.reason,
      manifestIssues,
      hiddenSupportDomains,
      hiddenSupportFiles,
    },
  };
}
