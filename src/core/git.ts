import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { DiffFileStat, GitContext, WorktreeInfo } from './types.js';

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

export async function getDiffStats(
  repoRoot: string,
  baseRef?: string,
  targetRef?: string
): Promise<DiffFileStat[]> {
  const args = ['diff', '--numstat', '--name-status'];
  // Run two focused commands so parsing is exact and clean
  const rangeArgs: string[] = [];
  if (baseRef && targetRef && targetRef !== 'WORKTREE') {
    rangeArgs.push(baseRef, targetRef);
  } else if (baseRef) {
    rangeArgs.push(baseRef);
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
  targetRef?: string
): Promise<string> {
  const posixPath = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const args = ['diff', '--unified=3'];
  if (baseRef && targetRef && targetRef !== 'WORKTREE') {
    args.push(baseRef, targetRef);
  } else if (baseRef) {
    args.push(baseRef);
  }
  args.push('--', posixPath);
  try {
    return await runGit(repoRoot, args);
  } catch {
    return '';
  }
}
