// Task 7.6: an automated version of GAME_DESIGN.md §12's own stated colourblind test
// method — "Test by rendering greyscale and confirming classes remain distinguishable"
// — plus a proper dichromatic-vision simulation (protanopia/deuteranopia/tritanopia),
// so Task 5.3's claim ("silhouette first, colour second") is checked by a script anyone
// can re-run, not just re-verified by eye in a headless browser each time someone
// touches a glyph. No `CanvasRenderingContext2D` in Node (no `canvas` package — not in
// TECH_SPEC.md §2's devDependency list), so this rasterizes against a flat pixel buffer
// the same way `generateIcons.ts` already does for the app icon's own Harai triangle.
//
// Duplicates `render/strokes.ts`'s `strokeGlyphPolygon` geometry and `render/palette.ts`'s
// hex values rather than importing them: this compiles under `tsconfig.cli.json`'s
// Node-only program, which does not include /render (TECH_SPEC.md §3's browser/Node-CLI
// boundary) — the same constraint, and the same accepted tradeoff, `generateIcons.ts`
// already documents for its own copy of the Harai triangle. If a glyph's shape or a
// class's colour ever changes, both this file and the comment in `strokes.ts` pointing
// back at it are the two places to check.
//
//   npm run check-colorblind

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type StrokeClass = 'hane' | 'tome' | 'harai';

type GlyphPoint = readonly [number, number];

/** Mirrors `render/strokes.ts`'s `strokeGlyphPolygon` exactly — see that file's own
 *  cross-reference comment. */
function strokeGlyphPolygon(cls: StrokeClass, size: number): readonly GlyphPoint[] {
  if (cls === 'hane') {
    const halfWidth = size * 0.18;
    const height = size * 1.3;
    return [
      [0, -height],
      [halfWidth, 0],
      [-halfWidth, 0],
    ];
  }
  if (cls === 'tome') {
    const halfWidth = size * 0.55;
    const halfHeight = size * 0.65;
    return [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ];
  }
  const length = size * 1.6;
  const width = size * 0.32;
  const angle = -Math.PI / 5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local: readonly GlyphPoint[] = [
    [-length / 2, 0],
    [length / 2, -width / 2],
    [length / 2, width / 2],
  ];
  return local.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
}

type RGB = readonly [number, number, number];

/** Mirrors `render/strokes.ts`'s `CLASS_COLOR` (itself sourced from `render/palette.ts`'s
 *  `PALETTE`) — see this file's header comment. */
const CLASS_COLOR: Record<StrokeClass, RGB> = {
  hane: [0x4f, 0xb7, 0x9a], // jade
  tome: [0xd3, 0x3a, 0x2c], // vermilion
  harai: [0xe8, 0xe2, 0xd4], // bone
};

function pointInPolygon(px: number, py: number, poly: readonly GlyphPoint[]): boolean {
  // Standard ray-casting test — works for the convex triangle/quad/triangle shapes here
  // regardless of winding order.
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as GlyphPoint;
    const [xj, yj] = poly[j] as GlyphPoint;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const CANVAS_SIZE = 64;
const GLYPH_SIZE = 20; // matches the glyph filling most of the canvas, comparable to a close-up in-game Stroke

/** Binary "is this pixel part of the glyph" mask — independent of any colour transform,
 *  since a colourblind viewer's actual silhouette perception is a shape question, not a
 *  colour one. Used for the pass/fail check; the colour-transform functions below are
 *  reported for context but never gate pass/fail, since GAME_DESIGN.md §4/§12's rule is
 *  specifically that colour is *allowed* to become indistinguishable as long as shape
 *  doesn't. */
export function silhouetteMask(cls: StrokeClass): boolean[][] {
  const poly = strokeGlyphPolygon(cls, GLYPH_SIZE);
  const cx = CANVAS_SIZE / 2;
  const cy = CANVAS_SIZE / 2;
  const rows: boolean[][] = [];
  for (let y = 0; y < CANVAS_SIZE; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < CANVAS_SIZE; x++) {
      row.push(pointInPolygon(x + 0.5 - cx, y + 0.5 - cy, poly));
    }
    rows.push(row);
  }
  return rows;
}

/** Jaccard distance (1 - intersection/union) between two same-shaped binary masks — 0
 *  means identical silhouettes (a real legibility failure), 1 means no overlap at all.
 *  Iterates the masks' own dimensions rather than the module's `CANVAS_SIZE`, so it's a
 *  genuinely generic, independently-testable function, not one only valid at one fixed size. */
export function silhouetteDistance(a: readonly (readonly boolean[])[], b: readonly (readonly boolean[])[]): number {
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < a.length; y++) {
    const rowA = a[y] as readonly boolean[];
    const rowB = b[y] as readonly boolean[];
    for (let x = 0; x < rowA.length; x++) {
      const av = rowA[x] as boolean;
      const bv = rowB[x] as boolean;
      if (av || bv) union++;
      if (av && bv) intersection++;
    }
  }
  return union === 0 ? 0 : 1 - intersection / union;
}

// Rec. 601 luminance greyscale — GAME_DESIGN.md §12's own literal test method.
function toGreyscale([r, g, b]: RGB): RGB {
  const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  return [l, l, l];
}

/** Approximate dichromatic-vision simulation matrices (commonly cited sRGB-space
 *  approximations used by most browser-based colourblind simulators) — a step further
 *  than GAME_DESIGN.md §12's literal "render greyscale" instruction, since full colour
 *  blindness is rarer than red-green dichromacy and this is the harder, more realistic
 *  case to actually protect against. */
