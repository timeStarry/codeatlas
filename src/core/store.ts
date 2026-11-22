import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  AnnotationDirective,
  BriefingReport,
  BriefingVerificationResult,
  EvidenceAnchor,
  ModuleOutlineReport,
  OutlineChildVerification,
  OutlineVerificationResult,
  RepoAtlasConfig,
  StorageMode,
} from './types.js';
import { getGitContext, getGitStateDir, listTrackedFiles, resolveRef } from './git.js';
import { verifyAnchor } from './verifier.js';

const RETRY_DELAYS_MS = [10, 20, 40, 80, 160];
const WIN32_LOCK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const STALE_LOCK_MS = 10_000;
const DEFAULT_LEASE_MINUTES = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function writeAtomicWin32(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await fs.rename(tmpPath, filePath);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code ?? '';
      if (WIN32_LOCK_CODES.has(code) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }
}

export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 1_000;
  let acquired = false;

  while (!acquired) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
          'utf-8'
        );
      } finally {
        await handle.close();
      }
      acquired = true;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;

      // Check stale lock recovery
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          await fs.unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring lock: ${lockPath}`);
      }
      await sleep(25);
    }
  }

  try {
    return await fn();
  } finally {
    await fs.unlink(lockPath).catch(() => {});
  }
}

async function getDirectivesDir(repoRoot: string): Promise<string> {
  const stateDir = await getGitStateDir(repoRoot);
  return path.join(stateDir, 'directives');
}

async function getBriefingsDir(repoRoot: string): Promise<string> {
  const stateDir = await getGitStateDir(repoRoot);
  return path.join(stateDir, 'briefings');
}

export interface StoredBriefingRecord {
  id: string;
  storedAt: string;
  filePath: string;
  briefing: BriefingReport;
  verification: BriefingVerificationResult;
}

export async function saveBriefingRecord(
  repoRoot: string,
  briefing: BriefingReport,
  verification: BriefingVerificationResult
): Promise<StoredBriefingRecord> {
  const dir = await getBriefingsDir(repoRoot);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(briefing))
    .digest('hex')
    .slice(0, 8);
  const id = `${ts}-${hash}`;
  const filePath = path.join(dir, `${id}.json`);
  const record: StoredBriefingRecord = {
    id,
    storedAt: new Date().toISOString(),
    filePath,
    briefing,
    verification,
  };

  await writeAtomicWin32(filePath, JSON.stringify(record, null, 2) + '\n');
  const pointerPath = path.join(dir, 'latest.pointer.json');
  await writeAtomicWin32(
    pointerPath,
    JSON.stringify({ id, filePath, storedAt: record.storedAt, title: briefing.title }, null, 2) + '\n'
  );
  return record;
}

export async function loadLatestBriefingRecord(
  repoRoot: string
): Promise<StoredBriefingRecord | undefined> {
  const dir = await getBriefingsDir(repoRoot);
  const pointerPath = path.join(dir, 'latest.pointer.json');
  try {
    const ptrRaw = await fs.readFile(pointerPath, 'utf-8');
    const ptr = JSON.parse(ptrRaw) as { filePath?: string };
    if (!ptr.filePath) return undefined;
    const raw = await fs.readFile(ptr.filePath, 'utf-8');
    return JSON.parse(raw) as StoredBriefingRecord;
  } catch {
    return undefined;
  }
}

export async function listStoredBriefings(
  repoRoot: string
): Promise<Array<{ label: string; path: string }>> {
  const dir = await getBriefingsDir(repoRoot);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'latest.pointer.json')
      .map((e) => e.name)
      .sort()
      .reverse();
    return files.slice(0, 15).map((name) => ({
      label: `[MCP] ${name}`,
      path: path.join(dir, name),
    }));
  } catch {
    return [];
  }
}

function enrichDynamicStaleness(
  dir: AnnotationDirective,
  currentHeadSha: string
): AnnotationDirective {
  const isStale = Boolean(
    currentHeadSha &&
      dir.ref &&
      dir.ref !== 'WORKTREE' &&
      !currentHeadSha.startsWith(dir.ref) &&
      dir.ref !== currentHeadSha
  );
  return { ...dir, isStale };
}

export async function listDirectives(
  repoRoot: string,
  includeClosed = true
): Promise<AnnotationDirective[]> {
  const dir = await getDirectivesDir(repoRoot);
  let headSha = '';
  try {
    headSha = (await getGitContext(repoRoot)).headSha;
  } catch {
    headSha = '';
  }

  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const results: AnnotationDirective[] = [];
  for (const name of entries) {
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf-8');
      const parsed = JSON.parse(raw) as AnnotationDirective;
      if (!parsed || !parsed.id) continue;
      const normalized: AnnotationDirective = {
        ...parsed,
        revision: typeof parsed.revision === 'number' ? parsed.revision : 1,
        updatedAt: parsed.updatedAt || parsed.createdAt,
        status: parsed.status || 'open',
      };
      if (!includeClosed && (normalized.status === 'resolved' || normalized.status === 'dismissed')) {
        continue;
      }
      results.push(enrichDynamicStaleness(normalized, headSha));
    } catch {
      // skip unreadable file
    }
  }

  results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return results;
}

export async function createDirective(
  repoRoot: string,
  input: {
    id?: string;
    ref: string;
    path: string;
    startLine?: number;
    endLine?: number;
    targetNodeId?: string;
    kind: 'constraint' | 'question' | 'rework';
    note: string;
    createdAt?: string;
  }
): Promise<AnnotationDirective> {
  const dir = await getDirectivesDir(repoRoot);
  const id = input.id || crypto.randomBytes(6).toString('hex');
  const now = input.createdAt || new Date().toISOString();
  const record: AnnotationDirective = {
    id,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ref: input.ref,
    path: input.path,
    startLine: input.startLine,
    endLine: input.endLine,
    targetNodeId: input.targetNodeId,
    kind: input.kind,
    note: input.note,
    status: 'open',
  };
  const filePath = path.join(dir, `${id}.json`);
  const lockPath = path.join(dir, `${id}.lock`);
  await withFileLock(lockPath, async () => {
    await writeAtomicWin32(filePath, JSON.stringify(record, null, 2) + '\n');
  });
  return record;
}

export async function deleteDirective(repoRoot: string, id: string): Promise<void> {
  const dir = await getDirectivesDir(repoRoot);
  const filePath = path.join(dir, `${id}.json`);
  const lockPath = path.join(dir, `${id}.lock`);
  await withFileLock(lockPath, async () => {
    await fs.unlink(filePath).catch(() => {});
  });
}

export async function clearAllDirectives(repoRoot: string): Promise<void> {
  const dir = await getDirectivesDir(repoRoot);
  try {
    const entries = await fs.readdir(dir);
    for (const f of entries) {
      if (f.endsWith('.json')) {
        await fs.unlink(path.join(dir, f)).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}

export async function claimDirective(
  repoRoot: string,
  id: string,
  agentId: string,
  leaseMinutes = DEFAULT_LEASE_MINUTES
): Promise<AnnotationDirective | undefined> {
  const dir = await getDirectivesDir(repoRoot);
  const filePath = path.join(dir, `${id}.json`);
  const lockPath = path.join(dir, `${id}.lock`);

  return withFileLock(lockPath, async () => {
    let current: AnnotationDirective;
    try {
      current = JSON.parse(await fs.readFile(filePath, 'utf-8')) as AnnotationDirective;
    } catch {
      return undefined;
    }

    const nowMs = Date.now();
    if (current.status === 'resolved' || current.status === 'dismissed') {
      return undefined;
    }
    if (current.status === 'claimed' && current.claim) {
      const expiresMs = Date.parse(current.claim.leaseExpiresAt);
      if (Number.isFinite(expiresMs) && expiresMs > nowMs && current.claim.agentId !== agentId) {
        return undefined; // actively leased by another agent
      }
    }

    const nowIso = new Date(nowMs).toISOString();
    const expiresIso = new Date(nowMs + leaseMinutes * 60_000).toISOString();
    const updated: AnnotationDirective = {
      ...current,
      revision: (current.revision || 1) + 1,
      updatedAt: nowIso,
      status: 'claimed',
      claim: {
        agentId,
        claimedAt: nowIso,
        leaseExpiresAt: expiresIso,
      },
    };
    await writeAtomicWin32(filePath, JSON.stringify(updated, null, 2) + '\n');
    return updated;
  });
}

export async function ackDirective(
  repoRoot: string,
  params: {
    id: string;
    expectedRevision: number;
    agentId: string;
    summary: string;
    evidenceAnchor?: EvidenceAnchor;
  }
): Promise<{ ok: true; directive: AnnotationDirective } | { ok: false; error: string }> {
  const dir = await getDirectivesDir(repoRoot);
  const filePath = path.join(dir, `${params.id}.json`);
  const lockPath = path.join(dir, `${params.id}.lock`);

  return withFileLock(lockPath, async () => {
    let current: AnnotationDirective;
    try {
      current = JSON.parse(await fs.readFile(filePath, 'utf-8')) as AnnotationDirective;
    } catch {
      return { ok: false, error: `Directive "${params.id}" not found.` };
    }

    if (current.status === 'resolved' || current.status === 'dismissed') {
      return { ok: false, error: `Directive "${params.id}" is already ${current.status}.` };
    }

    const currentRev = current.revision || 1;
    if (currentRev !== params.expectedRevision) {
      return {
        ok: false,
        error: `Revision conflict: expected ${params.expectedRevision}, actual ${currentRev}. Re-fetch directives before acknowledging.`,
      };
    }

    const gitCtx = await getGitContext(repoRoot);

    // Prevent rubber-stamping rework directives without any code change
    if (current.kind === 'rework') {
      const sameHead =
        Boolean(gitCtx.headSha) &&
        (gitCtx.headSha === current.ref || gitCtx.headSha.startsWith(current.ref));
      if (sameHead && gitCtx.dirtyCount === 0) {
        return {
          ok: false,
          error: `Rejected rework ack: repository HEAD (${gitCtx.shortSha}) matches directive ref (${current.ref}) and working tree has 0 changes.`,
        };
      }
    }

    if (params.evidenceAnchor) {
      const anchorRes = await verifyAnchor(
        repoRoot,
        params.evidenceAnchor,
        'WORKTREE',
        false,
        new Set(),
        false,
        false
      );
      if (anchorRes.badge === 'mismatch') {
        return {
          ok: false,
          error: `Evidence anchor failed deterministic verification: ${anchorRes.notes.join(' ')}`,
        };
      }
    }

    const nowIso = new Date().toISOString();
    const updated: AnnotationDirective = {
      ...current,
      revision: currentRev + 1,
      updatedAt: nowIso,
      status: 'resolved',
      resolution: {
        agentId: params.agentId,
        resolvedAt: nowIso,
        resolvedAtRef: gitCtx.headSha || 'WORKTREE',
        summary: params.summary,
        evidenceAnchor: params.evidenceAnchor,
      },
    };
    await writeAtomicWin32(filePath, JSON.stringify(updated, null, 2) + '\n');
    return { ok: true, directive: updated };
  });
}

// ---------------------------------------------------------------------------
// Repository Storage Config (100% stored inside <git-dir>/codeatlas/config.json)
// ---------------------------------------------------------------------------

export async function loadRepoConfig(repoRoot: string): Promise<RepoAtlasConfig> {
  try {
    const stateDir = await getGitStateDir(repoRoot);
    const raw = await fs.readFile(path.join(stateDir, 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RepoAtlasConfig>;
    const valid: StorageMode[] = ['git-hidden', 'worktree-excluded', 'worktree-tracked'];
    if (parsed.storageMode && valid.includes(parsed.storageMode)) {
      return { storageMode: parsed.storageMode };
    }
  } catch {
    // default
  }
  return { storageMode: 'git-hidden' };
}

export async function saveRepoConfig(
  repoRoot: string,
  config: RepoAtlasConfig
): Promise<RepoAtlasConfig> {
  const stateDir = await getGitStateDir(repoRoot);
  const cfgPath = path.join(stateDir, 'config.json');
  await writeAtomicWin32(cfgPath, JSON.stringify(config, null, 2) + '\n');
  return config;
}

// ---------------------------------------------------------------------------
// L1 Module Outlines (In-Place Directory & File Role Summaries)
// ---------------------------------------------------------------------------

export interface StoredOutlineRecord {
  id: string;
  storedAt: string;
  filePath: string;
  outline: ModuleOutlineReport;
  verification: OutlineVerificationResult;
}

function normalizeOutlineScope(raw: string): string {
  const clean = String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
  return clean === '.' || clean === '(root)' ? '' : clean;
}

function outlineSlug(scopePath: string): string {
  const norm = normalizeOutlineScope(scopePath);
  if (!norm) return '__root__';
  const safe = norm.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 72);
  const hash = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 8);
  return `${safe}-${hash}`;
}

export async function verifyOutline(
  repoRoot: string,
  outline: ModuleOutlineReport
): Promise<OutlineVerificationResult> {
  const git = await getGitContext(repoRoot);
  const tracked = await listTrackedFiles(git.repoRoot);
  const trackedSet = new Set(tracked.map((f) => f.replace(/\\/g, '/')));
  const dirPrefixes = new Set<string>();
  for (const f of trackedSet) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirPrefixes.add(parts.slice(0, i).join('/'));
    }
  }

  const scopeNorm = normalizeOutlineScope(outline.scopePath);
  const notes: string[] = [];

  if (scopeNorm && !dirPrefixes.has(scopeNorm) && !trackedSet.has(scopeNorm)) {
    // Also check working tree filesystem in case of untracked directory
    try {
      await fs.access(path.join(git.repoRoot, scopeNorm));
    } catch {
      notes.push(`Scope path "${scopeNorm}" does not exist in repository.`);
    }
  }

  const checkExists = async (rel: string): Promise<{ exists: boolean; isDirectory: boolean }> => {
    const clean = normalizeOutlineScope(rel);
    if (!clean) return { exists: true, isDirectory: true };
    if (trackedSet.has(clean)) return { exists: true, isDirectory: false };
    if (dirPrefixes.has(clean)) return { exists: true, isDirectory: true };
    try {
      const st = await fs.stat(path.join(git.repoRoot, clean));
      return { exists: true, isDirectory: st.isDirectory() };
    } catch {
      return { exists: false, isDirectory: false };
    }
  };

  const childResults: OutlineChildVerification[] = [];
  let validCount = 0;
  let mismatchCount = 0;

  for (const ch of outline.children ?? []) {
    const cleanPath = normalizeOutlineScope(ch.path);
    const status = await checkExists(cleanPath);
    childResults.push({
      item: { ...ch, path: cleanPath },
      exists: status.exists,
      isDirectory: status.isDirectory,
    });
    if (status.exists) {
      validCount += 1;
    } else {
      mismatchCount += 1;
      notes.push(`Child path "${ch.path}" does not exist in repository.`);
    }
  }

  let recommendedEntryValid = true;
  if (outline.recommendedEntry) {
    const rec = await checkExists(outline.recommendedEntry);
    recommendedEntryValid = rec.exists;
    if (!rec.exists) {
      mismatchCount += 1;
      notes.push(`recommendedEntry "${outline.recommendedEntry}" does not exist.`);
    }
  }

  let isStale = false;
  if (outline.targetRef && outline.targetRef !== 'WORKTREE' && git.headSha) {
    const resolved = await resolveRef(git.repoRoot, outline.targetRef);
    if (resolved && resolved !== git.headSha) {
      isStale = true;
    }
  }

  const overallBadge =
    notes.some((n) => n.startsWith('Scope path')) || mismatchCount > 0
      ? 'mismatch'
      : isStale
        ? 'stale'
        : 'verified';

  return {
    scopePath: scopeNorm,
    targetRefClaimed: outline.targetRef || 'WORKTREE',
    currentHeadSha: git.headSha,
    isStale,
    overallBadge,
    validCount,
    mismatchCount,
    recommendedEntryValid,
    children: childResults,
    notes,
    verifiedAt: new Date().toISOString(),
  };
}

export async function saveOutlineRecord(
  repoRoot: string,
  outline: ModuleOutlineReport,
  verification: OutlineVerificationResult
): Promise<StoredOutlineRecord> {
  const stateDir = await getGitStateDir(repoRoot);
  const outlinesDir = path.join(stateDir, 'outlines');
  const scopeNorm = normalizeOutlineScope(outline.scopePath);
  const id = outlineSlug(scopeNorm);
  const filePath = path.join(outlinesDir, `${id}.json`);
  const normalizedOutline: ModuleOutlineReport = {
    ...outline,
    scopePath: scopeNorm,
    recommendedEntry: outline.recommendedEntry
      ? normalizeOutlineScope(outline.recommendedEntry)
      : undefined,
    children: (outline.children ?? []).map((c) => ({
      ...c,
      path: normalizeOutlineScope(c.path),
    })),
  };
  const record: StoredOutlineRecord = {
    id,
    storedAt: new Date().toISOString(),
    filePath,
    outline: normalizedOutline,
    verification,
  };
  await writeAtomicWin32(filePath, JSON.stringify(record, null, 2) + '\n');
  return record;
}

export async function loadAllOutlines(repoRoot: string): Promise<StoredOutlineRecord[]> {
  try {
    const stateDir = await getGitStateDir(repoRoot);
    const outlinesDir = path.join(stateDir, 'outlines');
    const entries = await fs.readdir(outlinesDir, { withFileTypes: true });
    const records: StoredOutlineRecord[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(outlinesDir, e.name), 'utf-8');
        const parsed = JSON.parse(raw) as StoredOutlineRecord;
        if (parsed?.outline && Array.isArray(parsed.outline.children)) {
          records.push(parsed);
        }
      } catch {
        // skip malformed
      }
    }
    return records;
  } catch {
    return [];
  }
}
