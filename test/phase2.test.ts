import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getGitContext, getGitStateDir } from '../src/core/git.js';
import {
  ackDirective,
  claimDirective,
  createDirective,
  listDirectives,
  loadLatestBriefingRecord,
  saveBriefingRecord,
} from '../src/core/store.js';
import { verifyBriefing } from '../src/core/verifier.js';
import {
  loadAtlasManifestResult,
  matchDomainForPath,
  verifyManifest,
} from '../src/core/manifest.js';
import { aggregateCallerLocations, canRunLspImpact } from '../src/core/impact.js';
import { AtlasManifest, BriefingReport } from '../src/core/types.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout.trim();
}

async function createRepo(): Promise<{ dir: string; headSha: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeatlas-p2-'));
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@codeatlas.local']);
  await git(dir, ['config', 'user.name', 'CodeAtlas Test']);

  await fs.mkdir(path.join(dir, 'src', 'core'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'src', 'core', 'engine.ts'),
    'export function runEngine() {\n  return 42;\n}\n',
    'utf-8'
  );
  await fs.writeFile(
    path.join(dir, 'src', 'app.ts'),
    'import { runEngine } from "./core/engine";\nexport const v = runEngine();\n',
    'utf-8'
  );
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  const headSha = await git(dir, ['rev-parse', 'HEAD']);
  return { dir, headSha };
}

