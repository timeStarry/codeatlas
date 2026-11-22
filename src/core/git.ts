import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { CompareMode, DiffFileStat, FileDiffHunks, GitContext, WorktreeInfo } from './types.js';

const execFileAsync = promisify(execFile);

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export async function getRepoRoot(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  return path.normalize(out.trim());
}

/**
 * Returns per-worktree runtime state directory inside `<git-dir>/codeatlas`.
 * Strictly isolated per linked worktree and 100% invisible to `git status` / `git diff`.
 */
export async function getGitStateDir(repoRoot: string): Promise<string> {
  const out = await runGit(repoRoot, ['rev-parse', '--git-dir']);
  const gitDir = path.resolve(repoRoot, out.trim());
  return path.join(gitDir, 'codeatlas');
}

export async function getGitCommonDir(repoRoot: string): Promise<string> {
  try {
    const out = await runGit(repoRoot, ['rev-parse', '--git-common-dir']);
    return path.resolve(repoRoot, out.trim());
  } catch {
    const out = await runGit(repoRoot, ['rev-parse', '--git-dir']);
    return path.resolve(repoRoot, out.trim());
  }
}

/**
 * Adds or removes `/.atlas/` in `<git-common-dir>/info/exclude` so workspace `.atlas/`
 * files stay 100% ignored locally without touching the repository's `.gitignore`.
 */
export async function syncLocalGitExclude(
  repoRoot: string,
  shouldExclude: boolean,
  pattern = '/.atlas/'
): Promise<void> {
  const commonDir = await getGitCommonDir(repoRoot);
  const excludePath = path.join(commonDir, 'info', 'exclude');
  await fs.mkdir(path.dirname(excludePath), { recursive: true });

  let raw = '';
  try {
    raw = await fs.readFile(excludePath, 'utf-8');
  } catch {
    raw = '';
  }

  const lines = raw.split(/\r?\n/);
  const hasEntry = lines.some((l) => l.trim() === pattern || l.trim() === '.atlas/' || l.trim() === '.atlas');

  if (shouldExclude && !hasEntry) {
    const prefix = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
    await fs.writeFile(excludePath, `${raw}${prefix}${pattern}\n`, 'utf-8');
  } else if (!shouldExclude && hasEntry) {
    const filtered = lines.filter((l) => l.trim() !== pattern);
    await fs.writeFile(excludePath, filtered.join('\n'), 'utf-8');
  }
}

export async function resolveEffectiveBaseRef(
  repoRoot: string,
  baseRef: string,
  targetRef?: string,
  compareMode: CompareMode = 'direct-diff'
): Promise<string> {
  if (compareMode !== 'merge-base') {
    return baseRef;
  }
  const target = !targetRef || targetRef === 'WORKTREE' ? 'HEAD' : targetRef;
  try {
    const out = await runGit(repoRoot, ['merge-base', baseRef, target]);
    return out.trim() || baseRef;
  } catch {
    return baseRef;
  }
}

export async function resolveRef(repoRoot: string, ref: string): Promise<string | undefined> {
  if (!ref || ref === 'WORKTREE') {
    return undefined;
  }
  try {
    const out = await runGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
    return out.trim();
  } catch {
    return undefined;
  }
}

