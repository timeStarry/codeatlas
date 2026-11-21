import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AtlasManifest,
  ManifestDriftIssue,
  ManifestLoadResult,
  ManifestVerificationResult,
} from './types.js';
import { listTrackedFiles } from './git.js';
import { verifyAnchor } from './verifier.js';
import { RepoArchitecture } from './indexer.js';

const GLOB_RE = /[*?[\]{}]/;

export async function loadAtlasManifestResult(repoRoot: string): Promise<ManifestLoadResult> {
  const manifestPath = path.join(repoRoot, '.atlas', 'manifest.json');
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return { status: 'missing' };
    }
    return {
      status: 'invalid',
      errors: [`Unable to read .atlas/manifest.json: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    return {
      status: 'invalid',
      errors: [`Invalid JSON in .atlas/manifest.json: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const obj = parsed as Partial<AtlasManifest>;
  const errors: string[] = [];
  if (!obj || typeof obj !== 'object') {
    errors.push('Manifest root must be a JSON object.');
  } else {
    if (obj.schemaVersion !== '0.1') {
      errors.push(`Unsupported manifest schemaVersion "${String(obj.schemaVersion)}" (expected "0.1").`);
    }
    if (!Array.isArray(obj.domains)) {
      errors.push('Manifest "domains" must be an array.');
    }
  }

  if (errors.length > 0) {
    return { status: 'invalid', errors };
  }
  return { status: 'ok', manifest: obj as AtlasManifest };
}

export async function loadAtlasManifest(repoRoot: string): Promise<AtlasManifest | undefined> {
  const res = await loadAtlasManifestResult(repoRoot);
  return res.status === 'ok' ? res.manifest : undefined;
}

/**
 * Longest-prefix-first domain matching so `src/core` is never shadowed by `src`.
 */
export function matchDomainForPath(
  relPath: string,
  manifest?: AtlasManifest
): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (manifest) {
    const candidates: Array<{ prefix: string; domainName: string }> = [];
    for (const domain of manifest.domains) {
      for (const prefix of domain.paths) {
        const cleanPrefix = prefix.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
        if (cleanPrefix) {
          candidates.push({ prefix: cleanPrefix, domainName: domain.name });
        }
      }
    }
    candidates.sort((a, b) => b.prefix.length - a.prefix.length);
    for (const c of candidates) {
      if (normalized === c.prefix || normalized.startsWith(`${c.prefix}/`)) {
        return c.domainName;
      }
    }
  }
  const segments = normalized.split('/');
  return segments.length > 1 ? segments.slice(0, 2).join('/') : '(root)';
}

export async function verifyManifest(
  repoRoot: string,
  manifest: AtlasManifest,
  targetRef = 'WORKTREE'
): Promise<ManifestVerificationResult> {
  const trackedFiles = await listTrackedFiles(repoRoot);
  const issues: ManifestDriftIssue[] = [];
  const seenPrefixes = new Map<string, string>();
  const emptyDiff = new Set<string>();

  for (const domain of manifest.domains) {
    for (const rawPrefix of domain.paths) {
      const clean = rawPrefix.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
      if (GLOB_RE.test(clean)) {
        issues.push({
          severity: 'error',
          domainId: domain.id,
          field: 'path',
          target: rawPrefix,
          message: `Glob patterns are not supported in domain.paths ("${rawPrefix}"). Use exact directory or file prefixes.`,
        });
        continue;
      }

      const prevOwner = seenPrefixes.get(clean);
      if (prevOwner && prevOwner !== domain.id) {
        issues.push({
          severity: 'warning',
          domainId: domain.id,
          field: 'path',
          target: rawPrefix,
          message: `Path prefix "${clean}" is duplicated across domains "${prevOwner}" and "${domain.id}".`,
        });
      } else {
        seenPrefixes.set(clean, domain.id);
      }

      const matched = trackedFiles.some((f) => f === clean || f.startsWith(`${clean}/`));
      if (!matched) {
        issues.push({
          severity: 'error',
          domainId: domain.id,
          field: 'path',
          target: rawPrefix,
          message: `Path prefix "${clean}" matches 0 tracked files in repository.`,
        });
      }
    }

    for (const ep of domain.entrypoints ?? []) {
      const res = await verifyAnchor(repoRoot, ep, targetRef, false, emptyDiff, false, false);
      if (res.badge === 'mismatch') {
        issues.push({
          severity: 'error',
          domainId: domain.id,
          field: 'entrypoint',
          target: `${ep.path}${ep.startLine ? `:${ep.startLine}` : ''}`,
          message: res.notes.join(' ') || `Entrypoint anchor "${ep.path}" failed verification.`,
        });
      }
    }
  }

  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}

export async function exportManifestDraft(
  repoRoot: string,
  arch: RepoArchitecture,
  overwrite = false
): Promise<string> {
  const atlasDir = path.join(repoRoot, '.atlas');
  const manifestPath = path.join(atlasDir, 'manifest.json');

  if (!overwrite) {
    try {
      await fs.access(manifestPath);
      throw new Error('.atlas/manifest.json already exists. Refusing to overwrite without explicit confirmation.');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  const draft: AtlasManifest = {
    schemaVersion: '0.1',
    domains: arch.domains
      .filter((d) => d.paths.length > 0)
      .map((d) => ({
        id: d.id.replace(/^auto:/, '').replace(/[^a-zA-Z0-9_-]/g, '-'),
        name: d.name,
        description: d.description,
        paths: d.paths,
        entrypoints: d.files[0] ? [{ path: d.files[0], startLine: 1 }] : [],
      })),
    guardrails: [
      'Keep .atlas/manifest.json focused on stable architectural domains and guardrails.',
    ],
  };

  await fs.mkdir(atlasDir, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(draft, null, 2) + '\n', 'utf-8');
  return manifestPath;
}