const COLORBLIND_MATRICES: Record<'protanopia' | 'deuteranopia' | 'tritanopia', readonly [number, number, number][]> = {
  protanopia: [
    [0.567, 0.433, 0],
    [0.558, 0.442, 0],
    [0, 0.242, 0.758],
  ],
  deuteranopia: [
    [0.625, 0.375, 0],
    [0.7, 0.3, 0],
    [0, 0.3, 0.7],
  ],
  tritanopia: [
    [0.95, 0.05, 0],
    [0, 0.433, 0.567],
    [0, 0.475, 0.525],
  ],
};

function applyMatrix([r, g, b]: RGB, m: readonly [number, number, number][]): RGB {
  const row = (i: number) => (m[i] as [number, number, number])[0] * r + (m[i] as [number, number, number])[1] * g + (m[i] as [number, number, number])[2] * b;
  return [Math.round(row(0)), Math.round(row(1)), Math.round(row(2))];
}

function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

const CLASS_PAIRS: readonly (readonly [StrokeClass, StrokeClass])[] = [
  ['hane', 'tome'],
  ['hane', 'harai'],
  ['tome', 'harai'],
];

/** Below this, two silhouettes are close enough to genuinely risk reading as "the same
 *  shape" at small on-screen sizes — chosen well below what these three deliberately
 *  different shapes (a narrow tick, a squat block, a long diagonal sliver) actually
 *  measure at, so it's a real regression floor, not a number tuned to just barely pass. */
export const MIN_SILHOUETTE_DISTANCE = 0.5;

function main(): void {
  const masks: Record<StrokeClass, boolean[][]> = {
    hane: silhouetteMask('hane'),
    tome: silhouetteMask('tome'),
    harai: silhouetteMask('harai'),
  };

  const lines: string[] = [];
  lines.push('# COLORBLIND_REPORT');
  lines.push('');
  lines.push(
    'Automated check (Task 7.6) for GAME_DESIGN.md §4/§12: "class must be legible from ' +
      'silhouette alone." Rasterizes the exact glyph geometry `render/strokes.ts` draws ' +
      '(no browser/canvas dependency — a flat pixel buffer, same technique `generateIcons.ts` ' +
      'uses) and checks two independent things per class pair: whether *colour alone* still ' +
      'distinguishes them after a greyscale or dichromatic-vision transform (expected to ' +
      'often fail — that\'s the whole reason silhouette has to carry the load), and whether ' +
      'the *silhouette* does, which is colour-transform-independent by construction and is ' +
      'what actually gates pass/fail below.',
  );
  lines.push('');
  lines.push('## Silhouette distinctness (colour-independent, the actual pass/fail gate)');
  lines.push('');
  lines.push('| Class pair | Jaccard distance | Result |');
  lines.push('|---|---|---|');

  let allPassed = true;
  for (const [a, b] of CLASS_PAIRS) {
    const dist = silhouetteDistance(masks[a], masks[b]);
    const passed = dist >= MIN_SILHOUETTE_DISTANCE;
    allPassed &&= passed;
    lines.push(`| ${a} vs ${b} | ${dist.toFixed(3)} | ${passed ? 'PASS' : 'FAIL'} (floor ${MIN_SILHOUETTE_DISTANCE}) |`);
  }

  lines.push('');
  lines.push('## Fill-colour distance under each transform (context only, never gates pass/fail)');
  lines.push('');
  lines.push('| Class pair | Original | Greyscale | Protanopia | Deuteranopia | Tritanopia |');
  lines.push('|---|---|---|---|---|---|');
  for (const [a, b] of CLASS_PAIRS) {
    const original = colorDistance(CLASS_COLOR[a], CLASS_COLOR[b]);
    const grey = colorDistance(toGreyscale(CLASS_COLOR[a]), toGreyscale(CLASS_COLOR[b]));
    const pro = colorDistance(applyMatrix(CLASS_COLOR[a], COLORBLIND_MATRICES.protanopia), applyMatrix(CLASS_COLOR[b], COLORBLIND_MATRICES.protanopia));
    const deu = colorDistance(applyMatrix(CLASS_COLOR[a], COLORBLIND_MATRICES.deuteranopia), applyMatrix(CLASS_COLOR[b], COLORBLIND_MATRICES.deuteranopia));
    const tri = colorDistance(applyMatrix(CLASS_COLOR[a], COLORBLIND_MATRICES.tritanopia), applyMatrix(CLASS_COLOR[b], COLORBLIND_MATRICES.tritanopia));
    lines.push(`| ${a} vs ${b} | ${original.toFixed(1)} | ${grey.toFixed(1)} | ${pro.toFixed(1)} | ${deu.toFixed(1)} | ${tri.toFixed(1)} |`);
  }

  lines.push('');
  lines.push(`## Verdict: ${allPassed ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(
    allPassed
      ? 'Every class pair stays silhouette-distinguishable regardless of colour transform — Task 5.3\'s claim holds structurally, not just by one-off eye verification.'
      : 'At least one class pair\'s silhouette is too close — a real legibility regression, not a colour issue. Fix the glyph geometry in render/strokes.ts (and this file\'s matching copy) before shipping.',
  );

  const reportPath = resolve(process.cwd(), 'COLORBLIND_REPORT.md');
  writeFileSync(reportPath, lines.join('\n') + '\n');
  console.log(`Wrote ${reportPath} — ${allPassed ? 'PASS' : 'FAIL'}`);

  if (!allPassed) process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
