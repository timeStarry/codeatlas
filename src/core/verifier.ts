import {
  AnchorVerification,
  BlockingConditionVerification,
  BriefingClaim,
  BriefingReport,
  BriefingVerificationResult,
  ClaimVerification,
  DeclaredImpactVerification,
  EvidenceAnchor,
  VerificationBadge,
} from './types.js';
import { getDiffStats, getGitContext, readFileAtRef, resolveRef } from './git.js';

function normalizePosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

export async function verifyAnchor(
  repoRoot: string,
  anchor: EvidenceAnchor,
  targetRef: string,
  isStale: boolean,
  changedFiles: Set<string>,
  hasBaseRef: boolean,
  expectChanged: boolean
): Promise<AnchorVerification> {
  const notes: string[] = [];
  const posixPath = normalizePosix(anchor.path);
  const content = await readFileAtRef(repoRoot, posixPath, targetRef);

  if (content === undefined) {
    notes.push(`File not found at ref "${targetRef}": ${posixPath}`);
    return {
      anchor,
      badge: 'mismatch',
      fileExists: false,
      lineRangeValid: false,
      notes,
    };
  }

  const lines = content.split(/\r?\n/);
  const actualLineCount = lines.length;
  let lineRangeValid = true;
  let searchStart = 0;
  let searchEnd = actualLineCount - 1;

  if (anchor.startLine !== undefined) {
    const endLine = anchor.endLine ?? anchor.startLine;
    if (anchor.startLine < 1 || endLine < anchor.startLine || endLine > actualLineCount) {
      lineRangeValid = false;
      notes.push(
        `Claimed line range L${anchor.startLine}-L${endLine} is out of bounds (file has ${actualLineCount} lines).`
      );
    } else {
      // Allow +-5 lines tolerance for minor shifts when checking symbol/excerpt
      searchStart = Math.max(0, anchor.startLine - 1 - 5);
      searchEnd = Math.min(actualLineCount - 1, endLine - 1 + 5);
    }
  }

  let symbolMatched: boolean | undefined;
  const windowText = lines.slice(searchStart, searchEnd + 1).join('\n');

  if (anchor.symbol) {
    if (windowText.includes(anchor.symbol)) {
      symbolMatched = true;
    } else if (content.includes(anchor.symbol)) {
      symbolMatched = false;
      notes.push(
        `Symbol "${anchor.symbol}" exists in file, but not near claimed lines L${anchor.startLine ?? 1}.`
      );
    } else {
      symbolMatched = false;
      notes.push(`Symbol "${anchor.symbol}" not found in ${posixPath}.`);
    }
  }

  if (anchor.excerpt) {
    const trimmedExcerpt = anchor.excerpt.trim();
    if (trimmedExcerpt && !windowText.includes(trimmedExcerpt)) {
      symbolMatched = false;
      notes.push(`Claimed excerpt not found near L${anchor.startLine ?? 1}.`);
    }
  }

  let changedInDiff: boolean | undefined;
  if (expectChanged) {
    if (hasBaseRef) {
      changedInDiff = changedFiles.has(posixPath);
      if (!changedInDiff) {
        notes.push(`Claimed as changed, but "${posixPath}" is not in git diff.`);
      }
    } else {
      notes.push('Cannot deterministically verify expectChanged (no baseRef specified).');
    }
  }

  let badge: VerificationBadge = 'verified';
  if (!lineRangeValid || symbolMatched === false || changedInDiff === false) {
    badge = 'mismatch';
  } else if (isStale) {
    badge = 'stale';
    notes.push('Target ref differs from current HEAD; evidence may be stale.');
  }

  return {
    anchor,
    badge,
    fileExists: true,
    lineRangeValid,
    symbolMatched,
    changedInDiff,
    actualLineCount,
    notes,
  };
}

function deriveClaimBadge(claim: BriefingClaim, anchors: AnchorVerification[], isStale: boolean): VerificationBadge {
  if (claim.claimType === 'unknown') {
    return 'unknown';
  }
  if (anchors.length === 0) {
    return 'unverified';
  }
  if (anchors.some((a) => a.badge === 'mismatch')) {
    return 'mismatch';
  }
  if (claim.claimType === 'inference') {
    return isStale ? 'stale' : 'unverified';
  }
  if (anchors.some((a) => a.badge === 'stale') || isStale) {
    return 'stale';
  }
  return 'verified';
}

