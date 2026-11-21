import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  AtlasManifest,
  CompareMode,
  DiffFileStat,
  GitContext,
  IndirectImpactReport,
  LspDiagnosticImpact,
  LspReferenceImpact,
} from '../core/types.js';
import { getDiffHunks } from '../core/git.js';
import {
  aggregateCallerLocations,
  canRunLspImpact,
  IMPACT_BOUNDS,
  prioritizeChangedFiles,
} from '../core/impact.js';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
  });
}

function collectInnermostSymbols(
  symbols: vscode.DocumentSymbol[],
  ranges: Array<{ start: number; end: number }>,
  out: vscode.DocumentSymbol[]
): void {
  for (const sym of symbols) {
    const sStart = sym.range.start.line + 1;
    const sEnd = sym.range.end.line + 1;
    const intersects = ranges.some((r) => r.start <= sEnd && r.end >= sStart);
    if (!intersects) continue;

    const beforeLen = out.length;
    if (sym.children && sym.children.length > 0) {
      collectInnermostSymbols(sym.children, ranges, out);
    }
    if (out.length === beforeLen) {
      out.push(sym);
    }
  }
}

export async function analyzeWorkspaceIndirectImpact(params: {
  gitCtx: GitContext;
  baseRef: string;
  targetRef?: string;
  resolvedTargetSha?: string;
  compareMode?: CompareMode;
  diffStats: DiffFileStat[];
  manifest?: AtlasManifest;
}): Promise<IndirectImpactReport> {
  const { gitCtx, baseRef, targetRef, resolvedTargetSha, compareMode, diffStats, manifest } = params;

  const gate = canRunLspImpact(gitCtx, targetRef, resolvedTargetSha);
  if (!gate.allowed) {
    return {
      status: 'skipped-snapshot-mismatch',
      reason: gate.reason,
      lspReferences: [],
      lspDiagnostics: [],
      unresolvedDeletions: [],
      budgetExhausted: false,
    };
  }

  if (diffStats.length === 0) {
    return {
      status: 'skipped-no-diff',
      reason: 'No changed files relative to baseRef.',
      lspReferences: [],
      lspDiagnostics: [],
      unresolvedDeletions: [],
      budgetExhausted: false,
    };
  }

  const deadline = Date.now() + IMPACT_BOUNDS.TOTAL_BUDGET_MS;
  let budgetExhausted = false;

  const prioritized = prioritizeChangedFiles(diffStats, IMPACT_BOUNDS.MAX_FILES);
  const changedFiles = new Set(diffStats.map((d) => d.path.replace(/\\/g, '/')));
  const hunks = await getDiffHunks(
    gitCtx.repoRoot,
    baseRef,
    targetRef,
    compareMode ?? 'direct-diff'
  );
  const hunkByPath = new Map(hunks.map((h) => [h.path, h]));

  const candidateSymbols: Array<{
    filePath: string;
    uri: vscode.Uri;
    symbolName: string;
    pos: vscode.Position;
    line: number;
  }> = [];
  const unresolvedDeletions: Array<{ path: string; oldStart: number; oldCount: number }> = [];
  const seenSymKey = new Set<string>();

  for (const fileStat of prioritized) {
    if (Date.now() >= deadline || candidateSymbols.length >= IMPACT_BOUNDS.MAX_SYMBOLS) {
      budgetExhausted = true;
      break;
    }
    const h = hunkByPath.get(fileStat.path);
    if (!h) continue;

    for (const del of h.deletedOnlyHunks) {
      unresolvedDeletions.push({ path: fileStat.path, oldStart: del.oldStart, oldCount: del.oldCount });
    }
    if (h.addedRanges.length === 0) continue;

    const uri = vscode.Uri.file(path.join(gitCtx.repoRoot, fileStat.path));
    const rawSyms = await withTimeout(
      Promise.resolve(
        vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
          'vscode.executeDocumentSymbolProvider',
          uri
        )
      ),
      IMPACT_BOUNDS.PER_SYMBOL_TIMEOUT_MS
    );
    if (!rawSyms || rawSyms.length === 0) continue;

    // Only use hierarchical DocumentSymbol with exact selectionRange
    const docSyms = rawSyms.filter((s): s is vscode.DocumentSymbol => 'selectionRange' in s);
    const matched: vscode.DocumentSymbol[] = [];
    collectInnermostSymbols(docSyms, h.addedRanges, matched);

    for (const sym of matched) {
      if (candidateSymbols.length >= IMPACT_BOUNDS.MAX_SYMBOLS) break;
      const pos = sym.selectionRange.start;
      const key = `${fileStat.path}:${pos.line}:${pos.character}`;
      if (seenSymKey.has(key)) continue;
      seenSymKey.add(key);
      candidateSymbols.push({
        filePath: fileStat.path,
        uri,
        symbolName: sym.name,
        pos,
        line: pos.line + 1,
      });
    }
  }

  // Bounded concurrent ReferenceProvider queries
  const lspReferences: LspReferenceImpact[] = [];
  let idx = 0;

  async function worker() {
    while (idx < candidateSymbols.length) {
      if (Date.now() >= deadline) {
        budgetExhausted = true;
        return;
      }
      const item = candidateSymbols[idx++];
      const locs = await withTimeout(
        Promise.resolve(
          vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            item.uri,
            item.pos
          )
        ),
        IMPACT_BOUNDS.PER_SYMBOL_TIMEOUT_MS
      );
      if (!locs || locs.length === 0) continue;

      const rawCallers: Array<{ path: string; line: number }> = [];
      for (const loc of locs) {
        const rel = path.relative(gitCtx.repoRoot, loc.uri.fsPath).replace(/\\/g, '/');
        if (!rel || rel.startsWith('..')) continue;
        rawCallers.push({ path: rel, line: loc.range.start.line + 1 });
      }

      const aggregated = aggregateCallerLocations({
        sourcePath: item.filePath,
        sourceSymbol: item.symbolName,
        sourceLine: item.line,
        rawCallers,
        changedFiles,
        manifest,
      });
      if (aggregated) {
        lspReferences.push(aggregated);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(IMPACT_BOUNDS.CONCURRENCY, candidateSymbols.length) },
    () => worker()
  );
  await Promise.all(workers);

  // Collect Error diagnostics in unmodified workspace files (catches broken callers of deleted/renamed/signature-changed symbols!)
  const lspDiagnostics: LspDiagnosticImpact[] = [];
  const allDiags = vscode.languages.getDiagnostics();
  let diagFiles = 0;

  for (const [uri, diags] of allDiags) {
    if (diagFiles >= IMPACT_BOUNDS.MAX_DIAGNOSTIC_FILES) break;
    const rel = path.relative(gitCtx.repoRoot, uri.fsPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || changedFiles.has(rel)) continue;

    const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    if (errors.length === 0) continue;
    diagFiles += 1;

    for (const err of errors.slice(0, 3)) {
      lspDiagnostics.push({
        path: rel,
        line: err.range.start.line + 1,
        message: err.message,
        source: err.source,
      });
    }
  }

  return {
    status: 'ok',
    lspReferences,
    lspDiagnostics,
    unresolvedDeletions,
    budgetExhausted,
  };
}