export async function getGitContext(cwd: string): Promise<GitContext> {
  const repoRoot = await getRepoRoot(cwd);
  let headSha = '';
  let shortSha = 'UNBORN';
  let branch = 'HEAD';

  try {
    headSha = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
    shortSha = headSha.slice(0, 8);
  } catch {
    headSha = '';
  }

  try {
    const b = (await runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD'])).trim();
    if (b) branch = b;
  } catch {
    branch = headSha ? `detached@${shortSha}` : 'unborn';
  }

  let dirtyCount = 0;
  try {
    const statusOut = await runGit(repoRoot, ['status', '--porcelain']);
    dirtyCount = statusOut
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
  } catch {
    dirtyCount = 0;
  }

  const worktrees = await listWorktrees(repoRoot);
  const recentRefs = await listRecentRefs(repoRoot);

  return {
    repoRoot,
    headSha,
    shortSha,
    branch,
    dirtyCount,
    worktrees,
    recentRefs,
  };
}

export async function listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  try {
    const out = await runGit(repoRoot, ['worktree', 'list', '--porcelain']);
    const blocks = out.trim().split(/\r?\n\r?\n/);
    const normalizedRoot = path.normalize(repoRoot).toLowerCase();
    const result: WorktreeInfo[] = [];

    for (const block of blocks) {
      if (!block.trim()) continue;
      let wtPath = '';
      let head = '';
      let branch: string | undefined;

      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
          wtPath = path.normalize(line.slice('worktree '.length).trim());
        } else if (line.startsWith('HEAD ')) {
          head = line.slice('HEAD '.length).trim();
        } else if (line.startsWith('branch ')) {
          branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
        }
      }
      if (wtPath) {
        result.push({
          path: wtPath,
          head,
          branch,
          isCurrent: wtPath.toLowerCase() === normalizedRoot,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

export async function listRecentRefs(repoRoot: string): Promise<string[]> {
  const result: string[] = [];
  if (await resolveRef(repoRoot, 'HEAD~1')) {
    result.push('HEAD~1');
  }
  if (await resolveRef(repoRoot, 'HEAD')) {
    result.push('HEAD');
  }
  try {
    const out = await runGit(repoRoot, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)',
      '--count=12',
      'refs/heads',
      'refs/tags',
    ]);
    for (const s of out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      if (!result.includes(s)) result.push(s);
    }
  } catch {
    // ignore
  }
  return result.length > 0 ? result : ['HEAD'];
}

export async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const out = await runGit(repoRoot, ['ls-files']);
    return out
      .split(/\r?\n/)
      .map((s) => s.trim().replace(/\\/g, '/'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export interface BranchCommitInfo {
  sha: string;
  subject: string;
}

export async function getBranchCommits(
  repoRoot: string,
  baseRef?: string,
  limit = 10
): Promise<BranchCommitInfo[]> {
  const args = ['log', `--max-count=${limit}`, '--format=%h%x09%s'];
  if (baseRef && baseRef !== 'HEAD') {
    args.push(`${baseRef}..HEAD`);
  }
  try {
    const out = await runGit(repoRoot, args);
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split('\t');
        return { sha, subject: rest.join('\t') };
      });
  } catch {
    return [];
  }
}

export async function getDiffStats(
  repoRoot: string,
  baseRef?: string,
  targetRef?: string,
  compareMode: CompareMode = 'direct-diff'
): Promise<DiffFileStat[]> {
  const rangeArgs: string[] = [];
  if (baseRef) {
    const effectiveBase = await resolveEffectiveBaseRef(repoRoot, baseRef, targetRef, compareMode);
    if (targetRef && targetRef !== 'WORKTREE') {
      rangeArgs.push(effectiveBase, targetRef);
    } else {
      rangeArgs.push(effectiveBase);
    }
  }

  const stats: DiffFileStat[] = [];
  try {
    const [numstatOut, nameStatusOut] = await Promise.all([
      runGit(repoRoot, ['diff', '--numstat', ...rangeArgs]),
      runGit(repoRoot, ['diff', '--name-status', ...rangeArgs]),
    ]);

    const statusMap = new Map<string, string>();
    for (const line of nameStatusOut.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const filePath = parts[parts.length - 1].replace(/\\/g, '/');
        statusMap.set(filePath, parts[0]);
      }
    }

    for (const line of numstatOut.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        const filePath = parts[2].replace(/\\/g, '/');
        stats.push({
          path: filePath,
          status: statusMap.get(filePath) ?? 'M',
          additions: add,
          deletions: del,
        });
      }
    }
  } catch {
    // diff may fail on unborn repo with 0 commits; continue to untracked scan
  }

  // Include untracked files when comparing against working tree
  if (!targetRef || targetRef === 'WORKTREE') {
    try {
      const untrackedOut = await runGit(repoRoot, [
        'ls-files',
        '--others',
        '--exclude-standard',
      ]);
      const seen = new Set(stats.map((s) => s.path));
      for (const line of untrackedOut.split(/\r?\n/)) {
        const p = line.trim().replace(/\\/g, '/');
        if (p && !seen.has(p)) {
          stats.push({ path: p, status: '?', additions: 0, deletions: 0 });
        }
      }
    } catch {
      // ignore
    }
  }

  return stats;
}

