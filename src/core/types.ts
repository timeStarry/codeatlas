export type CompareMode = 'direct-diff' | 'merge-base' | 'worktree';
export type ClaimType = 'fact' | 'inference' | 'unknown';
export type VerificationBadge = 'verified' | 'mismatch' | 'stale' | 'unverified' | 'unknown';
export type DirectiveStatus = 'open' | 'claimed' | 'resolved' | 'dismissed';

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

export interface DeclaredImpact {
  id: string;
  relation: 'ipc' | 'event' | 'schema' | 'runtime' | 'other';
  description: string;
  sourceAnchor: EvidenceAnchor;
  targetAnchor: EvidenceAnchor;
}

export interface VerificationSignal {
  kind: 'unit-test' | 'integration-test' | 'typecheck' | 'lint' | 'manual' | 'other';
  status: 'passed' | 'failed' | 'not-run' | 'unknown';
  command?: string;
  description: string;
  evidencePath?: string;
}

export interface BriefingReport {
  schemaVersion: '0.1' | '0.2';
  title: string;
  author?: string;
  baseRef?: string;
  targetRef: string;
  compareMode?: CompareMode;
  summary: string;
  blockingConditions?: BlockingCondition[];
  claims: BriefingClaim[];
  impacts?: DeclaredImpact[];
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

export interface FileDiffHunks {
  path: string;
  addedRanges: Array<{ start: number; end: number }>;
  deletedOnlyHunks: Array<{ oldStart: number; oldCount: number; newAnchorLine: number }>;
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

export interface DeclaredImpactVerification {
  item: DeclaredImpact;
  badge: VerificationBadge;
  sourceResult?: AnchorVerification;
  targetResult?: AnchorVerification;
  notes: string[];
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
  impacts: DeclaredImpactVerification[];
  signals: VerificationSignal[];
  blindSpots: string[];
  verifiedAt: string;
}

export interface LspCallerDomainSummary {
  domainName: string;
  fileCount: number;
  callSites: number;
  sampleFiles: string[];
}

export interface LspReferenceImpact {
  sourcePath: string;
  sourceSymbol: string;
  sourceLine: number;
  truncated: boolean;
  totalCallerFiles: number;
  totalCallSites: number;
  callers: Array<{ path: string; line: number }>;
  byDomain: LspCallerDomainSummary[];
}

export interface LspDiagnosticImpact {
  path: string;
  line: number;
  message: string;
  source?: string;
}

export interface IndirectImpactReport {
  status: 'ok' | 'skipped-snapshot-mismatch' | 'skipped-no-diff' | 'error';
  reason?: string;
  lspReferences: LspReferenceImpact[];
  lspDiagnostics: LspDiagnosticImpact[];
  unresolvedDeletions: Array<{ path: string; oldStart: number; oldCount: number }>;
  budgetExhausted: boolean;
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

export type ManifestLoadResult =
  | { status: 'ok'; manifest: AtlasManifest }
  | { status: 'missing' }
  | { status: 'invalid'; errors: string[] };

export interface ManifestDriftIssue {
  severity: 'error' | 'warning';
  domainId: string;
  field: 'path' | 'entrypoint';
  target: string;
  message: string;
}

export interface ManifestVerificationResult {
  valid: boolean;
  issues: ManifestDriftIssue[];
}

export interface DirectiveClaim {
  agentId: string;
  claimedAt: string;
  leaseExpiresAt: string;
}

export interface DirectiveResolution {
  agentId: string;
  resolvedAt: string;
  resolvedAtRef: string;
  summary: string;
  evidenceAnchor?: EvidenceAnchor;
}

export interface AnnotationDirective {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  ref: string;
  path: string;
  startLine?: number;
  endLine?: number;
  targetNodeId?: string;
  kind: 'constraint' | 'question' | 'rework';
  note: string;
  status: DirectiveStatus;
  claim?: DirectiveClaim;
  resolution?: DirectiveResolution;
  /** Derived dynamically at read time; never persisted */
  isStale?: boolean;
}
