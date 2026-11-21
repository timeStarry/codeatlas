import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IndexedDomain, RepoArchitecture } from './indexer.js';
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
