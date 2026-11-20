export type CompareMode = 'direct-diff' | 'merge-base' | 'worktree';
export type ClaimType = 'fact' | 'inference' | 'unknown';
export type VerificationBadge = 'verified' | 'mismatch' | 'stale' | 'unverified' | 'unknown';

export interface EvidenceAnchor {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  excerpt?: string;
}

export interface BlockingCondition {
  id: string;
  condition: string;
  outcome: string;
  anchor?: EvidenceAnchor;
}

export interface BriefingClaim {
  id: string;
  title: string;
  statement: string;
  claimType: ClaimType;
  expectChanged?: boolean;
  anchors: EvidenceAnchor[];
}

export interface VerificationSignal {
  kind: 'unit-test' | 'integration-test' | 'typecheck' | 'lint' | 'manual' | 'other';
  status: 'passed' | 'failed' | 'not-run' | 'unknown';
  command?: string;
  description: string;
  evidencePath?: string;
}

export interface BriefingReport {
  schemaVersion: '0.1';
  title: string;
  author?: string;
  baseRef?: string;
  targetRef: string;
  compareMode?: CompareMode;
  summary: string;
  blockingConditions?: BlockingCondition[];
  claims: BriefingClaim[];
  verificationSignals?: VerificationSignal[];
  blindSpots?: string[];
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  isCurrent: boolean;
}

export interface DiffFileStat {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitContext {
  repoRoot: string;
  headSha: string;
  shortSha: string;
  branch: string;
  dirtyCount: number;
  worktrees: WorktreeInfo[];
  recentRefs: string[];
}

export interface AnchorVerification {
  anchor: EvidenceAnchor;
  badge: VerificationBadge;
  fileExists: boolean;
  lineRangeValid: boolean;
  symbolMatched?: boolean;
  changedInDiff?: boolean;
  actualLineCount?: number;
  notes: string[];
}

export interface ClaimVerification {
  claim: BriefingClaim;
  badge: VerificationBadge;
  anchors: AnchorVerification[];
  notes: string[];
}

export interface BlockingConditionVerification {
  item: BlockingCondition;
  badge: VerificationBadge;
  anchorResult?: AnchorVerification;
}

export interface BriefingVerificationResult {
  briefingTitle: string;
  sourcePath?: string;
  targetRefClaimed: string;
  resolvedTargetSha?: string;
  currentHeadSha: string;
  isStale: boolean;
  overallBadge: VerificationBadge;
  summaryCounts: {
    verified: number;
    mismatch: number;
    stale: number;
    unverified: number;
    unknown: number;
  };
  claims: ClaimVerification[];
  blockingConditions: BlockingConditionVerification[];
  signals: VerificationSignal[];
  blindSpots: string[];
  verifiedAt: string;
}

export interface AtlasDomain {
  id: string;
  name: string;
  description: string;
  paths: string[];
  entrypoints?: EvidenceAnchor[];
}

export interface AtlasManifest {
  schemaVersion: '0.1';
  domains: AtlasDomain[];
  guardrails?: string[];
}

export interface AnnotationDirective {
  id: string;
  createdAt: string;
  ref: string;
  path: string;
  startLine?: number;
  endLine?: number;
  kind: 'constraint' | 'question' | 'rework';
  note: string;
}