export async function verifyBriefing(
  repoRoot: string,
  briefing: BriefingReport,
  sourcePath?: string
): Promise<BriefingVerificationResult> {
  if (briefing.schemaVersion !== '0.1' && briefing.schemaVersion !== '0.2') {
    throw new Error(
      `Unsupported briefing schemaVersion "${String(briefing.schemaVersion)}". Expected "0.1" or "0.2".`
    );
  }

  const gitCtx = await getGitContext(repoRoot);
  const resolvedTargetSha =
    briefing.targetRef === 'WORKTREE'
      ? gitCtx.headSha || undefined
      : await resolveRef(repoRoot, briefing.targetRef);

  const isStale =
    briefing.targetRef !== 'WORKTREE' &&
    Boolean(gitCtx.headSha) &&
    Boolean(resolvedTargetSha) &&
    resolvedTargetSha !== gitCtx.headSha;

  const targetMissing =
    briefing.targetRef !== 'WORKTREE' && !resolvedTargetSha;

  const diffStats = briefing.baseRef
    ? await getDiffStats(
        repoRoot,
        briefing.baseRef,
        briefing.targetRef === 'WORKTREE' ? undefined : briefing.targetRef,
        briefing.compareMode ?? 'direct-diff'
      )
    : [];
  const changedFiles = new Set(diffStats.map((d) => normalizePosix(d.path)));

  const claimResults: ClaimVerification[] = [];
  for (const claim of briefing.claims) {
    if (targetMissing) {
      claimResults.push({
        claim,
        badge: 'mismatch',
        anchors: [],
        notes: [`Target ref "${briefing.targetRef}" could not be resolved in git.`],
      });
      continue;
    }

    const anchorResults: AnchorVerification[] = [];
    for (const anchor of claim.anchors) {
      anchorResults.push(
        await verifyAnchor(
          repoRoot,
          anchor,
          briefing.targetRef,
          isStale,
          changedFiles,
          Boolean(briefing.baseRef),
          Boolean(claim.expectChanged)
        )
      );
    }

    const notes: string[] = [];
    if (claim.claimType === 'inference') {
      notes.push('Marked as inference: anchors checked, semantic conclusion requires human verification.');
    }
    if (claim.anchors.length === 0) {
      notes.push('No code evidence anchors attached to this claim.');
    }

    claimResults.push({
      claim,
      badge: deriveClaimBadge(claim, anchorResults, isStale),
      anchors: anchorResults,
      notes,
    });
  }

  const blockingResults: BlockingConditionVerification[] = [];
  for (const item of briefing.blockingConditions ?? []) {
    if (!item.anchor || targetMissing) {
      blockingResults.push({
        item,
        badge: targetMissing ? 'mismatch' : 'unverified',
      });
      continue;
    }
    const anchorResult = await verifyAnchor(
      repoRoot,
      item.anchor,
      briefing.targetRef,
      isStale,
      changedFiles,
      Boolean(briefing.baseRef),
      false
    );
    blockingResults.push({
      item,
      badge: anchorResult.badge,
      anchorResult,
    });
  }

  const impactResults: DeclaredImpactVerification[] = [];
  for (const imp of briefing.impacts ?? []) {
    if (targetMissing) {
      impactResults.push({
        item: imp,
        badge: 'mismatch',
        notes: [`Target ref "${briefing.targetRef}" could not be resolved in git.`],
      });
      continue;
    }
    const sourceResult = await verifyAnchor(
      repoRoot,
      imp.sourceAnchor,
      briefing.targetRef,
      isStale,
      changedFiles,
      Boolean(briefing.baseRef),
      Boolean(briefing.baseRef)
    );
    const targetResult = await verifyAnchor(
      repoRoot,
      imp.targetAnchor,
      briefing.targetRef,
      isStale,
      changedFiles,
      Boolean(briefing.baseRef),
      false
    );
    const notes: string[] = [
      'Agent-declared cross-boundary impact: anchors checked, runtime coupling requires verification.',
      ...sourceResult.notes,
      ...targetResult.notes,
    ];
    let badge: VerificationBadge = 'unverified';
    if (sourceResult.badge === 'mismatch' || targetResult.badge === 'mismatch') {
      badge = 'mismatch';
    } else if (isStale || sourceResult.badge === 'stale' || targetResult.badge === 'stale') {
      badge = 'stale';
    }
    impactResults.push({
      item: imp,
      badge,
      sourceResult,
      targetResult,
      notes,
    });
  }

  const summaryCounts = {
    verified: 0,
    mismatch: 0,
    stale: 0,
    unverified: 0,
    unknown: 0,
  };
  for (const c of claimResults) {
    summaryCounts[c.badge] += 1;
  }

  const blockingMismatch = blockingResults.some((b) => b.badge === 'mismatch');
  const blockingStale = blockingResults.some((b) => b.badge === 'stale');
  const impactMismatch = impactResults.some((i) => i.badge === 'mismatch');

  let overallBadge: VerificationBadge = 'verified';
  if (targetMissing || summaryCounts.mismatch > 0 || blockingMismatch || impactMismatch) {
    overallBadge = 'mismatch';
  } else if (isStale || summaryCounts.stale > 0 || blockingStale) {
    overallBadge = 'stale';
  } else if (summaryCounts.unverified > 0) {
    overallBadge = 'unverified';
  } else if (claimResults.length === 0 || summaryCounts.unknown === claimResults.length) {
    overallBadge = 'unknown';
  }

  return {
    briefingTitle: briefing.title,
    sourcePath,
    targetRefClaimed: briefing.targetRef,
    resolvedTargetSha,
    currentHeadSha: gitCtx.headSha,
    isStale,
    overallBadge,
    summaryCounts,
    claims: claimResults,
    blockingConditions: blockingResults,
    impacts: impactResults,
    signals: briefing.verificationSignals ?? [],
    blindSpots: briefing.blindSpots ?? [],
    verifiedAt: new Date().toISOString(),
  };
}
