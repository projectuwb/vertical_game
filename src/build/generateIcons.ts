// Generates every app icon at build time (Task 5.1's PWA icons, Task 5.4's Android
// launcher icons — TECH_SPEC.md §7: "App icons (192, 512, maskable) and the splash are
// generated at build time by a Node script that draws them with the same Canvas code as
// the game, so the icon is literally a brushstroke rendered by the engine"). There is no
// `CanvasRenderingContext2D` in Node (no `canvas` package — not in TECH_SPEC.md §2's
// devDependency list), so this rasterizes the *exact same glyph geometry*
// `render/strokes.ts`'s `drawHaraiGlyph` uses (a Harai stroke: GAME_DESIGN.md §4's "a
// long tapering diagonal sliver," the class most legible as a single mark at icon scale)
// directly against a flat pixel buffer, using the same two palette colours the real
// Harai stroke would ever be drawn in.
//
//   npm run generate-icons   (also wired into `npm run build`, per TECH_SPEC.md §7)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodePng } from './png.js';

// Mirrors render/palette.ts's PALETTE — duplicated rather than imported because
// palette.ts lives under /render (browser-only by TECH_SPEC.md §3's layout, and this
// script compiles under tsconfig.cli.json's Node-only program alongside /core, /sim,
// /meta, /balance, matching harness.ts's own established pattern). Two colours, unlikely
// to drift silently: if GAME_DESIGN.md §12's palette ever changes, `render/strokes.ts`'s
// CLASS_COLOR.harai and PALETTE.deep are the two lines to check against these.
const PALETTE_DEEP = [0x17, 0x1e, 0x26] as const; // #171E26 — background, matches manifest
const PALETTE_BONE = [0xe8, 0xe2, 0xd4] as const; // #E8E2D4 — Harai class colour

interface IconSpec {
  readonly outputPath: string;
  readonly sizePx: number;
  /** Fraction of the icon's own size the glyph's long axis spans — smaller for
   *  `maskable`/Android-adaptive variants so the mark stays inside the ~66-80%-diameter
   *  safe zone every platform's own masking shape (circle, squircle, rounded
   *  square...) is guaranteed to keep. */
  readonly glyphScale: number;
  /** Android's adaptive-icon foreground layer is composited *over* a separate
   *  background colour (`ic_launcher_background.xml`) by the OS itself — it needs a
   *  transparent backing, not an opaque one, unlike every other variant here. */
  readonly transparentBackground: boolean;
}

const WEB_ICON_DIR = resolve(process.cwd(), 'public/icons');
const ANDROID_RES_DIR = resolve(process.cwd(), 'android/app/src/main/res');

// Standard Android launcher icon sizes (density-independent px at each bucket) — the
// same five `mipmap-*` folders TECH_SPEC.md §11's `cap add android` scaffold already
// created. `ic_launcher_foreground` conventionally renders its content within a
// smaller safe area than the legacy square icon, since adaptive icons crop it into
// varying OS-drawn shapes.
const ANDROID_DENSITIES: readonly { readonly dir: string; readonly sizePx: number }[] = [
  { dir: 'mipmap-mdpi', sizePx: 48 },
  { dir: 'mipmap-hdpi', sizePx: 72 },
  { dir: 'mipmap-xhdpi', sizePx: 96 },
  { dir: 'mipmap-xxhdpi', sizePx: 144 },
  { dir: 'mipmap-xxxhdpi', sizePx: 192 },
];

