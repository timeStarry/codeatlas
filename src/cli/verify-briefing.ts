import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BriefingReport } from '../core/types.js';
import { getRepoRoot } from '../core/git.js';
import { verifyBriefing } from '../core/verifier.js';

async function main() {
  const [, , briefingArg, repoArg] = process.argv;
  if (!briefingArg) {
    console.error('Usage: verify-briefing <briefing.json> [repoPath]');
    process.exit(1);
  }

  const briefingPath = path.resolve(briefingArg);
  const raw = await fs.readFile(briefingPath, 'utf-8');
  const briefing = JSON.parse(raw) as BriefingReport;

  const repoRoot = await getRepoRoot(repoArg ? path.resolve(repoArg) : process.cwd());
  const result = await verifyBriefing(repoRoot, briefing, briefingPath);

  console.log(`\n=== CodeAtlas Deterministic Verification ===`);
  console.log(`Briefing : ${result.briefingTitle}`);
  console.log(`Repo     : ${repoRoot}`);
  console.log(`Target   : ${result.targetRefClaimed} (HEAD: ${result.currentHeadSha.slice(0, 8) || 'UNBORN'})`);
  console.log(`Overall  : ${result.overallBadge.toUpperCase()}${result.isStale ? ' [STALE]' : ''}`);
  console.log(
    `Counts   : verified=${result.summaryCounts.verified}, mismatch=${result.summaryCounts.mismatch}, stale=${result.summaryCounts.stale}, unverified=${result.summaryCounts.unverified}, unknown=${result.summaryCounts.unknown}\n`
  );

  for (const c of result.claims) {
    console.log(`[${c.badge.toUpperCase()}] ${c.claim.id} — ${c.claim.title} (${c.claim.claimType})`);
    for (const n of c.notes) {
      console.log(`   note: ${n}`);
    }
    for (const a of c.anchors) {
      const loc = a.anchor.startLine ? `${a.anchor.path}:${a.anchor.startLine}` : a.anchor.path;
      console.log(`   - [${a.badge}] ${loc}${a.anchor.symbol ? ` (${a.anchor.symbol})` : ''}`);
      for (const n of a.notes) {
        console.log(`       ! ${n}`);
      }
    }
  }

  if (result.blockingConditions.length > 0) {
    console.log('\nBlocking Conditions:');
    for (const b of result.blockingConditions) {
      console.log(`  [${b.badge.toUpperCase()}] ${b.item.id}: ${b.item.condition} => ${b.item.outcome}`);
    }
  }

  if (result.overallBadge === 'mismatch') {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('Verification failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
