import {
  AnnotationDirective,
  AtlasManifest,
  BriefingVerificationResult,
  ClaimType,
  DiffFileStat,
  GitContext,
  VerificationBadge,
  VerificationSignal,
} from './types.js';
import { matchDomainForPath } from './manifest.js';
import {
  analyzeRepositoryArchitecture,
  IndexedDomain,
  ProjectScale,
} from './indexer.js';
import { BranchCommitInfo } from './git.js';

export type CanvasViewMode = 'hybrid' | 'atlas' | 'briefing';

export type CanvasNodeKind =
  | 'root'
  | 'domain'
  | 'entrypoint'
  | 'claim'
  | 'blocking'
  | 'evidence'
  | 'diff-file'
  | 'file'
  | 'directive';

export type CanvasEdgeKind = 'hierarchy' | 'flow' | 'blocking' | 'directive';

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
  fileCount?: number;
  canExpandFiles?: boolean;
  filesExpanded?: boolean;
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
  };
}

export function buildAtlasGraph(params: {
  git: GitContext;
  manifest?: AtlasManifest;
  diffStats: DiffFileStat[];
  trackedFiles?: string[];
  commits?: BranchCommitInfo[];
  verification?: BriefingVerificationResult;
  directives: AnnotationDirective[];
  mode?: CanvasViewMode;
  baseRef?: string;
  expandedDomainIds?: string[];
  pruneUnchanged?: boolean;
  lang?: 'zh' | 'en';
}): AtlasGraphData {
  const {
    git,
    manifest,
    diffStats,
    trackedFiles = [],
    commits = [],
    verification,
    directives,
  } = params;
  const mode: CanvasViewMode = params.mode ?? 'hybrid';
  const baseRef = params.baseRef ?? 'HEAD';
  const lang = params.lang ?? 'zh';
  const expandedDomains = new Set(params.expandedDomainIds ?? []);
  const pruneUnchanged = Boolean(params.pruneUnchanged);

  const arch = analyzeRepositoryArchitecture(trackedFiles, manifest, lang);

  const diffMap = new Map<string, DiffFileStat>();
  for (const d of diffStats) {
    diffMap.set(d.path.replace(/\\/g, '/'), d);
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

  nodes.push({
    id: rootId,
    kind: 'root',
    title: repoName,
    subtitle: `${git.branch} @ ${git.shortSha}${git.dirtyCount > 0 ? ` · ${git.dirtyCount} dirty` : ' · clean'}`,
    layer: `${patternLabel} · ${scaleLabel} (${arch.totalFiles})`,
    body: verification
      ? `${lang === 'zh' ? '当前简报' : 'Briefing'}: ${verification.briefingTitle}`
      : `${arch.domains.length} ${lang === 'zh' ? '个架构域' : 'domains'} · ${arch.totalFiles} ${lang === 'zh' ? '个文件' : 'files'}`,
    badge: verification?.overallBadge,
  });

  // Map indexed domains by name and id
  const domainByName = new Map<string, IndexedDomain>();
  for (const d of arch.domains) {
    domainByName.set(d.name, d);
  }

  const domainNodeIds = new Map<string, string>();
  const ensureDomain = (
    name: string,
    indexed?: IndexedDomain
  ): string => {
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
      subtitle: indexed?.paths.length
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

  // 1. Domains, Entrypoints, and On-Demand Lazy File Expansion (atlas & hybrid modes)
  if (mode !== 'briefing') {
    for (const d of arch.domains) {
      const domId = ensureDomain(d.name, d);
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

      // Lazy L2 file expansion: ONLY emit file nodes when this domain is expanded!
      if (expandedDomains.has(d.id)) {
        const MAX_FILES_PER_DOMAIN = 40;
        const filesToShow = d.files.slice(0, MAX_FILES_PER_DOMAIN);
        for (const f of filesToShow) {
          if (pathToNodeId.has(f)) continue;
          const fileNodeId = `file:${f}`;
          const diff = diffMap.get(f);
          nodes.push({
            id: fileNodeId,
            parentId: domId,
            kind: 'file',
            title: f.split('/').pop() || f,
            subtitle: f,
            path: f,
            defaultDirectivePath: f,
            startLine: 1,
            changed: Boolean(diff),
            additions: diff?.additions,
            deletions: diff?.deletions,
          });
          edges.push({
            id: `e:${domId}->${fileNodeId}`,
            from: domId,
            to: fileNodeId,
            kind: 'hierarchy',
          });
          pathToNodeId.set(f, fileNodeId);
        }
        if (d.files.length > MAX_FILES_PER_DOMAIN) {
          const ovId = `file-overflow:${d.id}`;
          const extra = d.files.length - MAX_FILES_PER_DOMAIN;
          nodes.push({
            id: ovId,
            parentId: domId,
            kind: 'file',
            title: lang === 'zh' ? `+${extra} 个未展开文件` : `+${extra} more files`,
            subtitle: `${d.files.length} ${lang === 'zh' ? '个文件（按需搜索定位）' : 'files total (use Search)'}`,
          });
          edges.push({
            id: `e:${domId}->${ovId}`,
            from: domId,
            to: ovId,
            kind: 'hierarchy',
          });
        }
      }
    }
  }

  // Helper to resolve which domain an arbitrary path belongs to
  const resolveDomainForPath = (normPath: string): { name: string; indexed?: IndexedDomain } => {
    for (const d of arch.domains) {
      if (d.files.includes(normPath)) {
        return { name: d.name, indexed: d };
      }
    }
    const fallbackName = matchDomainForPath(normPath, manifest);
    return { name: fallbackName, indexed: domainByName.get(fallbackName) };
  };

  // 2. Claims & Evidence Anchors (briefing & hybrid modes)
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

  // 4. Changed files from Git Diff
  if (mode !== 'briefing') {
    const MAX_DIFF_NODES = 30;
    const shownDiffs = diffStats.slice(0, MAX_DIFF_NODES);
    for (const d of shownDiffs) {
      const normPath = d.path.replace(/\\/g, '/');
      if (pathToNodeId.has(normPath)) continue;
      const resolved = resolveDomainForPath(normPath);
      const domId = ensureDomain(resolved.name, resolved.indexed);
      const diffId = `diff:${normPath}`;
      nodes.push({
        id: diffId,
        parentId: domId,
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
        id: `e:${domId}->${diffId}`,
        from: domId,
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

  // 5. Directives / Canvas Notes
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
    nodes.push({
      id: dirId,
      parentId,
      kind: 'directive',
      directiveId: dir.id,
      directiveKind: dir.kind,
      title: `${dir.kind.toUpperCase()} · ${normPath.split('/').pop() || normPath}${dir.startLine ? `:${dir.startLine}` : ''}`,
      subtitle: `ref: ${dir.ref}`,
      body: dir.note,
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

  // Propagate changed status up to ancestor domains
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

  // Build Branch Summary (Scenario C): impacted domains aggregated from diffStats
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

  // Branch Pruning (Scenario C): remove completely unrelated branches when pruneUnchanged is ON
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
        n.kind === 'blocking';
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
    },
  };
}
