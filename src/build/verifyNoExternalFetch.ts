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

/** Matches any absolute `http(s)://` URL. First-party code in this repo never has a
 *  legitimate reason to reference one (GAME_DESIGN.md/TECH_SPEC.md's zero-cost/
 *  offline-first rules — vendored fonts, generated icons, every real asset reference are
 *  all same-origin relative paths). Third-party devDependency code bundled in (Task 5.4's
 *  Capacitor packages) is a different story: `findExternalUrls` still finds every literal
 *  match here, exhaustively — `main`'s own `KNOWN_BENIGN_URLS` below is where the
 *  "is this actually a runtime network call, or just a source comment" judgement call
 *  gets made, keeping this function's own contract simple and this file's one CLI
 *  allowlist auditable in one place rather than silently loosening the matcher itself. */
const EXTERNAL_URL_PATTERN = /https?:\/\/[^\s"'`)]+/g;

export function findExternalUrls(source: string): string[] {
  return [...source.matchAll(EXTERNAL_URL_PATTERN)].map((m) => m[0]);
}

/** Every entry here has been manually checked against the actual bundled source to
 *  confirm it's inert (a licence/attribution comment, not a network call) — add a new
 *  entry only after that same check, with a comment explaining what was verified. */
const KNOWN_BENIGN_URLS: ReadonlySet<string> = new Set([
  // `@capacitor/core`'s own bundled licence header: `/*! Capacitor: https://capacitorjs.com/ - MIT License */`.
  // Confirmed by grepping the built bundle: the URL appears only inside that comment,
  // never as an argument to fetch/XMLHttpRequest/WebSocket/Image/etc.
  'https://capacitorjs.com/',
]);

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
      if (KNOWN_BENIGN_URLS.has(url)) continue;
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
