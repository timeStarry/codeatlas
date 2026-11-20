import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AtlasManifest } from './types.js';

export async function loadAtlasManifest(repoRoot: string): Promise<AtlasManifest | undefined> {
  const manifestPath = path.join(repoRoot, '.atlas', 'manifest.json');
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as AtlasManifest;
    if (parsed && Array.isArray(parsed.domains)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function matchDomainForPath(
  relPath: string,
  manifest?: AtlasManifest
): string {
  const normalized = relPath.replace(/\\/g, '/');
  if (manifest) {
    for (const domain of manifest.domains) {
      for (const prefix of domain.paths) {
        const cleanPrefix = prefix.replace(/\\/g, '/').replace(/\/+$/, '');
        if (normalized === cleanPrefix || normalized.startsWith(`${cleanPrefix}/`)) {
          return domain.name;
        }
      }
    }
  }
  const segments = normalized.split('/');
  return segments.length > 1 ? segments.slice(0, 2).join('/') : '(root)';
}
