import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFile, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import * as readline from 'node:readline';
import { getGitContext, getGitStateDir } from '../src/core/git.js';
import { listDirectives } from '../src/core/store.js';

const execFileAsync = promisify(execFile);
const MCP_SERVER_SCRIPT = path.resolve(__dirname, '..', 'dist', 'mcp-server.js');

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout.trim();
}

async function createTempGitRepo(): Promise<{ dir: string; headSha: string }> {
  const rawDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeatlas-mcpapp-repo-'));
  const dir = realpathSync.native(rawDir);
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@codeatlas.local']);
  await git(dir, ['config', 'user.name', 'CodeAtlas Test']);

  await fs.mkdir(path.join(dir, 'src', 'core'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'src', 'core', 'engine.ts'),
    'export function computeScore(x: number): number {\n  if (x <= 0) return 0;\n  return x * 10;\n}\n',
    'utf-8'
  );
  await fs.writeFile(
    path.join(dir, 'src', 'index.ts'),
    'import { computeScore } from "./core/engine.js";\nexport const result = computeScore(5);\n',
    'utf-8'
  );
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'initial commit']);
  const headSha = await git(dir, ['rev-parse', 'HEAD']);
  return { dir, headSha };
}

class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (val: any) => void; reject: (err: Error) => void }
  >();

  constructor(cwd: string, extraArgs: string[] = []) {
    this.proc = spawn(process.execPath, [MCP_SERVER_SCRIPT, ...extraArgs], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const rl = readline.createInterface({ input: this.proc.stdout, terminal: false });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const msg = JSON.parse(trimmed);
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
        } else {
          entry.resolve(msg.result);
        }
      }
    });
  }

  public request(method: string, params?: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  public async close(): Promise<void> {
    this.proc.stdin.end();
    this.proc.kill();
    await new Promise((r) => setTimeout(r, 40));
  }
}