function buildIconSpecs(): IconSpec[] {
  const specs: IconSpec[] = [
    { outputPath: resolve(WEB_ICON_DIR, 'icon-192.png'), sizePx: 192, glyphScale: 0.7, transparentBackground: false },
    { outputPath: resolve(WEB_ICON_DIR, 'icon-512.png'), sizePx: 512, glyphScale: 0.7, transparentBackground: false },
    {
      outputPath: resolve(WEB_ICON_DIR, 'icon-mask-512.png'),
      sizePx: 512,
      glyphScale: 0.5,
      transparentBackground: false,
    },
  ];

  // The Android platform is generated once via `npx cap add android` (TECH_SPEC.md §11)
  // and its whole directory is committed — but skip gracefully rather than crash the
  // (more fundamental) web PWA icon generation if a checkout genuinely doesn't have it.
  if (existsSync(ANDROID_RES_DIR)) {
    for (const { dir, sizePx } of ANDROID_DENSITIES) {
      specs.push({
        outputPath: resolve(ANDROID_RES_DIR, dir, 'ic_launcher.png'),
        sizePx,
        glyphScale: 0.7,
        transparentBackground: false,
      });
      specs.push({
        outputPath: resolve(ANDROID_RES_DIR, dir, 'ic_launcher_round.png'),
        sizePx,
        glyphScale: 0.7,
        transparentBackground: false,
      });
      specs.push({
        outputPath: resolve(ANDROID_RES_DIR, dir, 'ic_launcher_foreground.png'),
        sizePx,
        glyphScale: 0.4,
        transparentBackground: true,
      });
    }
  }

  return specs;
}

type Point = readonly [number, number];
type Triangle = readonly [Point, Point, Point];

/** Same triangle `drawHaraiGlyph` (render/strokes.ts) fills, in the same proportions
 *  (length = size*1.6, width = size*0.32, rotated -π/5) — just evaluated as a
 *  point-in-triangle test per pixel instead of through CanvasRenderingContext2D, since
 *  Node has no canvas to hand that geometry to. */
function haraiTrianglePoints(cx: number, cy: number, size: number): Triangle {
  const length = size * 1.6;
  const width = size * 0.32;
  const angle = -Math.PI / 5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotate = ([lx, ly]: Point): Point => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
  return [rotate([-length / 2, 0]), rotate([length / 2, -width / 2]), rotate([length / 2, width / 2])];
}

function sign(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function pointInTriangle(px: number, py: number, tri: Triangle): boolean {
  const [a, b, c] = tri;
  const d1 = sign(px, py, a[0], a[1], b[0], b[1]);
  const d2 = sign(px, py, b[0], b[1], c[0], c[1]);
  const d3 = sign(px, py, c[0], c[1], a[0], a[1]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function renderIcon(spec: IconSpec): Buffer {
  const { sizePx, glyphScale, transparentBackground } = spec;
  const rgba = new Uint8Array(sizePx * sizePx * 4);
  for (let i = 0; i < sizePx * sizePx; i++) {
    rgba[i * 4] = PALETTE_DEEP[0];
    rgba[i * 4 + 1] = PALETTE_DEEP[1];
    rgba[i * 4 + 2] = PALETTE_DEEP[2];
    rgba[i * 4 + 3] = transparentBackground ? 0 : 255;
  }

  const glyphSize = sizePx * glyphScale;
  const tri = haraiTrianglePoints(sizePx / 2, sizePx / 2, glyphSize);
  let minX = tri[0][0];
  let maxX = tri[0][0];
  let minY = tri[0][1];
  let maxY = tri[0][1];
  for (const [x, y] of tri) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const xStart = Math.max(0, Math.floor(minX));
  const xEnd = Math.min(sizePx - 1, Math.ceil(maxX));
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(sizePx - 1, Math.ceil(maxY));

  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      if (!pointInTriangle(x + 0.5, y + 0.5, tri)) continue;
      const idx = (y * sizePx + x) * 4;
      rgba[idx] = PALETTE_BONE[0];
      rgba[idx + 1] = PALETTE_BONE[1];
      rgba[idx + 2] = PALETTE_BONE[2];
      rgba[idx + 3] = 255;
    }
  }

  return encodePng(sizePx, sizePx, rgba);
}

function main(): void {
  const specs = buildIconSpecs();
  mkdirSync(WEB_ICON_DIR, { recursive: true });
  for (const spec of specs) {
    const png = renderIcon(spec);
    writeFileSync(spec.outputPath, png);
  }
  console.log(`Generated ${specs.length} icon(s) (web + ${existsSync(ANDROID_RES_DIR) ? 'Android' : 'no Android platform found'}).`);
}

main();
