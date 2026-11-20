import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyBriefing } from '../src/core/verifier.js';
import { buildAtlasGraph } from '../src/core/graph.js';
import { BriefingReport } from '../src/core/types.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout.trim();
}

async function createTempRepo(): Promise<{ dir: string; baseSha: string; headSha: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeatlas-test-'));
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@codeatlas.local']);
  await git(dir, ['config', 'user.name', 'CodeAtlas Test']);

  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'src', 'sync.ts'),
    ['export function syncDoc(dirty: boolean) {', '  return "updated";', '}'].join('\n'),
    'utf-8'
  );
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'base commit']);
  const baseSha = await git(dir, ['rev-parse', 'HEAD']);

  await fs.writeFile(
    path.join(dir, 'src', 'sync.ts'),
    [
      'export function syncDoc(dirty: boolean) {',
      '  if (dirty) {',
      '    return "conflict";',
      '  }',
      '  return "updated";',
      '}',
    ].join('\n'),
    'utf-8'
  );
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'add conflict guard']);
  const headSha = await git(dir, ['rev-parse', 'HEAD']);

  return { dir, baseSha, headSha };
}

test('verifyBriefing marks valid fact anchors and blocking conditions as verified', async () => {
  const { dir, baseSha, headSha } = await createTempRepo();
  try {
    const briefing: BriefingReport = {
      schemaVersion: '0.1',
      title: 'Add dirty conflict guard',
      baseRef: baseSha,
      targetRef: headSha,
      summary: 'Prevent overwriting dirty documents.',
      blockingConditions: [
        {
          id: 'B1',
          condition: 'dirty === true',
          outcome: 'Returns conflict without overwriting',
          anchor: { path: 'src/sync.ts', startLine: 2, endLine: 4, symbol: 'if (dirty)' },
        },
      ],
      claims: [
        {
          id: 'C1',
          title: 'Dirty branch added',
          statement: 'syncDoc returns conflict when dirty is true.',
          claimType: 'fact',
          expectChanged: true,
          anchors: [{ path: 'src/sync.ts', startLine: 1, endLine: 4, symbol: 'syncDoc' }],
        },
      ],
    };

    const res = await verifyBriefing(dir, briefing);
    assert.equal(res.overallBadge, 'verified');
    assert.equal(res.isStale, false);
    assert.equal(res.summaryCounts.verified, 1);
    assert.equal(res.blockingConditions[0].badge, 'verified');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('verifyBriefing flags hallucinated symbols and out-of-bounds lines as mismatch', async () => {
  const { dir, headSha } = await createTempRepo();
  try {
    const briefing: BriefingReport = {
      schemaVersion: '0.1',
      title: 'Hallucinated claim',
      targetRef: headSha,
      summary: 'Claims a nonexistent symbol.',
      claims: [
        {
          id: 'C1',
          title: 'Nonexistent symbol',
          statement: 'Calls ghostFunction.',
          claimType: 'fact',
          anchors: [{ path: 'src/sync.ts', startLine: 1, endLine: 99, symbol: 'ghostFunction' }],
        },
      ],
    };

    const res = await verifyBriefing(dir, briefing);
    assert.equal(res.overallBadge, 'mismatch');
    assert.equal(res.summaryCounts.mismatch, 1);
    assert.equal(res.claims[0].anchors[0].lineRangeValid, false);
    assert.equal(res.claims[0].anchors[0].symbolMatched, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('verifyBriefing marks older targetRef as stale and keeps inference unverified', async () => {
  const { dir, baseSha } = await createTempRepo();
  try {
    const briefing: BriefingReport = {
      schemaVersion: '0.1',
      title: 'Old snapshot briefing',
      targetRef: baseSha,
      summary: 'Targeting baseSha after HEAD moved.',
      claims: [
        {
          id: 'C1',
          title: 'Base fact',
          statement: 'syncDoc exists at baseSha.',
          claimType: 'fact',
          anchors: [{ path: 'src/sync.ts', startLine: 1, endLine: 3, symbol: 'syncDoc' }],
        },
        {
          id: 'C2',
          title: 'Semantic inference',
          statement: 'Callers probably handle updated status.',
          claimType: 'inference',
          anchors: [{ path: 'src/sync.ts', startLine: 2, endLine: 2 }],
        },
      ],
    };

    const res = await verifyBriefing(dir, briefing);
    assert.equal(res.isStale, true);
    assert.equal(res.overallBadge, 'stale');
    assert.equal(res.claims[0].badge, 'stale');
    assert.equal(res.claims[1].badge, 'stale');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('buildAtlasGraph generates domain, claim, evidence, blocking fork, and directive nodes', async () => {
  const { dir, baseSha, headSha } = await createTempRepo();
  try {
    const briefing: BriefingReport = {
      schemaVersion: '0.1',
      title: 'Sync guard',
      baseRef: baseSha,
      targetRef: headSha,
      summary: 'Guards dirty docs.',
      blockingConditions: [
        {
          id: 'B1',
          condition: 'dirty === true',
          outcome: 'conflict',
          anchor: { path: 'src/sync.ts', startLine: 2, endLine: 4, symbol: 'if (dirty)' },
        },
      ],
      claims: [
        {
          id: 'C1',
          title: 'Dirty branch',
          statement: 'Handles dirty branch.',
          claimType: 'fact',
          anchors: [{ path: 'src/sync.ts', startLine: 1, endLine: 4, symbol: 'syncDoc' }],
        },
      ],
    };

    const verification = await verifyBriefing(dir, briefing);
    const graph = buildAtlasGraph({
      git: {
        repoRoot: dir,
        headSha,
        shortSha: headSha.slice(0, 8),
        branch: 'main',
        dirtyCount: 0,
        worktrees: [],
        recentRefs: ['HEAD~1'],
      },
      diffStats: [{ path: 'src/sync.ts', status: 'M', additions: 3, deletions: 0 }],
      verification,
      directives: [
        {
          id: 'd1',
          createdAt: new Date().toISOString(),
          ref: headSha.slice(0, 8),
          path: 'src/sync.ts',
          startLine: 2,
          kind: 'rework',
          note: 'Add telemetry on conflict',
        },
      ],
    });

    assert.ok(graph.nodes.some((n) => n.kind === 'root'));
    assert.ok(graph.nodes.some((n) => n.kind === 'domain'));
    assert.ok(graph.nodes.some((n) => n.kind === 'claim'));
    assert.ok(graph.nodes.some((n) => n.kind === 'evidence'));
    assert.ok(graph.nodes.some((n) => n.kind === 'blocking'));
    assert.ok(graph.nodes.some((n) => n.kind === 'directive'));
    assert.ok(graph.edges.some((e) => e.kind === 'blocking'));
    assert.ok(graph.edges.some((e) => e.kind === 'directive'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
