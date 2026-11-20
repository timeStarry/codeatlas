import {
  AnnotationDirective,
  AtlasManifest,
  BriefingVerificationResult,
  DiffFileStat,
  GitContext,
  VerificationBadge,
} from './types.js';
import { matchDomainForPath } from './manifest.js';

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
  path?: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  changed?: boolean;
  additions?: number;
  deletions?: number;
  collapsed?: boolean;
  notes?: string[];
}

export interface AtlasGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: CanvasEdgeKind;
  label?: string;
}

export interface AtlasGraphData {
  nodes: AtlasGraphNode[];
  edges: AtlasGraphEdge[];
}

export function buildAtlasGraph(params: {
  git: GitContext;
  manifest?: AtlasManifest;
  diffStats: DiffFileStat[];
  verification?: BriefingVerificationResult;
  directives: AnnotationDirective[];
}): AtlasGraphData {
  const { git, manifest, diffStats, verification, directives } = params;
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
    subtitle: `${git.branch} @ ${git.shortSha}${git.dirtyCount > 0 ? ` · ${git.dirtyCount} dirty` : ''}`,
    body: verification
      ? `Active Briefing: ${verification.briefingTitle}`
      : manifest
        ? `${manifest.domains.length} declared domains (.atlas/manifest.json)`
        : 'Directory-derived view (no .atlas/manifest.json)',
    badge: verification?.overallBadge,
  });

  // Track domain nodes by domain name
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
      body: description || 'Logical responsibility domain',
    });
    edges.push({
      id: `e:${rootId}->${id}`,
      from: rootId,
      to: id,
      kind: 'hierarchy',
    });
    return id;
  };

  // 1. Domains & Entrypoints from .atlas/manifest.json
  if (manifest) {
    for (const d of manifest.domains) {
      const domId = ensureDomain(d.name, d.description, d.paths);
      for (const ep of d.entrypoints ?? []) {
        const epId = `ep:${d.id}:${ep.path}:${ep.symbol ?? ep.startLine ?? 1}`;
        const diff = diffMap.get(ep.path);
        nodes.push({
          id: epId,
          parentId: domId,
          kind: 'entrypoint',
          title: ep.symbol || ep.path.split('/').pop() || ep.path,
          subtitle: `${ep.path}${ep.startLine ? `:${ep.startLine}` : ''}`,
          path: ep.path,
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
      }
    }
  }

  // Track file path -> node ID for attaching directives
  const pathToNodeId = new Map<string, string>();

  // 2. Claims & Evidence Anchors from active Briefing
  if (verification) {
    for (const c of verification.claims) {
      const primaryPath = c.claim.anchors[0]?.path;
      const domName = primaryPath ? matchDomainForPath(primaryPath, manifest) : 'Briefing Claims';
      const domId = ensureDomain(domName);
      const claimId = `claim:${c.claim.id}`;
      const anyChanged = c.claim.anchors.some((a) => diffMap.has(a.path.replace(/\\/g, '/')));

      nodes.push({
        id: claimId,
        parentId: domId,
        kind: 'claim',
        title: `${c.claim.id} · ${c.claim.title}`,
        subtitle: `type: ${c.claim.claimType}`,
        body: c.claim.statement,
        badge: c.badge,
        changed: anyChanged,
        notes: c.notes,
      });
      edges.push({
        id: `e:${domId}->${claimId}`,
        from: domId,
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
          subtitle: `${normPath}${a.anchor.startLine ? `:${a.anchor.startLine}` : ''}`,
          badge: a.badge,
          path: normPath,
          startLine: a.anchor.startLine ?? 1,
          endLine: a.anchor.endLine,
          symbol: a.anchor.symbol,
          changed: Boolean(diff),
          additions: diff?.additions,
          deletions: diff?.deletions,
          notes: a.notes,
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
        (bPath ? ensureDomain(matchDomainForPath(bPath, manifest)) : rootId);
      const blockId = `block:${b.item.id}`;
      nodes.push({
        id: blockId,
        parentId,
        kind: 'blocking',
        title: `Guard ${b.item.id}: ${b.item.condition}`,
        subtitle: bPath
          ? `${bPath}${b.item.anchor?.startLine ? `:${b.item.anchor.startLine}` : ''}`
          : 'Explicit blocking condition',
        body: `Outcome: ${b.item.outcome}`,
        badge: b.badge,
        path: bPath,
        startLine: b.item.anchor?.startLine,
        endLine: b.item.anchor?.endLine,
        symbol: b.item.anchor?.symbol,
        notes: b.anchorResult?.notes,
      });
      edges.push({
        id: `e:${parentId}->${blockId}`,
        from: parentId,
        to: blockId,
        kind: 'blocking',
        label: 'blocks',
      });
    }
  }

  // 4. Changed files from Git Diff not yet represented as evidence
  for (const d of diffStats.slice(0, 30)) {
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

  // 5. Directives / Canvas Notes attached to their target file/node
  for (const dir of directives) {
    const normPath = dir.path.replace(/\\/g, '/');
    const parentId =
      pathToNodeId.get(normPath) ||
      ensureDomain(matchDomainForPath(normPath, manifest));
    const dirId = `dir:${dir.id}`;
    nodes.push({
      id: dirId,
      parentId,
      kind: 'directive',
      title: `[${dir.kind.toUpperCase()}] ${normPath.split('/').pop()}${dir.startLine ? `:${dir.startLine}` : ''}`,
      subtitle: `ref: ${dir.ref}`,
      body: dir.note,
      path: normPath,
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

  // Mark domain nodes as changed if any child is changed
  const changedDomains = new Set<string>();
  for (const n of nodes) {
    if (n.changed && n.parentId) {
      let cur: AtlasGraphNode | undefined = n;
      while (cur?.parentId) {
        changedDomains.add(cur.parentId);
        cur = nodes.find((x) => x.id === cur?.parentId);
      }
    }
  }
  for (const n of nodes) {
    if (changedDomains.has(n.id)) {
      n.changed = true;
    }
  }

  return { nodes, edges };
}
