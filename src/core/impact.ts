import {
  AtlasManifest,
  DiffFileStat,
  GitContext,
  LspCallerDomainSummary,
  LspReferenceImpact,
} from './types.js';
import { matchDomainForPath } from './manifest.js';

export const IMPACT_BOUNDS = {
  MAX_FILES: 15,
  MAX_SYMBOLS: 30,
  PER_SYMBOL_TIMEOUT_MS: 400,
  TOTAL_BUDGET_MS: 3000,
  CONCURRENCY: 3,
  FANOUT_FILE_CAP: 12,
  SAMPLE_FILES_PER_DOMAIN: 5,
  MAX_DIAGNOSTIC_FILES: 50,
} as const;

export function canRunLspImpact(
  gitCtx: GitContext,
  targetRef?: string,
  resolvedTargetSha?: string
): { allowed: boolean; reason?: string } {
  if (!targetRef || targetRef === 'WORKTREE') {
    return { allowed: true };
  }
  if (resolvedTargetSha && gitCtx.headSha && resolvedTargetSha === gitCtx.headSha && gitCtx.dirtyCount === 0) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `LSP indexes live workspace buffers only; targetRef "${targetRef}" does not match a clean HEAD (${gitCtx.shortSha}, dirty=${gitCtx.dirtyCount}).`,
  };
}

function isTestFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return (
    lower.startsWith('test/') ||
    lower.startsWith('tests/') ||
    lower.includes('/__tests__/') ||
    lower.includes('.test.') ||
    lower.includes('.spec.')
  );
}

/**
 * Deterministic priority ordering: non-test files first -> total diff lines desc -> path asc.
 */
export function prioritizeChangedFiles(
  diffStats: DiffFileStat[],
  maxFiles = IMPACT_BOUNDS.MAX_FILES
): DiffFileStat[] {
  return [...diffStats]
    .sort((a, b) => {
      const ta = isTestFile(a.path) ? 1 : 0;
      const tb = isTestFile(b.path) ? 1 : 0;
      if (ta !== tb) return ta - tb;
      const la = a.additions + a.deletions;
      const lb = b.additions + b.deletions;
      if (la !== lb) return lb - la;
      return a.path.localeCompare(b.path);
    })
    .slice(0, maxFiles);
}

/**
 * Aggregates raw LSP reference locations outside `changedFiles`.
 * Collapses high-fanout utilities (> FANOUT_FILE_CAP) into domain-level summaries.
 */
export function aggregateCallerLocations(params: {
  sourcePath: string;
  sourceSymbol: string;
  sourceLine: number;
  rawCallers: Array<{ path: string; line: number }>;
  changedFiles: Set<string>;
  manifest?: AtlasManifest;
}): LspReferenceImpact | undefined {
  const { sourcePath, sourceSymbol, sourceLine, rawCallers, changedFiles, manifest } = params;

  const dedupCallers: Array<{ path: string; line: number }> = [];
  const seenKey = new Set<string>();
  const callersByFile = new Map<string, number>();

  for (const c of rawCallers) {
    const norm = c.path.replace(/\\/g, '/');
    if (changedFiles.has(norm) || norm === sourcePath) continue;
    const key = `${norm}:${c.line}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    dedupCallers.push({ path: norm, line: c.line });
    callersByFile.set(norm, (callersByFile.get(norm) ?? 0) + 1);
  }

  if (callersByFile.size === 0) {
    return undefined;
  }

  const byDomainMap = new Map<
    string,
    { domainName: string; fileCount: number; callSites: number; sampleFiles: string[] }
  >();
  for (const [filePath, count] of callersByFile.entries()) {
    const domName = matchDomainForPath(filePath, manifest);
    const cur = byDomainMap.get(domName) ?? {
      domainName: domName,
      fileCount: 0,
      callSites: 0,
      sampleFiles: [],
    };
    cur.fileCount += 1;
    cur.callSites += count;
    if (cur.sampleFiles.length < IMPACT_BOUNDS.SAMPLE_FILES_PER_DOMAIN) {
      cur.sampleFiles.push(filePath);
    }
    byDomainMap.set(domName, cur);
  }

  const byDomain: LspCallerDomainSummary[] = [...byDomainMap.values()].sort(
    (a, b) => b.fileCount - a.fileCount || b.callSites - a.callSites
  );

  const truncated = callersByFile.size > IMPACT_BOUNDS.FANOUT_FILE_CAP;

  return {
    sourcePath,
    sourceSymbol,
    sourceLine,
    truncated,
    totalCallerFiles: callersByFile.size,
    totalCallSites: dedupCallers.length,
    callers: truncated ? [] : dedupCallers.slice(0, 40),
    byDomain,
  };
}
