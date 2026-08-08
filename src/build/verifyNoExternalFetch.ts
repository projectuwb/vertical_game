// Verifies the built bundle never references an external origin (TECH_SPEC.md §10:
// "Runtime must work with the network fully off — verify in a test that fails if any
// runtime `fetch` to an external origin exists in the bundle"). `findExternalUrls` is the
// pure, unit-tested half (tests/build/verifyNoExternalFetch.test.ts); this file's `main`
// is the CLI half that actually scans a real `dist/` after `vite build` and fails the
// build outright — a build-pipeline gate is a stronger, earlier check than a Vitest
// assertion that would otherwise need to shell out to a fresh `vite build` itself just to
// have something to scan (slow, and redundant with `npm run build` already doing it).
//
//   npm run verify-offline   (wired into `npm run build`, after `vite build`)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST_DIR = resolve(process.cwd(), 'dist');

/** Matches any absolute `http(s)://` URL. Vendored fonts, generated icons, and every
 *  actual asset reference in this codebase are same-origin relative paths — GAME_DESIGN.md
 *  and TECH_SPEC.md's "zero cost / offline-first" rules mean there is never a legitimate
 *  reason for an absolute external URL to appear anywhere in the shipped bundle at all,
 *  so this doesn't need an allowlist for CDNs or telemetry endpoints the way a typical
 *  app's equivalent check might. */
const EXTERNAL_URL_PATTERN = /https?:\/\/[^\s"'`)]+/g;

export function findExternalUrls(source: string): string[] {
  return [...source.matchAll(EXTERNAL_URL_PATTERN)].map((m) => m[0]);
}

function listJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (extname(entry) === '.js') {
      out.push(full);
    }
  }
  return out;
}

function main(): void {
  const jsFiles = listJsFiles(DIST_DIR);
  const offenders: string[] = [];
  for (const file of jsFiles) {
    const source = readFileSync(file, 'utf8');
    for (const url of findExternalUrls(source)) {
      offenders.push(`${file}: ${url}`);
    }
  }

  if (offenders.length > 0) {
    console.error('Found external-origin URL(s) in the built bundle — offline play would break:');
    for (const offender of offenders) console.error(`  ${offender}`);
    process.exit(1);
  }

  console.log(`Verified ${jsFiles.length} built JS file(s) reference no external origin.`);
}

// Only run the CLI scan when this file is executed directly (`node .../verifyNoExternalFetch.js`)
// — tests/build/verifyNoExternalFetch.test.ts imports `findExternalUrls` from this same
// module for its pure-function coverage, and an unguarded `main()` would otherwise run a
// real filesystem scan (and potentially `process.exit(1)`) as a side effect of that import.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