test('store writes inside <git-dir>/codeatlas without polluting git status, and enforces CAS + rework guard', async () => {
  const { dir, headSha } = await createRepo();
  try {
    const stateDir = await getGitStateDir(dir);
    assert.ok(stateDir.includes('.git'));

    const created = await createDirective(dir, {
      ref: headSha,
      path: 'src/core/engine.ts',
      startLine: 1,
      kind: 'rework',
      note: 'Handle zero input',
    });
    assert.equal(created.revision, 1);
    assert.equal(created.status, 'open');

    // Verify git working tree is still 100% clean!
    const ctx = await getGitContext(dir);
    assert.equal(ctx.dirtyCount, 0);

    // Agent 1 claims directive
    const claimed = await claimDirective(dir, created.id, 'agent-1', 15);
    assert.ok(claimed);
    assert.equal(claimed.status, 'claimed');
    assert.equal(claimed.revision, 2);

    // Agent 2 cannot steal active lease
    const stolen = await claimDirective(dir, created.id, 'agent-2', 15);
    assert.equal(stolen, undefined);

    // Wrong revision rejected
    const badRev = await ackDirective(dir, {
      id: created.id,
      expectedRevision: 1,
      agentId: 'agent-1',
      summary: 'Fixed',
    });
    assert.equal(badRev.ok, false);

    // Rework ack rejected when 0 code changes exist
    const noChangeAck = await ackDirective(dir, {
      id: created.id,
      expectedRevision: 2,
      agentId: 'agent-1',
      summary: 'Pretended to fix',
    });
    assert.equal(noChangeAck.ok, false);

    // After real code edit, ack succeeds!
    await fs.writeFile(
      path.join(dir, 'src', 'core', 'engine.ts'),
      'export function runEngine(x = 1) {\n  return x === 0 ? 0 : 42;\n}\n',
      'utf-8'
    );
    const okAck = await ackDirective(dir, {
      id: created.id,
      expectedRevision: 2,
      agentId: 'agent-1',
      summary: 'Added zero guard',
      evidenceAnchor: { path: 'src/core/engine.ts', startLine: 1, endLine: 3, symbol: 'runEngine' },
    });
    assert.equal(okAck.ok, true);
    if (okAck.ok) {
      assert.equal(okAck.directive.status, 'resolved');
      assert.equal(okAck.directive.revision, 3);
    }

    const openOnly = await listDirectives(dir, false);
    assert.equal(openOnly.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('briefing v0.2 caps agent-declared impacts at unverified and fails mismatch on invalid target', async () => {
  const { dir, headSha } = await createRepo();
  try {
    const validImpactBriefing: BriefingReport = {
      schemaVersion: '0.2',
      title: 'IPC contract briefing',
      targetRef: headSha,
      summary: 'Tests v0.2 declared impacts.',
      claims: [
        {
          id: 'C1',
          title: 'Engine exists',
          statement: 'runEngine returns 42.',
          claimType: 'fact',
          anchors: [{ path: 'src/core/engine.ts', startLine: 1, endLine: 3, symbol: 'runEngine' }],
        },
      ],
      impacts: [
        {
          id: 'I1',
          relation: 'event',
          description: 'App consumes runEngine output.',
          sourceAnchor: { path: 'src/core/engine.ts', startLine: 1, symbol: 'runEngine' },
          targetAnchor: { path: 'src/app.ts', startLine: 2, symbol: 'runEngine' },
        },
      ],
    };

    const res = await verifyBriefing(dir, validImpactBriefing);
    assert.equal(res.impacts.length, 1);
    assert.equal(res.impacts[0].badge, 'unverified'); // capped, never 'verified'

    // Persist and reload via store
    await saveBriefingRecord(dir, validImpactBriefing, res);
    const latest = await loadLatestBriefingRecord(dir);
    assert.ok(latest);
    assert.equal(latest.briefing.title, 'IPC contract briefing');

    // Broken target anchor must downgrade overallBadge to mismatch
    const brokenBriefing: BriefingReport = {
      ...validImpactBriefing,
      impacts: [
        {
          id: 'I2',
          relation: 'ipc',
          description: 'Hallucinated consumer.',
          sourceAnchor: { path: 'src/core/engine.ts', startLine: 1, symbol: 'runEngine' },
          targetAnchor: { path: 'src/ghost.ts', startLine: 10, symbol: 'nope' },
        },
      ],
    };
    const badRes = await verifyBriefing(dir, brokenBriefing);
    assert.equal(badRes.impacts[0].badge, 'mismatch');
    assert.equal(badRes.overallBadge, 'mismatch');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('manifest loader reports invalid JSON, longest-prefix matching wins, and verifyManifest catches globs & dead paths', async () => {
  const { dir } = await createRepo();
  try {
    await fs.mkdir(path.join(dir, '.atlas'), { recursive: true });
    await fs.writeFile(path.join(dir, '.atlas', 'manifest.json'), '{ broken json', 'utf-8');
    const invalidRes = await loadAtlasManifestResult(dir);
    assert.equal(invalidRes.status, 'invalid');

    const manifest: AtlasManifest = {
      schemaVersion: '0.1',
      domains: [
        { id: 'all-src', name: 'All Src', description: 'Broad', paths: ['src'] },
        { id: 'core', name: 'Core', description: 'Core', paths: ['src/core'] },
        { id: 'bad', name: 'Bad', description: 'Globs & dead', paths: ['src/**', 'nonexistent/dir'] },
      ],
    };
    // Longest prefix wins even though 'src' appears before 'src/core'
    assert.equal(matchDomainForPath('src/core/engine.ts', manifest), 'Core');
    assert.equal(matchDomainForPath('src/app.ts', manifest), 'All Src');

    const drift = await verifyManifest(dir, manifest);
    assert.equal(drift.valid, false);
    assert.ok(drift.issues.some((i) => i.target === 'src/**'));
    assert.ok(drift.issues.some((i) => i.target === 'nonexistent/dir'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('impact precondition gate rejects stale historical refs and collapses high-fanout (>12 files) by domain', () => {
  const gate = canRunLspImpact(
    {
      repoRoot: '/repo',
      headSha: 'aaaa1111',
      shortSha: 'aaaa1111',
      branch: 'main',
      dirtyCount: 2,
      worktrees: [],
      recentRefs: ['HEAD'],
    },
    'bbbb2222',
    'bbbb2222'
  );
  assert.equal(gate.allowed, false);

  const rawCallers = Array.from({ length: 18 }, (_, i) => ({
    path: i < 10 ? `src/ui/comp${i}.ts` : `src/api/route${i}.ts`,
    line: i + 1,
  }));
  const imp = aggregateCallerLocations({
    sourcePath: 'src/core/util.ts',
    sourceSymbol: 'esc',
    sourceLine: 5,
    rawCallers,
    changedFiles: new Set(['src/core/util.ts']),
  });
  assert.ok(imp);
  assert.equal(imp.truncated, true);
  assert.equal(imp.totalCallerFiles, 18);
  assert.equal(imp.callers.length, 0);
  assert.equal(imp.byDomain.length, 2);
  assert.equal(imp.byDomain[0].sampleFiles.length, 5);
});
