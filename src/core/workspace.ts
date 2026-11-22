import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { classifyFileArtifact, IndexedDomain, RepoArchitecture } from './indexer.js';
import { extractFileAstFacts } from './astAnalyzer.js';
import { EvidenceAnchor } from './types.js';

interface ParsedPackageInfo {
  name?: string;
  description?: string;
  entrypoints: EvidenceAnchor[];
  depNames: string[];
}

function parsePackageJson(raw: string, domainPrefix: string): ParsedPackageInfo {
  const info: ParsedPackageInfo = { entrypoints: [], depNames: [] };
  try {
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    if (typeof pkg.name === 'string') info.name = pkg.name;
    if (typeof pkg.description === 'string' && pkg.description.trim()) {
      info.description = pkg.description.trim();
    }
    const entryCandidates = [pkg.main, pkg.module];
    for (const c of entryCandidates) {
      if (typeof c === 'string' && c.trim() && !c.includes('dist/')) {
        const clean = c.replace(/^\.\//, '');
        info.entrypoints.push({
          path: domainPrefix ? `${domainPrefix}/${clean}` : clean,
          startLine: 1,
        });
      }
    }
    for (const depField of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = pkg[depField];
      if (deps && typeof deps === 'object') {
        info.depNames.push(...Object.keys(deps as Record<string, unknown>));
      }
    }
  } catch {
    // ignore malformed package.json
  }
  return info;
}

/**
 * Lightweight, section-aware Cargo.toml scanner (no external TOML parser needed).
 * Extracts [package].name/description, [lib]/[[bin]] paths, and [dependencies] keys.
 */
function parseCargoToml(raw: string, domainPrefix: string): ParsedPackageInfo {
  const info: ParsedPackageInfo = { entrypoints: [], depNames: [] };
  let section = '';

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const secMatch = /^\[+([^\]]+)\]+$/.exec(line);
    if (secMatch) {
      section = secMatch[1].trim();
      continue;
    }

    const kvMatch = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const val = kvMatch[2].trim();
    const unquoted = val.replace(/^["']|["']$/g, '');

    if (section === 'package') {
      if (key === 'name' && !info.name) info.name = unquoted;
      if (key === 'description' && !info.description && !val.includes('workspace')) {
        info.description = unquoted;
      }
    } else if (section === 'lib' || section === 'bin') {
      if (key === 'path' && unquoted) {
        info.entrypoints.push({
          path: domainPrefix ? `${domainPrefix}/${unquoted}` : unquoted,
          startLine: 1,
        });
      }
    } else if (section === 'dependencies' || section === 'build-dependencies') {
      info.depNames.push(key);
    }
  }

  return info;
}

function findConventionalEntrypoints(domain: IndexedDomain): EvidenceAnchor[] {
  const conventions = [
    'src/lib.rs',
    'src/main.rs',
    'src/index.ts',
    'src/index.tsx',
    'src/main.ts',
    'src/main.tsx',
    'src/App.tsx',
    'index.ts',
    'main.go',
    '__init__.py',
  ];
  const found: EvidenceAnchor[] = [];
  for (const conv of conventions) {
    const hit = domain.files.find((f) => f === conv || f.endsWith(`/${conv}`));
    if (hit) {
      found.push({ path: hit, startLine: 1 });
      if (found.length >= 2) break;
    }
  }
  return found;
}

/**
 * Enriches RepoArchitecture with real package descriptions, entrypoints, and internal
 * workspace dependency edges from package.json and Cargo.toml (zero AI, bounded I/O).
 */
export async function enrichArchitectureWithWorkspace(
  repoRoot: string,
  arch: RepoArchitecture
): Promise<void> {
  const MAX_MANIFESTS = 60;
  const targets = arch.domains.slice(0, MAX_MANIFESTS);
  const rawDepsByDomain = new Map<string, string[]>();
  const nameToDomainId = new Map<string, string>();

  await Promise.all(
    targets.map(async (domain) => {
      const prefix = domain.paths[0]?.replace(/\/+$/, '') ?? '';
      const pkgPath = prefix ? `${prefix}/package.json` : 'package.json';
      const cargoPath = prefix ? `${prefix}/Cargo.toml` : 'Cargo.toml';

      const hasPkg = domain.files.includes(pkgPath);
      const hasCargo = domain.files.includes(cargoPath);

      let parsed: ParsedPackageInfo | undefined;
      if (hasCargo) {
        try {
          const raw = await fs.readFile(path.join(repoRoot, cargoPath), 'utf-8');
          parsed = parseCargoToml(raw, prefix);
        } catch {
          // ignore
        }
      } else if (hasPkg) {
        try {
          const raw = await fs.readFile(path.join(repoRoot, pkgPath), 'utf-8');
          parsed = parsePackageJson(raw, prefix);
        } catch {
          // ignore
        }
      }

      if (parsed) {
        if (parsed.name) {
          domain.packageName = parsed.name;
          nameToDomainId.set(parsed.name, domain.id);
        }
        // Never overwrite human-authored .atlas/manifest.json descriptions
        if (parsed.description && !domain.fromManifest) {
          domain.description = parsed.description;
        }
        if (parsed.depNames.length > 0) {
          rawDepsByDomain.set(domain.id, parsed.depNames);
        }
        const existingPaths = new Set(domain.entrypoints.map((e) => e.path));
        for (const ep of parsed.entrypoints) {
          if (domain.files.includes(ep.path) && !existingPaths.has(ep.path)) {
            domain.entrypoints.push(ep);
            existingPaths.add(ep.path);
          }
        }
      }

      // Add conventional code entrypoints (src/lib.rs, src/index.ts, etc.) if none declared
      if (domain.entrypoints.length === 0 && !domain.isSupport) {
        domain.entrypoints.push(...findConventionalEntrypoints(domain));
      }
    })
  );

  // Resolve internal workspace dependency edges only
  for (const domain of targets) {
    const rawDeps = rawDepsByDomain.get(domain.id);
    if (!rawDeps) continue;
    const resolved = new Set<string>();
    for (const depName of rawDeps) {
      const targetId = nameToDomainId.get(depName);
      if (targetId && targetId !== domain.id) {
        resolved.add(targetId);
      }
    }
    if (resolved.size > 0) {
      domain.workspaceDeps = [...resolved];
    }
  }
}

export interface ScopeBoundaryItem {
  direction: 'outbound' | 'inbound';
  /** In-scope file or directory path that owns this external link */
  inScopePath: string;
  /** Logical directory/domain path outside current scopeRoot (can be switched to as new scopeRoot!) */
  externalScope: string;
  externalTitle: string;
  samplePath: string;
  relatedFiles: string[];
}

const REL_IMPORT_RE =
  /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|require\s*\()\s*['"](\.\.?\/[^'"]+)['"]/g;

function resolveRelativeImportTarget(
  importerPosix: string,
  specifier: string,
  trackedSet: Set<string>
): string | undefined {
  const cleanSpec = specifier.split('?')[0].split('#')[0];
  const importerDir = path.posix.dirname(importerPosix);
  const joined = path.posix.normalize(path.posix.join(importerDir, cleanSpec));
  if (joined.startsWith('..')) return undefined;

  const candidates = [joined];
  // TypeScript NodeNext `.js` -> `.ts` / `.tsx` resolution
  if (joined.endsWith('.js')) {
    const stem = joined.slice(0, -3);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`);
  } else if (joined.endsWith('.jsx')) {
    candidates.push(`${joined.slice(0, -4)}.tsx`);
  } else {
    candidates.push(
      `${joined}.ts`,
      `${joined}.tsx`,
      `${joined}.js`,
      `${joined}.jsx`,
      `${joined}.rs`,
      `${joined}.py`,
      `${joined}/index.ts`,
      `${joined}/index.tsx`,
      `${joined}/index.js`,
      `${joined}/mod.rs`
    );
  }

  for (const c of candidates) {
    if (trackedSet.has(c)) return c;
  }
  return undefined;
}

function resolveAstOrRelativeImport(
  importerPosix: string,
  specifier: string,
  kind: string,
  trackedSet: Set<string>
): string | undefined {
  // 1. Rust `use crate::foo::bar` or `use super::baz` or `mod child;`
  if (kind === 'rust-use' || kind === 'rust-mod') {
    const srcMarkerIdx = importerPosix.indexOf('/src/');
    const crateSrcRoot =
      srcMarkerIdx >= 0
        ? importerPosix.slice(0, srcMarkerIdx + 4)
        : importerPosix.startsWith('src/')
          ? 'src'
          : '';
    const importerDir = path.posix.dirname(importerPosix);

    if (kind === 'rust-mod') {
      const modName = specifier.trim();
      const cands = [`${importerDir}/${modName}.rs`, `${importerDir}/${modName}/mod.rs`];
      return cands.find((c) => trackedSet.has(c));
    }

    const cleaned = specifier.split('{')[0].replace(/::\*$/, '').replace(/::$/, '').trim();
    const parts = cleaned.split('::').filter(Boolean);
    if (parts[0] === 'crate' && crateSrcRoot && parts.length >= 2) {
      // Try progressive module prefixes (`crate::mod_a::mod_b::Struct` -> `src/mod_a/mod_b.rs` or `src/mod_a.rs`)
      for (let len = Math.min(parts.length, 4); len >= 2; len--) {
        const sub = parts.slice(1, len).join('/');
        const hit = [`${crateSrcRoot}/${sub}.rs`, `${crateSrcRoot}/${sub}/mod.rs`].find((c) =>
          trackedSet.has(c)
        );
        if (hit) return hit;
      }
    } else if (parts[0] === 'super' && parts.length >= 2) {
      const parentDir = path.posix.dirname(importerDir);
      const modSeg = parts[1];
      const hit = [`${parentDir}/${modSeg}.rs`, `${parentDir}/${modSeg}/mod.rs`].find((c) =>
        trackedSet.has(c)
      );
      if (hit) return hit;
    }
    return undefined;
  }

  // 2. Python relative imports (`from .engine import x` / `from ..shared import y`)
  if (kind === 'py-import' && specifier.startsWith('.')) {
    const m = /^(\.+)(.*)$/.exec(specifier);
    if (m) {
      const upCount = Math.max(0, m[1].length - 1);
      let baseDir = path.posix.dirname(importerPosix);
      for (let i = 0; i < upCount; i++) baseDir = path.posix.dirname(baseDir);
      const rest = m[2].replace(/\./g, '/');
      const joined = rest ? path.posix.normalize(`${baseDir}/${rest}`) : baseDir;
      const hit = [`${joined}.py`, `${joined}/__init__.py`].find((c) => trackedSet.has(c));
      if (hit) return hit;
    }
  }

  // 3. Relative JS/TS/CJS imports (`./...`, `../...`)
  if (specifier.startsWith('.')) {
    return resolveRelativeImportTarget(importerPosix, specifier, trackedSet);
  }
  return undefined;
}

function inferExternalGroup(targetPath: string, arch: RepoArchitecture): { scope: string; title: string } {
  for (const d of arch.domains) {
    const p = d.paths[0]?.replace(/\/+$/, '');
    if (p && (targetPath === p || targetPath.startsWith(`${p}/`))) {
      return { scope: p, title: d.name };
    }
  }
  const segs = targetPath.split('/');
  if (segs.length >= 3 && (segs[0] === 'src' || segs[0] === 'crates' || segs[0] === 'packages' || segs[0] === 'apps')) {
    const sc = `${segs[0]}/${segs[1]}`;
    return { scope: sc, title: sc };
  }
  if (segs.length >= 2) {
    return { scope: segs[0], title: segs[0] };
  }
  return { scope: '', title: targetPath };
}

/**
 * Deterministically detects outbound dependencies (in-scope -> outside scopeRoot)
 * and inbound references (outside scopeRoot -> in-scope) using workspace manifests
 * and bounded relative-import resolution.
 */
export async function scanScopeExternalEdges(
  repoRoot: string,
  trackedFiles: string[],
  scopeRoot: string,
  arch: RepoArchitecture
): Promise<ScopeBoundaryItem[]> {
  const cleanScope = scopeRoot.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleanScope) return [];

  const isInScope = (p: string): boolean => p === cleanScope || p.startsWith(`${cleanScope}/`);
  const normFiles = trackedFiles.map((f) => f.replace(/\\/g, '/'));
  const trackedSet = new Set(normFiles);

  // Key: `${direction}|${inScopeOwner}|${externalScope}`
  const grouped = new Map<string, ScopeBoundaryItem>();

  const recordEdge = (params: {
    direction: 'outbound' | 'inbound';
    inScopePath: string;
    externalScope: string;
    externalTitle: string;
    samplePath: string;
    detailFile: string;
  }) => {
    const key = `${params.direction}|${params.inScopePath}|${params.externalScope || params.externalTitle}`;
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.relatedFiles.includes(params.detailFile) && existing.relatedFiles.length < 6) {
        existing.relatedFiles.push(params.detailFile);
      }
      return;
    }
    grouped.set(key, {
      direction: params.direction,
      inScopePath: params.inScopePath,
      externalScope: params.externalScope,
      externalTitle: params.externalTitle,
      samplePath: params.samplePath,
      relatedFiles: [params.detailFile],
    });
  };

  // 1. Workspace manifest dependencies (Cargo.toml / package.json)
  const domainById = new Map(arch.domains.map((d) => [d.id, d]));
  for (const d of arch.domains) {
    const dPrefix = d.paths[0]?.replace(/\/+$/, '') ?? '';
    if (!dPrefix || !d.workspaceDeps) continue;
    const dInside = isInScope(dPrefix);

    for (const depId of d.workspaceDeps) {
      const target = domainById.get(depId);
      if (!target) continue;
      const tPrefix = target.paths[0]?.replace(/\/+$/, '') ?? '';
      if (!tPrefix) continue;
      const tInside = isInScope(tPrefix);

      if (dInside && !tInside) {
        recordEdge({
          direction: 'outbound',
          inScopePath: dPrefix,
          externalScope: tPrefix,
          externalTitle: target.name,
          samplePath: target.entrypoints[0]?.path ?? target.files[0] ?? tPrefix,
          detailFile: target.name,
        });
      } else if (!dInside && tInside) {
        recordEdge({
          direction: 'inbound',
          inScopePath: tPrefix,
          externalScope: dPrefix,
          externalTitle: d.name,
          samplePath: d.entrypoints[0]?.path ?? d.files[0] ?? dPrefix,
          detailFile: d.name,
        });
      }
    }
  }

  // 2. Bounded relative import scan across code/test files
  const inScopeCode: string[] = [];
  const outScopeCode: string[] = [];
  for (const f of normFiles) {
    const kind = classifyFileArtifact(f);
    if (kind !== 'code' && kind !== 'test') continue;
    if (isInScope(f)) {
      if (inScopeCode.length < 120) inScopeCode.push(f);
    } else if (outScopeCode.length < 160) {
      outScopeCode.push(f);
    }
  }

  const readHead = async (rel: string): Promise<string> => {
    try {
      const handle = await fs.open(path.join(repoRoot, rel), 'r');
      try {
        const buf = Buffer.alloc(16384);
        const { bytesRead } = await handle.read(buf, 0, 16384, 0);
        return buf.subarray(0, bytesRead).toString('utf-8');
      } finally {
        await handle.close();
      }
    } catch {
      return '';
    }
  };

  const extractResolvedTargets = async (fileRel: string): Promise<string[]> => {
    const head = await readHead(fileRel);
    if (!head) return [];

    // Prefer Tree-sitter AST import extraction so comments & string/HTML templates never produce false edges!
    const astFacts = await extractFileAstFacts(fileRel, head);
    if (astFacts) {
      const out = new Set<string>();
      for (const imp of astFacts.imports) {
        const resolved = resolveAstOrRelativeImport(
          fileRel,
          imp.specifier,
          imp.kind,
          trackedSet
        );
        if (resolved && resolved !== fileRel) out.add(resolved);
      }
      return [...out];
    }

    // Fallback regex for languages without a Tree-sitter grammar
    const out = new Set<string>();
    REL_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REL_IMPORT_RE.exec(head)) !== null) {
      const resolved = resolveRelativeImportTarget(fileRel, m[1], trackedSet);
      if (resolved && resolved !== fileRel) out.add(resolved);
    }
    return [...out];
  };

  await Promise.all([
    ...inScopeCode.map(async (srcFile) => {
      const targets = await extractResolvedTargets(srcFile);
      for (const resolved of targets) {
        if (!isInScope(resolved)) {
          const ext = inferExternalGroup(resolved, arch);
          recordEdge({
            direction: 'outbound',
            inScopePath: srcFile,
            externalScope: ext.scope,
            externalTitle: ext.title,
            samplePath: resolved,
            detailFile: resolved.split('/').pop() || resolved,
          });
        }
      }
    }),
    ...outScopeCode.map(async (callerFile) => {
      const targets = await extractResolvedTargets(callerFile);
      for (const resolved of targets) {
        if (isInScope(resolved)) {
          const ext = inferExternalGroup(callerFile, arch);
          recordEdge({
            direction: 'inbound',
            inScopePath: resolved,
            externalScope: ext.scope,
            externalTitle: ext.title,
            samplePath: callerFile,
            detailFile: callerFile.split('/').pop() || callerFile,
          });
        }
      }
    }),
  ]);

  return [...grouped.values()];
}