test('MCP App server advertises resources capability, serves ui://codeatlas/app.html, supports {} launch, and syncs directives via <git-dir>/codeatlas/', async () => {
  const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeatlas-nongit-'));
  const { dir: repoDir } = await createTempGitRepo();
  const client = new McpStdioClient(nonGitDir);

  try {
    // 1. initialize advertises both tools and resources capabilities
    const initRes = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'antigravity-test', version: '1.0.0' },
    });
    assert.ok(initRes.capabilities?.tools, 'tools capability must be advertised');
    assert.ok(initRes.capabilities?.resources, 'resources capability must be advertised');

    // 2. tools/list declares open_atlas entrypoints + app-only atlas_app_action + core tools
    const toolsRes = await client.request('tools/list');
    const openAtlasTool = toolsRes.tools.find((t: any) => t.name === 'open_atlas');
    assert.ok(openAtlasTool, 'open_atlas tool must exist');
    assert.equal(openAtlasTool._meta?.ui?.resourceUri, 'ui://codeatlas/app.html');
    assert.deepEqual(openAtlasTool._meta?.ui?.visibility, ['model', 'app']);
    assert.equal(openAtlasTool.inputSchema?.required, undefined);
    const entrypoints = openAtlasTool._meta?.['com.google.antigravity/ui']?.entrypoints;
    assert.deepEqual(entrypoints, [
      { type: 'aux_pane', title: 'CodeAtlas' },
      { type: 'global', title: 'CodeAtlas' },
    ]);

    const appActionTool = toolsRes.tools.find((t: any) => t.name === 'atlas_app_action');
    assert.ok(appActionTool, 'atlas_app_action tool must exist');
    assert.deepEqual(appActionTool._meta?.ui?.visibility, ['app']);

    // 3. resources/list and resources/read serve self-contained MCP App HTML
    const listRes = await client.request('resources/list');
    assert.equal(listRes.resources.length, 1);
    assert.equal(listRes.resources[0].uri, 'ui://codeatlas/app.html');
    assert.equal(listRes.resources[0].mimeType, 'text/html;profile=mcp-app');
    assert.equal(listRes.resources[0]._meta?.ui?.prefersBorder, false);

    const readRes = await client.request('resources/read', { uri: 'ui://codeatlas/app.html' });
    assert.equal(readRes.contents.length, 1);
    const appResource = readRes.contents[0];
    assert.equal(appResource.uri, 'ui://codeatlas/app.html');
    assert.equal(appResource.mimeType, 'text/html;profile=mcp-app');
    assert.ok(appResource.text.includes('<!DOCTYPE html>'));
    assert.ok(
      Buffer.byteLength(appResource.text, 'utf-8') < 10 * 1024 * 1024,
      'HTML resource must be under 10 MiB'
    );
    assert.ok(
      appResource.text.includes('__CODEATLAS_HOST__'),
      'Bundled mcpAppClient.ts must be inlined into app HTML'
    );
    assert.equal(
      appResource.text.includes("'nonce-"),
      false,
      'mcp-app CSP must not include a script nonce that blocks inline scripts'
    );

    // 4. Empty-input launch ({}) from non-git cwd succeeds cleanly without throwing
    const emptyLaunch = await client.request('tools/call', {
      name: 'open_atlas',
      arguments: {},
    });
    assert.ok(!emptyLaunch.isError, 'open_atlas({}) must not fail');
    assert.equal(emptyLaunch.structuredContent.git, null);
    assert.ok(typeof emptyLaunch.structuredContent.error === 'string');

    // 5. open_atlas against real temp git repo returns full canvasState under 1 MiB
    const repoLaunch = await client.request('tools/call', {
      name: 'open_atlas',
      arguments: { worktreePath: repoDir, mode: 'hybrid' },
    });
    assert.ok(!repoLaunch.isError);
    assert.ok(
      Buffer.byteLength(JSON.stringify(repoLaunch), 'utf-8') < 1024 * 1024,
      'CallToolResult must be under 1 MiB'
    );
    assert.equal(
      path.normalize(repoLaunch.structuredContent.worktreePath),
      path.normalize(repoDir)
    );
    assert.ok(repoLaunch.structuredContent.git);
    assert.ok(Array.isArray(repoLaunch.structuredContent.graph.nodes));
    assert.ok(repoLaunch.structuredContent.graph.nodes.length >= 2);

    // 6. atlas_app_action addDirective persists to <git-dir>/codeatlas/ without dirtying git status
    const addDirRes = await client.request('tools/call', {
      name: 'atlas_app_action',
      arguments: {
        worktreePath: repoDir,
        action: 'addDirective',
        payload: {
          type: 'addDirective',
          kind: 'constraint',
          path: 'src/core/engine.ts',
          startLine: 2,
          note: 'Preserve non-positive guard behavior',
        },
      },
    });
    assert.ok(!addDirRes.isError);
    assert.ok(
      addDirRes.structuredContent.graph.nodes.some((n: any) => n.kind === 'directive'),
      'Updated graph must contain the wired directive node'
    );

    // Cross-host verification: store inside <git-dir>/codeatlas/ sees the directive & working tree stays clean
    const stateDir = await getGitStateDir(repoDir);
    assert.ok(stateDir.includes('.git'));
    const storedDirectives = await listDirectives(repoDir, false);
    assert.equal(storedDirectives.length, 1);
    assert.equal(storedDirectives[0].note, 'Preserve non-positive guard behavior');

    const gitCtx = await getGitContext(repoDir);
    assert.equal(gitCtx.dirtyCount, 0, 'Directive sync must never pollute git status');

    // 7. Snippet & Briefing roundtrip
    const snippetRes = await client.request('tools/call', {
      name: 'atlas_app_action',
      arguments: {
        worktreePath: repoDir,
        action: 'requestSnippet',
        payload: {
          type: 'requestSnippet',
          nodeId: 'test-node',
          path: 'src/core/engine.ts',
          startLine: 1,
          endLine: 3,
        },
      },
    });
    assert.ok(!snippetRes.isError);
    assert.ok(snippetRes.structuredContent.lines.length >= 3);

    const submitRes = await client.request('tools/call', {
      name: 'atlas_submit_briefing',
      arguments: {
        worktreePath: repoDir,
        briefing: {
          schemaVersion: '0.2',
          title: 'Engine guard verification',
          targetRef: 'WORKTREE',
          summary: 'Verifies computeScore guard.',
          claims: [
            {
              id: 'C1',
              title: 'Zero guard',
              statement: 'computeScore returns 0 for non-positive inputs.',
              claimType: 'fact',
              anchors: [
                {
                  path: 'src/core/engine.ts',
                  startLine: 1,
                  endLine: 4,
                  symbol: 'computeScore',
                },
              ],
            },
          ],
        },
      },
    });
    assert.ok(!submitRes.isError);

    const refreshed = await client.request('tools/call', {
      name: 'open_atlas',
      arguments: { worktreePath: repoDir },
    });
    assert.equal(refreshed.structuredContent.graph.summary.hasBriefing, true);
    assert.ok(refreshed.structuredContent.graph.nodes.some((n: any) => n.kind === 'claim'));
  } finally {
    await client.close();
    await fs.rm(nonGitDir, { recursive: true, force: true });
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test('open_atlas({}) auto-detects repository when server cwd is a Git worktree', async () => {
  const { dir: repoDir } = await createTempGitRepo();
  const client = new McpStdioClient(repoDir);
  try {
    await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    const res = await client.request('tools/call', { name: 'open_atlas', arguments: {} });
    assert.ok(!res.isError);
    assert.equal(path.normalize(res.structuredContent.worktreePath), path.normalize(repoDir));
    assert.ok(res.structuredContent.git);
  } finally {
    await client.close();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});
