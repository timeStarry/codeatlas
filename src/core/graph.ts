import {
  AnnotationDirective,
  AtlasManifest,
  BriefingVerificationResult,
  ClaimType,
  DiffFileStat,
  GitContext,
  IndirectImpactReport,
  ManifestDriftIssue,
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
  | 'directive';

export type CanvasEdgeKind = 'hierarchy' | 'flow' | 'blocking' | 'impact' | 'directive' | 'dep';

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

export interface AtlasGraphData {
  mode: CanvasViewMode;
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
    isStale: boolean;
    targetRefClaimed?: string;
    baseRef: string;
    signals: VerificationSignal[];
    blindSpots: string[];
    guardrails: string[];
    hasBriefing: boolean;
    prunedCount: number;
    impactCount: number;
    impactStatus?: IndirectImpactReport['status'];
    impactReason?: string;
    manifestIssues: ManifestDriftIssue[];
    hiddenSupportDomains: number;
    hiddenSupportFiles: number;
  };
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

  // Single-child prefix compression (e.g. unwrap `src/` when all files sit under `src/`)
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

export function buildAtlasGraph(params: {
  git: GitContext;
  manifest?: AtlasManifest;
  manifestIssues?: ManifestDriftIssue[];
  archOverride?: RepoArchitecture;
  hasManifest?: boolean;
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
  } = params;
  const mode: CanvasViewMode = params.mode ?? 'hybrid';
  const baseRef = params.baseRef ?? 'HEAD';
  const lang = params.lang ?? 'zh';
  const expandedDomains = new Set(params.expandedDomainIds ?? []);
  const expandedFolders = new Set(params.expandedFolderIds ?? []);
  const pruneUnchanged = Boolean(params.pruneUnchanged);
  const showSupportAssets = Boolean(params.showSupportAssets);
  const hasManifest = params.hasManifest ?? Boolean(manifest);

  const arch =
    params.archOverride ?? analyzeRepositoryArchitecture(trackedFiles, manifest, lang);

  const diffMap = new Map<string, DiffFileStat>();
  for (const d of diffStats) {
    diffMap.set(d.path.replace(/\\/g, '/'), d);
  }

  // Compute auto-promoted support domains (any support domain with diff, briefing, or directives MUST remain visible!)
  const domainByName = new Map<string, IndexedDomain>();
  const domainById = new Map<string, IndexedDomain>();
  for (const d of arch.domains) {
    domainByName.set(d.name, d);
    domainById.set(d.id, d);
  }

  const resolveDomainForPath = (normPath: string): { name: string; indexed?: IndexedDomain } => {
    for (const d of arch.domains) {
      if (d.files.includes(normPath)) {
        return { name: d.name, indexed: d };
      }
    }
    const fallbackName = matchDomainForPath(normPath, manifest);
    return { name: fallbackName, indexed: domainByName.get(fallbackName) };
  };

  const promotedSupportIds = new Set<string>();
  const markPathPromoted = (p?: string) => {
    if (!p) return;
    const res = resolveDomainForPath(p.replace(/\\/g, '/'));
    if (res.indexed?.isSupport) promotedSupportIds.add(res.indexed.id);
  };
  for (const d of diffStats) markPathPromoted(d.path);
  for (const dir of directives) markPathPromoted(dir.path);
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
  for (const d of arch.domains) {
    if (d.isSupport && !showSupportAssets && !promotedSupportIds.has(d.id)) {
      hiddenSupportDomains += 1;
      hiddenSupportFiles += d.fileCount;
    }
  }

  const nodes: AtlasGraphNode[] = [];
  const edges: AtlasGraphEdge[] = [];

  const rootId = 'root';
  const repoName = git.repoRoot.split(/[\\/]/).filter(Boolean).pop() || 'Repository';
  const patternLabel = lang === 'zh' ? arch.patternLabelZh : arch.patternLabelEn;
  const scaleLabel =
    lang === 'zh'
      ? arch.scale === 'small'
        ? '小项目'
        : arch.scale === 'medium'
          ? '中型项目'
          : '大型项目'
      : arch.scale === 'small'
        ? 'Small'
        : arch.scale === 'medium'
          ? 'Medium'
          : 'Large';

  const visibleDomainCount = arch.domains.length - hiddenSupportDomains;
  nodes.push({
    id: rootId,
    kind: 'root',
    title: repoName,
    subtitle: `${git.branch} @ ${git.shortSha}${git.dirtyCount > 0 ? ` · ${git.dirtyCount} dirty` : ' · clean'}`,
    layer: `${patternLabel} · ${scaleLabel} (${arch.totalFiles})`,
    body: verification
      ? `${lang === 'zh' ? '当前简报' : 'Briefing'}: ${verification.briefingTitle}`
      : `${visibleDomainCount} ${lang === 'zh' ? '个核心架构域' : 'code domains'}${hiddenSupportFiles > 0 ? ` · ${lang === 'zh' ? '已折叠' : 'folded'} ${hiddenSupportFiles} ${lang === 'zh' ? '个非源码资源' : 'support/assets'}` : ''}`,
    badge: verification?.overallBadge,
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

    nodes.push({
      id,
      parentId: rootId,
      kind: 'domain',
      domainId: domIdKey,
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
      defaultDirectivePath: indexed?.paths[0] ?? indexed?.files[0],
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

  // 1. Domains, Entrypoints, and 2-Level Lazy Folder/File Expansion
  if (mode !== 'briefing') {
    for (const d of arch.domains) {
      if (d.isSupport && !showSupportAssets && !promotedSupportIds.has(d.id)) {
        continue;
      }
      const domId = ensureDomain(d.name, d);

      // Show key entrypoints when domain is not yet expanded into folders/files (or always for manifest entrypoints)
      for (const ep of d.entrypoints) {
        const epId = `ep:${d.id}:${ep.path}:${ep.symbol ?? ep.startLine ?? 1}`;
        const normPath = ep.path.replace(/\\/g, '/');
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
        // Partition binary/media assets so 99 .png files NEVER explode into 99 cards!
        const nonAssets: string[] = [];
        const assetFiles: string[] = [];
        for (const f of d.files) {
          if (classifyFileArtifact(f) === 'asset' && !diffMap.has(f)) {
            assetFiles.push(f);
          } else {
            nonAssets.push(f);
          }
        }

        const groups = groupFilesBySubdirectory(nonAssets, d.paths[0] ?? '');
        const useFolders = nonAssets.length > 8 && groups.length >= 2;

        if (useFolders) {
          for (const g of groups) {
            const folderId = `folder:${d.id}:${g.groupKey}`;
            const isFolderExp = expandedFolders.has(folderId);
            const changedInFolder = g.files.filter((f) => diffMap.has(f)).length;
            nodes.push({
              id: folderId,
              parentId: domId,
              kind: 'folder',
              domainId: d.id,
              folderId,
              title: g.label,
              subtitle: `${g.files.length} ${lang === 'zh' ? '个文件' : 'files'}${changedInFolder > 0 ? ` · ${changedInFolder} ${lang === 'zh' ? '处变更' : 'changed'}` : ''}`,
              fileCount: g.files.length,
              canExpandFiles: true,
              filesExpanded: isFolderExp,
              changed: changedInFolder > 0,
              defaultDirectivePath: g.files[0],
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

    // Internal workspace dependency edges (`dep`, rendered on-inspect in Canvas!)
    for (const d of arch.domains) {
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

  // 2. Claims & Evidence Anchors
  const claimSummaryItems: Array<{
    id: string;
    nodeId: string;
    title: string;
    badge: VerificationBadge;
  }> = [];

  if (mode !== 'atlas' && verification) {
    for (const c of verification.claims) {
      const primaryPath = c.claim.anchors[0]?.path?.replace(/\\/g, '/');
      let parentForClaim = rootId;
      if (mode !== 'briefing') {
        if (primaryPath) {
          const resolved = resolveDomainForPath(primaryPath);
          parentForClaim = ensureDomain(resolved.name, resolved.indexed);
        } else {
          parentForClaim = ensureDomain(lang === 'zh' ? '简报声明' : 'Briefing Claims');
        }
      }

      const claimId = `claim:${c.claim.id}`;
      const anyChanged = c.claim.anchors.some((a) => diffMap.has(a.path.replace(/\\/g, '/')));

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
        const evId = `ev:${c.claim.id}:${i}`;
        const normPath = a.anchor.path.replace(/\\/g, '/');
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
      const bPath = b.item.anchor?.path?.replace(/\\/g, '/');
      let parentId = rootId;
      if (bPath && pathToNodeId.has(bPath)) {
        parentId = pathToNodeId.get(bPath)!;
      } else if (mode !== 'briefing' && bPath) {
        const resolved = resolveDomainForPath(bPath);
        parentId = ensureDomain(resolved.name, resolved.indexed);
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
        path: bPath,
        defaultDirectivePath: bPath,
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

  // 4. Changed files from Git Diff (attaching to folder node if parent domain is expanded into folders!)
  if (mode !== 'briefing') {
    const MAX_DIFF_NODES = 30;
    const shownDiffs = diffStats.slice(0, MAX_DIFF_NODES);
    for (const d of shownDiffs) {
      const normPath = d.path.replace(/\\/g, '/');
      if (pathToNodeId.has(normPath)) continue;
      const resolved = resolveDomainForPath(normPath);
      const domId = ensureDomain(resolved.name, resolved.indexed);
      const parentId = folderNodeByPathPrefix.get(normPath) || domId;
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
    if (diffStats.length > MAX_DIFF_NODES) {
      const overflowId = 'diff:overflow';
      const extra = diffStats.length - MAX_DIFF_NODES;
      nodes.push({
        id: overflowId,
        parentId: rootId,
        kind: 'diff-file',
        isSummary: true,
        title: lang === 'zh' ? `+${extra} 个更多变更文件` : `+${extra} more changed files`,
        subtitle: `${diffStats.length} ${lang === 'zh' ? '个变更文件总计' : 'changed files total'}`,
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
      const srcNodeId =
        pathToNodeId.get(refImp.sourcePath) ||
        ensureDomain(resolveDomainForPath(refImp.sourcePath).name, resolveDomainForPath(refImp.sourcePath).indexed);

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
      const domRes = resolveDomainForPath(diag.path);
      const parentId =
        mode === 'briefing' ? rootId : ensureDomain(domRes.name, domRes.indexed);
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
      const srcPath = dimp.item.sourceAnchor.path.replace(/\\/g, '/');
      const tgtPath = dimp.item.targetAnchor.path.replace(/\\/g, '/');
      const parentId = pathToNodeId.get(srcPath) || rootId;
      const impId = `impact:declared:${dimp.item.id}`;
      impactCount += 1;
      nodes.push({
        id: impId,
        parentId,
        kind: 'impact',
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

  // 6. Directives / Canvas Notes
  const existingNodeIds = new Set(nodes.map((n) => n.id));
  for (const dir of directives) {
    const normPath = dir.path.replace(/\\/g, '/');
    let parentId =
      dir.targetNodeId && existingNodeIds.has(dir.targetNodeId)
        ? dir.targetNodeId
        : pathToNodeId.get(normPath);
    if (!parentId) {
      if (mode === 'briefing') {
        parentId = rootId;
      } else {
        const resolved = resolveDomainForPath(normPath);
        parentId = ensureDomain(resolved.name, resolved.indexed);
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
      title: `${dir.kind.toUpperCase()} · ${normPath.split('/').pop() || normPath}${dir.startLine ? `:${dir.startLine}` : ''}`,
      subtitle: `ref: ${dir.ref}${statusTag}${dir.isStale ? ' (stale)' : ''}`,
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

  // Propagate changed status up to ancestor folders/domains
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
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
  for (const d of diffStats) {
    const normPath = d.path.replace(/\\/g, '/');
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

  return {
    mode,
    nodes: finalNodes,
    edges: finalEdges,
    architecture: {
      scale: arch.scale,
      totalFiles: arch.totalFiles,
      patternId: arch.patternId,
      patternLabelZh: arch.patternLabelZh,
      patternLabelEn: arch.patternLabelEn,
      domainCount: arch.domains.length,
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
      changedFiles: diffStats.length,
      directiveCount: directives.length,
      isStale: verification?.isStale ?? false,
      targetRefClaimed: verification?.targetRefClaimed,
      baseRef,
      signals: verification?.signals ?? [],
      blindSpots: verification?.blindSpots ?? [],
      guardrails: manifest?.guardrails ?? [],
      hasBriefing: Boolean(verification),
      prunedCount,
      impactCount,
      impactStatus: indirectImpact?.status,
      impactReason: indirectImpact?.reason,
      manifestIssues,
      hiddenSupportDomains,
      hiddenSupportFiles,
    },
  };
}
