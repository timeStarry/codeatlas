import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getGitContext, getGitStateDir } from '../src/core/git.js';
import { loadLatestBriefingRecord } from '../src/core/store.js';
import {
  packAnalysisContext,
  runClickToAnalyze,
} from '../src/core/runner.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true });
  return stdout.trim();
}

async function createRunnerTempRepo(): Promise<{
  dir: string;
  baseSha: string;
  headSha: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeatlas-runner-test-'));
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@codeatlas.local']);
  await git(dir, ['config', 'user.name', 'CodeAtlas Runner Test']);

  await fs.mkdir(path.join(dir, 'src', 'orders'), { recursive: true });
  await fs.mkdir(path.join(dir, 'src', 'billing'), { recursive: true });

  await fs.writeFile(
    path.join(dir, 'src', 'orders', 'checkout.ts'),
    [
      'export interface OrderInput {',
      '  amountCents: number;',
      '  frozen?: boolean;',
      '}',
      '',
      'export function submitOrder(input: OrderInput): string {',
      '  return `ok:${input.amountCents}`;',
      '}',
    ].join('\n'),
    'utf-8'
  );

  await fs.writeFile(
    path.join(dir, 'src', 'billing', 'ledger.ts'),
    [
      'import { submitOrder } from "../orders/checkout.js";',
      '',
      'export function recordCharge(amountCents: number): string {',
      '  return submitOrder({ amountCents });',
      '}',
    ].join('\n'),
    'utf-8'
  );

  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'initial commit']);
  const baseSha = await git(dir, ['rev-parse', 'HEAD']);

  // Modify checkout.ts on top of baseSha with a blocking guard
  await fs.writeFile(
    path.join(dir, 'src', 'orders', 'checkout.ts'),
    [
      'export interface OrderInput {',
      '  amountCents: number;',
      '  frozen?: boolean;',
      '}',
      '',
      'export function submitOrder(input: OrderInput): string {',
      '  if (input.frozen) {',
      '    return "blocked:account-frozen";',
      '  }',
      '  if (input.amountCents <= 0) {',
      '    throw new Error("invalid-amount");',
      '  }',
      '  return `ok:${input.amountCents}`;',
      '}',
    ].join('\n'),
    'utf-8'
  );

  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'feat: add frozen & non-positive guards']);
  const headSha = await git(dir, ['rev-parse', 'HEAD']);

  return { dir, baseSha, headSha };
}

