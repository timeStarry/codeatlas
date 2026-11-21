import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  AnnotationDirective,
  BriefingReport,
  BriefingVerificationResult,
  EvidenceAnchor,
} from './types.js';
import { getGitContext, getGitStateDir } from './git.js';
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
