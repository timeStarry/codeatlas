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

export type CanvasViewMode = 'hybrid' | 'atlas' | 'briefing';

export type CanvasNodeKind =
  | 'root'
  | 'domain'
  | 'entrypoint'
  | 'claim'
  | 'blocking'
  | 'evidence'
  | 'diff-file'
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

export interface AtlasGraphData {
  mode: CanvasViewMode;
  nodes: AtlasGraphNode[];
  edges: AtlasGraphEdge[];
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
  };
}

export function buildAtlasGraph(params: {
  git: GitContext;
  manifest?: AtlasManifest;
  diffStats: DiffFileStat[];
  trackedFiles?: string[];
  verification?: BriefingVerificationResult;
  directives: AnnotationDirective[];
  mode?: CanvasViewMode;
  baseRef?: string;
}): AtlasGraphData {
  const { git, manifest, diffStats, trackedFiles = [], verification, directives } = params;
  const mode: CanvasViewMode = params.mode ?? 'hybrid';
  const baseRef = params.baseRef ?? 'HEAD';
  const nodes: AtlasGraphNode[] = [];
  const edges: AtlasGraphEdge[] = [];

  const diffMap = new Map<string, DiffFileStat>();
  for (const d of diffStats) {
    diffMap.set(d.path.replace(/\\/g, '/'), d);
  }

  const rootId = 'root';
  const repoName = git.repoRoot.split(/[\\/]/).filter(Boolean).pop() || 'Repository';
  nodes.push({
    id: rootId,
    kind: 'root',
    title: repoName,
    subtitle: `${git.branch} @ ${git.shortSha}${git.dirtyCount > 0 ? ` · ${git.dirtyCount} dirty` : ' · clean'}`,
    body: verification
      ? `Briefing: ${verification.briefingTitle}`
      : manifest
        ? `${manifest.domains.length} declared domains (.atlas/manifest.json)`
        : `${trackedFiles.length} tracked files (directory-derived fallback)`,
    badge: verification?.overallBadge,
  });

  const domainNodeIds = new Map<string, string>();
  const ensureDomain = (name: string, description?: string, paths?: string[]): string => {
    const existing = domainNodeIds.get(name);
    if (existing) return existing;
    const id = `domain:${name}`;
    domainNodeIds.set(name, id);
    nodes.push({
      id,
      parentId: rootId,
      kind: 'domain',
      title: name,
      subtitle: paths?.join(', '),
      body: description || 'Responsibility domain',
      defaultDirectivePath: paths?.[0],
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

  // 1. Domains & Entrypoints (shown in 'atlas' and 'hybrid' modes)
  if (mode !== 'briefing') {
    if (manifest) {
      for (const d of manifest.domains) {
        const domId = ensureDomain(d.name, d.description, d.paths);
        for (const ep of d.entrypoints ?? []) {
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
      }
    } else if (trackedFiles.length > 0) {
      // Real directory-derived fallback topology when no .atlas/manifest.json exists
      const byTopDir = new Map<string, string[]>();
      for (const f of trackedFiles) {
        const segs = f.split('/');
        const key = segs.length > 1 ? segs[0] : '(root)';
        const arr = byTopDir.get(key) ?? [];
        arr.push(f);
        byTopDir.set(key, arr);
      }
      for (const [dir, files] of [...byTopDir.entries()].slice(0, 10)) {
        const domId = ensureDomain(
          dir,
          `Directory fallback (${files.length} tracked file${files.length > 1 ? 's' : ''})`,
          dir === '(root)' ? [files[0]] : [dir]
        );
        for (const f of files.slice(0, 3)) {
          const epId = `dirfile:${f}`;
          const diff = diffMap.get(f);
          nodes.push({
            id: epId,
            parentId: domId,
            kind: 'entrypoint',
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
            id: `e:${domId}->${epId}`,
            from: domId,
            to: epId,
            kind: 'hierarchy',
          });
          if (!pathToNodeId.has(f)) {
            pathToNodeId.set(f, epId);
          }
        }
      }
    }
  }

  // 2. Claims & Evidence Anchors (shown in 'briefing' and 'hybrid' modes)
  if (mode !== 'atlas' && verification) {
    for (const c of verification.claims) {
      const primaryPath = c.claim.anchors[0]?.path?.replace(/\\/g, '/');
      const parentForClaim =
        mode === 'briefing'
          ? rootId
          : ensureDomain(
              primaryPath ? matchDomainForPath(primaryPath, manifest) : 'Briefing Claims'
            );

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

    // 3. Explicit Blocking Conditions (always visibly forked!)
    for (const b of verification.blockingConditions) {
      const bPath = b.item.anchor?.path?.replace(/\\/g, '/');
      const parentId =
        (bPath && pathToNodeId.get(bPath)) ||
        (mode === 'briefing'
          ? rootId
          : bPath
            ? ensureDomain(matchDomainForPath(bPath, manifest))
            : rootId);
      const blockId = `block:${b.item.id}`;
      nodes.push({
        id: blockId,
        parentId,
        kind: 'blocking',
        title: `Guard ${b.item.id}`,
        subtitle: bPath
          ? `${bPath}${b.item.anchor?.startLine ? `:${b.item.anchor.startLine}` : ''}`
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
        label: 'IF / BLOCKS',
      });
    }
  }

  // 4. Changed files from Git Diff (shown in 'atlas' and 'hybrid')
  if (mode !== 'briefing') {
    const MAX_DIFF_NODES = 30;
    const shownDiffs = diffStats.slice(0, MAX_DIFF_NODES);
    for (const d of shownDiffs) {
      const normPath = d.path.replace(/\\/g, '/');
      if (pathToNodeId.has(normPath)) continue;
      const domName = matchDomainForPath(normPath, manifest);
      const domId = ensureDomain(domName);
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
        title: `+${extra} more changed files`,
        subtitle: `Showing first ${MAX_DIFF_NODES} of ${diffStats.length} diff files`,
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

  // 5. Directives / Canvas Notes attached directly to targetNodeId (if present) or matching path
  const existingNodeIds = new Set(nodes.map((n) => n.id));
  for (const dir of directives) {
    const normPath = dir.path.replace(/\\/g, '/');
    const parentId =
      (dir.targetNodeId && existingNodeIds.has(dir.targetNodeId) ? dir.targetNodeId : undefined) ||
      pathToNodeId.get(normPath) ||
      (mode === 'briefing'
        ? rootId
        : ensureDomain(matchDomainForPath(normPath, manifest)));
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

  const blockingMismatch =
    verification?.blockingConditions.filter((b) => b.badge === 'mismatch').length ?? 0;

  return {
    mode,
    nodes,
    edges,
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
    },
  };
}