test('runClickToAnalyze packs 1-based line numbers, strips markdown fences, and persists a verified StoredBriefingRecord in <git-dir>/codeatlas/briefings/', async () => {
  const { dir, baseSha } = await createRunnerTempRepo();
  try {
    const stages: string[] = [];
    let capturedPrompt = '';

    const record = await runClickToAnalyze({
      repoRoot: dir,
      scope: 'branch',
      baseRef: baseSha,
      lang: 'zh',
      config: { provider: 'cli-codex' },
      onProgress: (stage) => stages.push(stage),
      executorOverride: async (prompt) => {
        capturedPrompt = prompt;
        return [
          '```json',
          JSON.stringify(
            {
              schemaVersion: '0.2',
              title: '订单冻结与金额校验保护',
              baseRef: baseSha,
              targetRef: 'WORKTREE',
              summary: '为 submitOrder 增加账户冻结早退与非正金额异常拦截。',
              blockingConditions: [
                {
                  id: 'B1',
                  condition: 'input.frozen === true',
                  outcome: '直接返回 blocked:account-frozen',
                  anchor: {
                    path: 'src/orders/checkout.ts',
                    startLine: 7,
                    endLine: 9,
                    symbol: 'input.frozen',
                  },
                },
              ],
              claims: [
                {
                  id: 'C1',
                  title: '冻结与金额校验保护',
                  statement: 'submitOrder 在冻结或金额 <= 0 时阻断提交。',
                  claimType: 'fact',
                  expectChanged: true,
                  anchors: [
                    {
                      path: 'src/orders/checkout.ts',
                      startLine: 6,
                      endLine: 14,
                      symbol: 'submitOrder',
                    },
                  ],
                },
              ],
              impacts: [
                {
                  id: 'I1',
                  relation: 'runtime',
                  description: 'ledger.recordCharge 调用 submitOrder 时将受到新校验约束。',
                  sourceAnchor: {
                    path: 'src/orders/checkout.ts',
                    startLine: 6,
                    endLine: 13,
                    symbol: 'submitOrder',
                  },
                  targetAnchor: {
                    path: 'src/billing/ledger.ts',
                    startLine: 3,
                    endLine: 5,
                    symbol: 'recordCharge',
                  },
                },
              ],
              blindSpots: ['未实际运行线上支付网关集成测试'],
              verificationSignals: [
                {
                  kind: 'unit-test',
                  status: 'not-run',
                  description: '静态核验阶段未执行测试套件',
                },
              ],
            },
            null,
            2
          ),
          '```',
        ].join('\n');
      },
    });

    // 1. Prompt must contain 1-based line-numbered source lines and git diff
    assert.ok(capturedPrompt.includes('1: export interface OrderInput {'));
    assert.ok(capturedPrompt.includes('6: export function submitOrder(input: OrderInput): string {'));
    assert.ok(capturedPrompt.includes('7:   if (input.frozen) {'));
    assert.ok(capturedPrompt.includes('git diff src/orders/checkout.ts'));

    // 2. Verification must pass on first attempt without retry
    assert.equal(record.verification.overallBadge, 'verified');
    assert.equal(record.verification.summaryCounts.verified, 1);
    assert.equal(record.verification.blockingConditions[0].badge, 'verified');
    assert.equal(stages.includes('retrying'), false);

    // 3. Record must be persisted inside <git-dir>/codeatlas/briefings/ with zero git status pollution
    const gitCtx = await getGitContext(dir);
    const stateDir = await getGitStateDir(gitCtx.repoRoot);
    assert.ok(
      path
        .normalize(record.filePath)
        .toLowerCase()
        .startsWith(path.normalize(path.join(stateDir, 'briefings')).toLowerCase())
    );
    const persistedStat = await fs.stat(record.filePath);
    assert.ok(persistedStat.isFile());

    const latest = await loadLatestBriefingRecord(dir);
    assert.ok(latest);
    assert.equal(latest.id, record.id);
    assert.equal(latest.verification.overallBadge, 'verified');

    assert.equal(gitCtx.dirtyCount, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runClickToAnalyze self-corrects on mismatch: sends exact mismatch notes + line-numbered files on 1x retry and achieves verified', async () => {
  const { dir, baseSha } = await createRunnerTempRepo();
  try {
    const promptsReceived: string[] = [];
    const stages: string[] = [];

    const record = await runClickToAnalyze({
      repoRoot: dir,
      scope: 'node',
      baseRef: baseSha,
      nodeTitle: 'src/orders',
      nodeKind: 'domain',
      nodePath: 'src/orders',
      lang: 'en',
      config: { provider: 'cli-claude' },
      onProgress: (stage) => stages.push(stage),
      executorOverride: async (prompt) => {
        promptsReceived.push(prompt);

        if (promptsReceived.length === 1) {
          // Intentionally hallucinate out-of-bounds line numbers and nonexistent symbols
          return JSON.stringify({
            schemaVersion: '0.2',
            title: 'Orders Module Briefing',
            targetRef: 'WORKTREE',
            summary: 'First attempt with hallucinated anchors.',
            blockingConditions: [
              {
                id: 'B1',
                condition: 'frozen guard',
                outcome: 'blocks order',
                anchor: {
                  path: 'src/orders/checkout.ts',
                  startLine: 2,
                  endLine: 4,
                  symbol: 'nonExistentGuardSymbol',
                },
              },
            ],
            claims: [
              {
                id: 'C1',
                title: 'Order submission',
                statement: 'Validates and submits orders.',
                claimType: 'fact',
                anchors: [
                  {
                    path: 'src/orders/checkout.ts',
                    startLine: 50,
                    endLine: 95,
                    symbol: 'hallucinatedSubmitFn',
                  },
                ],
              },
            ],
          });
        }

        // Second attempt fixes the anchors using exact 1-based line numbers
        return JSON.stringify({
          schemaVersion: '0.2',
          title: 'Orders Module Briefing',
          targetRef: 'WORKTREE',
          summary: 'Corrected anchors after deterministic mismatch feedback.',
          blockingConditions: [
            {
              id: 'B1',
              condition: 'input.frozen is truthy',
              outcome: 'Returns blocked:account-frozen early',
              anchor: {
                path: 'src/orders/checkout.ts',
                startLine: 7,
                endLine: 9,
                symbol: 'if (input.frozen)',
              },
            },
          ],
          claims: [
            {
              id: 'C1',
              title: 'Order submission validation',
              statement: 'submitOrder guards frozen accounts and non-positive amounts.',
              claimType: 'fact',
              anchors: [
                {
                  path: 'src/orders/checkout.ts',
                  startLine: 6,
                  endLine: 14,
                  symbol: 'submitOrder',
                },
              ],
            },
          ],
        });
      },
    });

    assert.equal(promptsReceived.length, 2);
    assert.ok(stages.includes('retrying'));

    // Verify retry prompt contains exact mismatch feedback from both claims and blockingConditions + line-numbered code
    const retryPrompt = promptsReceived[1];
    assert.ok(retryPrompt.includes('L50-L95 is out of bounds'));
    assert.ok(retryPrompt.includes('hallucinatedSubmitFn'));
    assert.ok(retryPrompt.includes('nonExistentGuardSymbol'));
    assert.ok(retryPrompt.includes('6: export function submitOrder(input: OrderInput): string {'));

    // Final saved record must be verified!
    assert.equal(record.verification.overallBadge, 'verified');
    assert.equal(record.verification.summaryCounts.verified, 1);
    assert.equal(record.verification.summaryCounts.mismatch, 0);
    assert.equal(record.verification.blockingConditions[0].badge, 'verified');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('packAnalysisContext caps directory node scope to top 8 code files and openai-compatible provider validates apiKey & HTTP contract', async () => {
  const { dir, baseSha } = await createRunnerTempRepo();
  try {
    // Add 10 files under src/extra to verify top-8 directory cap
    await fs.mkdir(path.join(dir, 'src', 'extra'), { recursive: true });
    for (let i = 1; i <= 10; i++) {
      await fs.writeFile(
        path.join(dir, 'src', 'extra', `mod${i}.ts`),
        `export const val${i} = ${i};\n`,
        'utf-8'
      );
    }
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '-m', 'add 10 extra files']);

    const packed = await packAnalysisContext({
      repoRoot: dir,
      scope: 'node',
      baseRef: baseSha,
      nodePath: 'src/extra',
      config: { provider: 'cli-codex' },
    });
    assert.equal(packed.packedFiles.length, 8);
    assert.equal(packed.truncatedPaths.length, 2);
    assert.ok(packed.filesSection.includes('1: export const val'));

    // Missing apiKey on openai-compatible must fail fast with a clear error
    await assert.rejects(
      () =>
        runClickToAnalyze({
          repoRoot: dir,
          scope: 'node',
          baseRef: baseSha,
          nodePath: 'src/orders/checkout.ts',
          config: { provider: 'openai-compatible', apiKey: '   ' },
        }),
      /apiKey/i
    );

    // Local loopback HTTP server verifies openai-compatible fetch execution end-to-end
    let authHeaderSeen = '';
    let requestModelSeen = '';
    const server = http.createServer((req, res) => {
      authHeaderSeen = String(req.headers.authorization ?? '');
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        const parsed = JSON.parse(body) as { model: string };
        requestModelSeen = parsed.model;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    schemaVersion: '0.2',
                    title: 'OpenAI Loopback Check',
                    targetRef: 'WORKTREE',
                    summary: 'Verified via local HTTP server.',
                    claims: [
                      {
                        id: 'C1',
                        title: 'Checkout function',
                        statement: 'submitOrder exists.',
                        claimType: 'fact',
                        anchors: [
                          {
                            path: 'src/orders/checkout.ts',
                            startLine: 6,
                            endLine: 14,
                            symbol: 'submitOrder',
                          },
                        ],
                      },
                    ],
                  }),
                },
              },
            ],
          })
        );
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === 'object');
      const rec = await runClickToAnalyze({
        repoRoot: dir,
        scope: 'node',
        baseRef: baseSha,
        nodePath: 'src/orders/checkout.ts',
        config: {
          provider: 'openai-compatible',
          apiBaseUrl: `http://127.0.0.1:${addr.port}/v1`,
          apiKey: 'sk-test-local',
          model: 'gpt-4.1-mini',
        },
      });
      assert.equal(authHeaderSeen, 'Bearer sk-test-local');
      assert.equal(requestModelSeen, 'gpt-4.1-mini');
      assert.equal(rec.verification.overallBadge, 'verified');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
