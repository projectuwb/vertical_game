// Headless Passage runner (Task 2.7, TECH_SPEC.md §6):
//
//   npm run sim -- --runs 2000 --strategy mixed --upgrades 0 --seed 12345
//   npm run sim -- --sweep slipBudget=12,18,24,30 --runs 500
//
// Compiles via tsconfig.cli.json + plain `node` (see DECISIONS.md on why not `tsx`) and
// imports only /sim, /core, /meta, and this package's own /balance modules — never
// /render, /ui, /audio, or /platform — so it is exactly the simulation the real game
// runs, driven by a scripted bot instead of a human. /meta is safe here: like /sim, it
// never touches the DOM (see meta/profile.ts, meta/economy.ts, meta/upgrades.ts).

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveSeed } from '../core/rng.js';
import { FIXED_DT } from '../core/loop.js';
import { createWorld, stepWorld } from '../sim/world.js';
import { INKSTONE_TRACK_IDS, type InkstoneTrackId } from '../sim/config.js';
import { computeGoldLeaf } from '../meta/economy.js';
import { ALL_BOT_STRATEGIES, createBotState, decideInput, type BotStrategy } from './bot.js';
import { generateReport, type ReportedDeathCause, type RunResult } from './report.js';

interface CliArgs {
  readonly runs: number;
  readonly strategy: BotStrategy | 'all';
  readonly upgrades: number;
  readonly seed: number;
  readonly sweep: string | null;
  readonly out: string;
  readonly maxPassageS: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      raw[key] = next;
      i++;
    } else {
      raw[key] = 'true';
    }
  }

  let strategy: BotStrategy | 'all' = 'all';
  if (raw.strategy !== undefined) {
    const knownStrategies: readonly string[] = ALL_BOT_STRATEGIES;
    if (raw.strategy === 'all' || knownStrategies.includes(raw.strategy)) {
      strategy = raw.strategy as BotStrategy | 'all';
    } else {
      console.error(`Unknown --strategy "${raw.strategy}". Valid: all, ${ALL_BOT_STRATEGIES.join(', ')}`);
      process.exit(1);
    }
  }

  return {
    runs: raw.runs !== undefined ? Number(raw.runs) : 200,
    strategy,
    upgrades: raw.upgrades !== undefined ? Number(raw.upgrades) : 0,
    seed: raw.seed !== undefined ? Number(raw.seed) : 1,
    sweep: raw.sweep ?? null,
    out: raw.out ?? 'BALANCE_REPORT.md',
    maxPassageS: raw.maxPassageS !== undefined ? Number(raw.maxPassageS) : 400,
  };
}

/** `--upgrades N` (Task 4.2) applies level N uniformly across all eight Inkstone tracks
 *  — a blunt but adequate stand-in for "a player who's bought roughly evenly" until a
 *  real balance pass (Task 4.6) needs anything more targeted. */
function uniformUpgradeLevels(level: number): Readonly<Record<InkstoneTrackId, number>> {
  return Object.fromEntries(INKSTONE_TRACK_IDS.map((id) => [id, level])) as Record<InkstoneTrackId, number>;
}

function runOnePassage(seed: number, strategy: BotStrategy, maxPassageS: number, upgradeLevel: number): RunResult {
  const world = createWorld(seed, uniformUpgradeLevels(upgradeLevel));
  const botState = createBotState(seed);
  let lastGateResolvedAtS: number | null = null;
  const maxSteps = Math.ceil(maxPassageS / FIXED_DT);

  let steps = 0;
  while (!world.isDead && steps < maxSteps) {
    const hadGate = world.currentGatePair !== null;
    const input = decideInput(strategy, world, FIXED_DT, botState);
    stepWorld(world, FIXED_DT, input);
    if (hadGate && world.currentGatePair === null) lastGateResolvedAtS = world.timeS;
    steps++;
  }

  const timedOut = !world.isDead;
  const deathCause: ReportedDeathCause = timedOut ? 'timeout' : (world.deathCause as ReportedDeathCause);
  const diedWithin8sOfGate = timedOut || lastGateResolvedAtS === null ? null : world.timeS - lastGateResolvedAtS <= 8;

  return {
    strategy,
    seed,
    passageLengthS: world.timeS,
    peakLine: world.peakLineCount,
    deathCause,
    goldLeaf: computeGoldLeaf(world.blotKilled, world.distanceU, world.sealsBroken, upgradeLevel),
    distanceU: world.distanceU,
    blotKilled: world.blotKilled,
    diedWithin8sOfGate,
    // world.seal freezes non-null the instant `isDead` does (stepWorld's top-level
    // early-return), so "currently mid-fight/approach at run end" is still caught here
    // even for a run that died before ever breaking one.
    sealReached: world.sealsBroken > 0 || world.seal !== null,
    sealBroken: world.sealsBroken > 0,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const strategies: readonly BotStrategy[] = args.strategy === 'all' ? ALL_BOT_STRATEGIES : [args.strategy];
  const runsPerStrategy = Math.max(1, Math.floor(args.runs / strategies.length));

  const results: RunResult[] = [];
  for (const strategy of strategies) {
    for (let i = 0; i < runsPerStrategy; i++) {
      const seed = deriveSeed(args.seed, `${strategy}:${i}`);
      results.push(runOnePassage(seed, strategy, args.maxPassageS, args.upgrades));
    }
  }

  const timedOutCount = results.filter((r) => r.deathCause === 'timeout').length;
  // BALANCE (sim/config.ts) is deliberately a deeply frozen singleton (Task 1.6's own
  // acceptance test asserts this) with no per-run override channel — a real --sweep
  // needs a config-injection path threaded through createWorld/stepWorld, which is
  // Task 4.6's job ("sweep the director and Slip budget until every target passes"),
  // not this one. Logged in DECISIONS.md.
  const sweepNote =
    args.sweep === null
      ? null
      : `--sweep "${args.sweep}" was requested but is not wired to override BALANCE yet (see DECISIONS.md) — every run below used the unmodified default config.`;

  const report = generateReport(results, {
    seed: args.seed,
    upgrades: args.upgrades,
    runsPerStrategy,
    maxPassageSCap: args.maxPassageS,
    timedOutCount,
    sweepNote,
  });

  const outPath = resolve(process.cwd(), args.out);
  writeFileSync(outPath, report, 'utf8');
  console.log(`Wrote ${outPath} — ${results.length} Passages across [${strategies.join(', ')}].`);
}

main();