export async function readFileAtRef(
  repoRoot: string,
  relPath: string,
  ref?: string
): Promise<string | undefined> {
  const posixPath = relPath.replace(/\\/g, '/').replace(/^\.\//, '');

  if (!ref || ref === 'WORKTREE') {
    try {
      const fullPath = path.join(repoRoot, posixPath);
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  try {
    return await runGit(repoRoot, ['show', `${ref}:${posixPath}`]);
  } catch {
    return undefined;
  }
}

export async function getFileDiff(
  repoRoot: string,
  relPath: string,
  baseRef?: string,
  targetRef?: string,
  compareMode: CompareMode = 'direct-diff'
): Promise<string> {
  const posixPath = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const args = ['diff', '--unified=3'];
  if (baseRef) {
    const effectiveBase = await resolveEffectiveBaseRef(repoRoot, baseRef, targetRef, compareMode);
    if (targetRef && targetRef !== 'WORKTREE') {
      args.push(effectiveBase, targetRef);
    } else {
      args.push(effectiveBase);
    }
  }
  args.push('--', posixPath);
  try {
    return await runGit(repoRoot, args);
  } catch {
    return '';
  }
}

export async function getDiffHunks(
  repoRoot: string,
  baseRef: string,
  targetRef?: string,
  compareMode: CompareMode = 'direct-diff'
): Promise<FileDiffHunks[]> {
  const effectiveBase = await resolveEffectiveBaseRef(repoRoot, baseRef, targetRef, compareMode);
  const args = ['diff', '-U0', '--no-color', effectiveBase];
  if (targetRef && targetRef !== 'WORKTREE') {
    args.push(targetRef);
  }

  let out = '';
  try {
    out = await runGit(repoRoot, args);
  } catch {
    return [];
  }

  const results: FileDiffHunks[] = [];
  let current: FileDiffHunks | undefined;
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      const filePath = line.slice('+++ b/'.length).trim().replace(/\\/g, '/');
      current = { path: filePath, addedRanges: [], deletedOnlyHunks: [] };
      results.push(current);
      continue;
    }
    if (line.startsWith('+++ /dev/null')) {
      current = undefined;
      continue;
    }
    if (!current) continue;
    const m = hunkRe.exec(line);
    if (!m) continue;
    const oldStart = parseInt(m[1], 10);
    const oldCount = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    const newStart = parseInt(m[3], 10);
    const newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;

    if (newCount === 0) {
      current.deletedOnlyHunks.push({
        oldStart,
        oldCount,
        newAnchorLine: Math.max(1, newStart),
      });
    } else {
      current.addedRanges.push({
        start: newStart,
        end: newStart + newCount - 1,
      });
    }
  }

  return results;
}

/**
 * Computes exact 1-based modified/added line sets ONLY for the specified file paths
 * (`git diff -U0 <baseRef> -- <paths>`), used to highlight diff-impacted AST symbols.
 */
export async function getChangedLinesForFiles(
  repoRoot: string,
  baseRef: string | undefined,
  relPaths: string[],
  diffStats?: DiffFileStat[],
  targetRef?: string,
  compareMode: CompareMode = 'direct-diff'
): Promise<Map<string, Set<number>>> {
  const map = new Map<string, Set<number>>();
  const targets = [
    ...new Set(relPaths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean)),
  ];
  if (targets.length === 0) return map;

  const untrackedSet = new Set(
    (diffStats ?? [])
      .filter((d) => d.status === '?')
      .map((d) => d.path.replace(/\\/g, '/').replace(/^\.\//, ''))
  );

  const gitTargets: string[] = [];
  for (const t of targets) {
    if (untrackedSet.has(t)) {
      const fullSet = new Set<number>();
      for (let ln = 1; ln <= 4000; ln++) fullSet.add(ln);
      map.set(t, fullSet);
    } else {
      gitTargets.push(t);
    }
  }

  if (gitTargets.length === 0) return map;

  const effectiveBase = baseRef
    ? await resolveEffectiveBaseRef(repoRoot, baseRef, targetRef, compareMode)
    : 'HEAD';
  const args = ['diff', '-U0', '--no-color', effectiveBase];
  if (targetRef && targetRef !== 'WORKTREE') {
    args.push(targetRef);
  }
  args.push('--', ...gitTargets);

  let out = '';
  try {
    out = await runGit(repoRoot, args);
  } catch {
    return map;
  }

  let currentFile = '';
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length).trim().replace(/\\/g, '/');
      if (!map.has(currentFile)) map.set(currentFile, new Set<number>());
      continue;
    }
    if (line.startsWith('+++ /dev/null')) {
      currentFile = '';
      continue;
    }
    if (!currentFile) continue;
    const m = hunkRe.exec(line);
    if (!m) continue;
    const newStart = parseInt(m[3], 10);
    const newCount = m[4] !== undefined ? parseInt(m[4], 10) : 1;
    const lineSet = map.get(currentFile)!;

    if (newCount === 0) {
      lineSet.add(Math.max(1, newStart));
    } else {
      const end = Math.min(newStart + newCount - 1, newStart + 4000);
      for (let ln = newStart; ln <= end; ln++) {
        lineSet.add(ln);
      }
    }
  }

  return map;
}
