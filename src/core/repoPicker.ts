import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { listWorktrees } from './git.js';

export interface DiscoveredRepoItem {
  name: string;
  path: string;
  branch?: string;
  isCurrent?: boolean;
  source: 'recent' | 'worktree' | 'sibling';
}

export interface DirEntryItem {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface DirectoryBrowserListing {
  currentPath: string;
  parentPath: string | null;
  drives?: string[];
  entries: DirEntryItem[];
  currentIsGitRepo: boolean;
  error?: string;
}

const SKIP_BROWSE_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  '.next',
  '.turbo',
  '__pycache__',
  '.venv',
  'venv',
  '$recycle.bin',
  'system volume information',
]);

function normalizeRepoKey(p: string): string {
  const norm = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

async function hasDotGit(dirPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(dirPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Fast zero-spawn branch reader directly from `.git/HEAD` (supports both normal `.git/` dirs and worktree `.git` gitfiles).
 */
async function readFastGitBranch(repoDir: string): Promise<string | undefined> {
  try {
    const dotGitPath = path.join(repoDir, '.git');
    const st = await fs.stat(dotGitPath);
    let headFile = path.join(dotGitPath, 'HEAD');
    if (st.isFile()) {
      const ptr = (await fs.readFile(dotGitPath, 'utf-8')).trim();
      const m = /^gitdir:\s*(.+)$/i.exec(ptr);
      if (m) {
        headFile = path.resolve(repoDir, m[1].trim(), 'HEAD');
      }
    }
    const rawHead = (await fs.readFile(headFile, 'utf-8')).trim();
    if (rawHead.startsWith('ref: refs/heads/')) {
      return rawHead.slice('ref: refs/heads/'.length);
    }
    if (/^[0-9a-f]{40}$/i.test(rawHead)) {
      return rawHead.slice(0, 7);
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function discoverCandidateRepos(params: {
  currentRepoRoot?: string;
  extraRoots?: string[];
  recentPaths?: string[];
}): Promise<DiscoveredRepoItem[]> {
  const { currentRepoRoot, extraRoots = [], recentPaths = [] } = params;
  const currentKey = currentRepoRoot ? normalizeRepoKey(currentRepoRoot) : '';
  const results = new Map<string, DiscoveredRepoItem>();

  const addCandidate = async (
    dirPath: string,
    source: DiscoveredRepoItem['source'],
    knownBranch?: string
  ) => {
    const resolved = path.resolve(dirPath);
    const key = normalizeRepoKey(resolved);
    if (results.has(key)) return;
    if (!(await hasDotGit(resolved))) return;
    const branch = knownBranch ?? (await readFastGitBranch(resolved));
    results.set(key, {
      name: path.basename(resolved) || resolved,
      path: resolved,
      branch,
      isCurrent: Boolean(currentKey && key === currentKey),
      source,
    });
  };

  // 1. Current repo + its linked git worktrees
  if (currentRepoRoot) {
    await addCandidate(currentRepoRoot, 'recent');
    try {
      const wts = await listWorktrees(currentRepoRoot);
      for (const wt of wts) {
        if (wt.path) {
          await addCandidate(wt.path, 'worktree', wt.branch);
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Session recent paths
  for (const rp of recentPaths.slice(0, 12)) {
    if (rp) await addCandidate(rp, 'recent');
  }

  // 3. Scan 1-level children of workspace/parent directories (e.g. `D:\Project\*`)
  const scanRoots = new Set<string>();
  for (const r of [
    process.cwd(),
    currentRepoRoot ? path.dirname(currentRepoRoot) : '',
    ...extraRoots,
  ]) {
    if (!r) continue;
    const resolved = path.resolve(r);
    // Avoid scanning filesystem root (`C:\` or `/`) blindly unless user explicitly browses it
    if (path.dirname(resolved) === resolved) continue;
    scanRoots.add(resolved);
  }

  for (const rootDir of scanRoots) {
    await addCandidate(rootDir, 'sibling');
    try {
      const entries = await fs.readdir(rootDir, { withFileTypes: true });
      const subdirs = entries
        .filter((e) => e.isDirectory() && !SKIP_BROWSE_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.'))
        .slice(0, 50);

      await Promise.all(
        subdirs.map((sub) => addCandidate(path.join(rootDir, sub.name), 'sibling'))
      );
    } catch {
      // ignore unreadable root
    }
  }

  return [...results.values()].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const rank = { recent: 0, worktree: 1, sibling: 2 };
    if (rank[a.source] !== rank[b.source]) return rank[a.source] - rank[b.source];
    return a.name.localeCompare(b.name);
  });
}

async function listWindowsDrives(): Promise<string[]> {
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const found: string[] = [];
  await Promise.all(
    letters.map(async (ch) => {
      const drive = `${ch}:\\`;
      try {
        await fs.access(drive);
        found.push(drive);
      } catch {
        // drive not mounted
      }
    })
  );
  return found.sort();
}

export async function listDirectoryEntries(
  requestedDir?: string,
  fallbackStartDir?: string
): Promise<DirectoryBrowserListing> {
  const isWin = process.platform === 'win32';
  const drives = isWin ? await listWindowsDrives() : undefined;

  if (requestedDir === '__DRIVES__' && isWin) {
    return {
      currentPath: '',
      parentPath: null,
      drives: drives ?? [],
      entries: (drives ?? []).map((d) => ({ name: d, path: d, isGitRepo: false })),
      currentIsGitRepo: false,
    };
  }

  let target = (requestedDir ?? '').trim();
  if (!target) {
    target = fallbackStartDir?.trim() || process.cwd() || os.homedir();
  }
  const resolved = path.resolve(target);

  try {
    const dirents = await fs.readdir(resolved, { withFileTypes: true });
    const subdirs = dirents
      .filter((d) => d.isDirectory() && !SKIP_BROWSE_DIRS.has(d.name.toLowerCase()))
      .sort((a, b) => {
        const aDot = a.name.startsWith('.') ? 1 : 0;
        const bDot = b.name.startsWith('.') ? 1 : 0;
        if (aDot !== bDot) return aDot - bDot;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 80);

    const entries: DirEntryItem[] = await Promise.all(
      subdirs.map(async (d) => {
        const full = path.join(resolved, d.name);
        return {
          name: d.name,
          path: full,
          isGitRepo: await hasDotGit(full),
        };
      })
    );

    // Sort Git repositories to the top within the folder for fast scanning!
    entries.sort((a, b) => {
      if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const parent = path.dirname(resolved);
    const parentPath =
      parent === resolved ? (isWin ? '__DRIVES__' : null) : parent;

    return {
      currentPath: resolved,
      parentPath,
      drives,
      entries,
      currentIsGitRepo: await hasDotGit(resolved),
    };
  } catch (err: unknown) {
    return {
      currentPath: resolved,
      parentPath: isWin ? '__DRIVES__' : '/',
      drives,
      entries: [],
      currentIsGitRepo: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function runPickerProcess(
  cmd: string,
  args: string[],
  envExtra: Record<string, string>,
  timeoutMs = 120_000
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...envExtra },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill();
      resolve({ code: -1, stdout: '' });
    }, timeoutMs);

    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf-8').trim() });
    });
  });
}

/**
 * Opens a native OS folder selection dialog (Windows 11 modern Explorer dialog via TopMost STA form,
 * macOS Finder `choose folder`, or Linux `zenity`/`kdialog`). Returns `null` if cancelled.
 */
export async function openNativeFolderDialog(initialDir?: string): Promise<string | null> {
  const startDir = initialDir && initialDir.trim() ? path.resolve(initialDir.trim()) : process.cwd();

  if (process.platform === 'win32') {
    const psScript = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.TopMost = $true',
      '$owner.StartPosition = "CenterScreen"',
      '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dlg.Description = "选择本地 Git 仓库目录 (CodeAtlas)"',
      '$dlg.UseDescriptionForTitle = $true',
      'if ($env:CODEATLAS_INIT_DIR -and (Test-Path -LiteralPath $env:CODEATLAS_INIT_DIR)) { $dlg.SelectedPath = $env:CODEATLAS_INIT_DIR }',
      '$res = $dlg.ShowDialog($owner)',
      '$owner.Dispose()',
      'if ($res -eq [System.Windows.Forms.DialogResult]::OK -and $dlg.SelectedPath) { Write-Output $dlg.SelectedPath }',
    ].join('; ');

    const psArgs = ['-NoProfile', '-Sta', '-Command', psScript];
    const envExtra = { CODEATLAS_INIT_DIR: startDir };

    for (const exe of ['pwsh', 'powershell']) {
      try {
        const { code, stdout } = await runPickerProcess(exe, psArgs, envExtra);
        if (code === 0) {
          const lines = stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          const picked = lines[lines.length - 1];
          return picked ? path.resolve(picked) : null;
        }
      } catch {
        // try fallback shell
      }
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const osaScript =
      'try\n' +
      '  set initAlias to POSIX file (system attribute "CODEATLAS_INIT_DIR") as alias\n' +
      '  POSIX path of (choose folder with prompt "Select Git Repository (CodeAtlas)" default location initAlias)\n' +
      'on error number -128\n' +
      '  return ""\n' +
      'on error\n' +
      '  try\n' +
      '    POSIX path of (choose folder with prompt "Select Git Repository (CodeAtlas)")\n' +
      '  on error\n' +
      '    return ""\n' +
      '  end try\n' +
      'end try';
    try {
      const { code, stdout } = await runPickerProcess(
        'osascript',
        ['-e', osaScript],
        { CODEATLAS_INIT_DIR: startDir }
      );
      if (code === 0 && stdout) return path.resolve(stdout);
    } catch {
      // ignore
    }
    return null;
  }

  // Linux: zenity or kdialog
  for (const [exe, args] of [
    ['zenity', ['--file-selection', '--directory', '--title=Select Git Repository (CodeAtlas)']],
    ['kdialog', ['--getexistingdirectory', startDir]],
  ] as const) {
    try {
      const { code, stdout } = await runPickerProcess(exe, [...args], {});
      if (code === 0 && stdout) return path.resolve(stdout);
    } catch {
      // try next
    }
  }
  return null;
}
