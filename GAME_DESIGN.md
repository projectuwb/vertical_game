# INKFALL — Game Design Document

Version 1.0. This document is authoritative. Every number here is a starting value that may be tuned by the balance harness (§11), but the *structures* are fixed — do not redesign systems, tune them.

---

## 1. Pitch and design goals

You are a brush. Ahead of you, a scroll unrolls across black water, and the Blot is coming down it — a marching stain of ruined characters that eats writing. You cannot outrun it. You can only write faster than it spreads.

**One-line pitch:** an on-rails ink-painting shooter where your bullets are brushstrokes, your squad is a sentence, and every shot is a choice between writing more of yourself and killing what's in front of you.

**Design goals, in priority order.** When any decision is ambiguous, resolve it toward the higher goal.

1. **The trigger is a budget.** The core tension is that firing at recruitment panels makes you stronger later, and firing at the Blot keeps you alive now, and you cannot do both. Every mechanic must sharpen this, never blunt it.
2. **Readable at a glance.** A player must be able to name what's on screen in under 200ms: what's mine, what's coming, what's good to touch, what isn't. Silhouette and motion carry meaning before colour does.
3. **Growth you can see.** The squad's growth must be visible as *shape* — a longer, denser, louder formation — not just a number ticking up.
4. **One-thumb, sixty seconds.** Playable one-handed in portrait. A run is short. A failed run makes you want the next one within two seconds.
5. **No menus in the fight.** Composition, upgrades, and choices are all expressed by *where you aim*, never by a pop-up during a run.

---

## 2. Fiction and vocabulary

Keep this vocabulary everywhere — code identifiers, UI strings, commit messages.

| Concept | Name | Notes |
|---|---|---|
| The player's leader | **the Brush** | Always present; if the Brush dies the run ends |
| A squad member | **a Stroke** | Three classes, §4 |
| The squad as a whole | **the Line** | "Your Line", not "your squad" |
| Enemies collectively | **the Blot** | Never "zombies", never "enemies" in UI |
| Recruitment panels | **Slips** | Paper slips staked along the verge |
| The paired doors | **Gates** | |
| A stacked barrier | **a Sealstack** | |
| A boss | **a Seal** | Each has a proper name, §8 |
| Soft currency | **Gold Leaf** | |
| The upgrade screen | **the Inkstone** | |
| The special attack | **a Flourish** | |
| The fire resource | **Wetness** | |
| One run | **a Passage** | |

Tone of UI copy: terse, calligraphic, never jokey. "The Line is broken." not "Game over!". "Grind more ink." not "Buy upgrade". Plain verbs, sentence case, no exclamation marks anywhere in the build.

---

## 3. Camera, lane, and control

- Portrait-first. Design resolution 1080×1920, letterboxed sensibly to any aspect from 9:21 to 3:4. Landscape is supported but the lane stays portrait-proportioned with decorative margin.
- Pseudo-3D: a fixed camera behind and above the Brush looking down the scroll. See `TECH_SPEC.md` §4 for the projection.
- Lane is 9 world units wide, x ∈ [−4.5, 4.5]. The Brush is clamped to x ∈ [−4.0, 4.0].
- Forward speed: 22 u/s base, ramping +0.35 u/s per 10s of Passage time, cap 34 u/s.
- **Control:** touch anywhere and drag. Lateral position follows finger delta × 0.028 world-units-per-pixel, critically damped with a 70ms time constant. Absolute-position control is *not* used — drag-relative feels better one-handed and is required. Keyboard: A/D or ←/→ at 14 u/s for desktop play. No other inputs except hold-to-Flourish (§6).
- Auto-fire is always on. There is no fire button.

---

## 4. Strokes — the three classes

The Line is composed of individual Strokes, each belonging to one of three classes. Composition is chosen entirely by **which Slips you shoot** and **which conversion Gates you take**. There is no class-selection menu, ever.

Each class is distinguished by **silhouette first, colour second** (colourblind requirement — see §12).

| | **Hane** (flick) | **Tome** (stop) | **Harai** (sweep) |
|---|---|---|---|
| Silhouette | narrow upward tick | squat heavy block | long tapering diagonal |
| Colour | jade `#4FB79A` | vermilion `#D33A2C` | bone `#E8E2D4` |
| Fire rate | 6.0 /s | 1.6 /s | 3.0 /s |
| Damage | 1 | 9 | 3 |
| Projectile | small dot, fast (60 u/s) | heavy blob, slow (34 u/s), 1.2u splash | thin line, 48 u/s, pierces 2 targets |
| Range | 26u | 20u | 34u |
| Against Crust armour | ×0.5 | ×1.0 | ×0.5 |
| Against Slips | ×1.0 | ×1.0 | ×2.0 |

Design intent: Hane shreds swarms, Tome is the only sane answer to armour, Harai recruits fastest and punches through columns. A pure Line of any one class is viable but fragile; the interesting Lines are mixed.

### Phrase bonus (the composition mechanic)

The formation is drawn in rows of 5 (§5). **If the front row contains 3 or more Strokes of the same class, that class's Phrase fires on a 3.0s cycle:**

- **Hane Phrase — Scatter:** a fan of 9 dots, 45° spread, damage 2 each.
- **Tome Phrase — Press:** a shockwave 3u wide travelling 18u forward, damage 20, staggers non-boss Blot for 0.4s.
- **Harai Phrase — Sweep:** a full-lane-width beam sustained 0.5s, damage 6/tick at 10 ticks/s, pierces everything.

If the front row is 5-of-a-kind, the Phrase cycle drops to 2.0s and damage is ×1.5. This is the single most important expressive decision in the game: converting your whole Line to one class costs you flexibility and buys you a Phrase engine.

**Front row composition is not player-ordered.** It's determined by arrival order — newest Strokes fill from the back, and losses remove from the front. This means a burst of same-class recruitment *reliably* produces a Phrase a few seconds later, which is learnable without being fiddly.

---

## 5. The Line — formation, growth, and loss

- Count `N`, integer, 1 to 999. Start `N` = 3 (+1 per level of the Opening Stroke upgrade).
- Formation: rows of 5, spacing 0.85u lateral and 0.75u longitudinal, arranged in a shallow forward arc (front row leads by 0.3u at the centre). Rows beyond 12 (N > 60) are drawn as **density blocks** — a single filled shape with a per-class stipple — with only the front 3 rows drawn as individual Strokes. This is both a perf rule and an aesthetic one: a big Line should read as a *mass of ink*.
- Firing origin is the front row only, but **damage scales with the whole Line**: each row beyond the first contributes 55% of a normal Stroke's DPS, applied as extra projectiles from the front row (max 24 visible projectiles per class per second; beyond that, fold into damage multipliers on existing projectiles so the screen never floods).
- **Loss:** any Blot unit that reaches the front of the Line kills 1 Stroke and dies (Crust kills 3, Seals kill by attack, §8). Losses remove from the front row first.
- **Death:** `N` reaching 0 ends the Passage. There is no health bar; the Line *is* the health bar.

---

## 6. Wetness and the Flourish

**Wetness** is a 0–100 meter, starting full, drawn as an ink level in the Brush's own body (not as a UI bar — the Brush visibly runs pale).

- Drains **6.0/s while firing**, regardless of `N`. (Flat, deliberately — a big Line must not be punished.)
- Refills **25/s** after 0.8s of not firing.
- **Ink pools** on the road: shallow puddles, ~1 every 140u, restore 40 instantly on contact and leave a wet trail.
- At Wetness 0: fire rate ×0.5 and all colours desaturate 60%. Recovery is automatic; this is a soft punishment, never a death sentence.

**Flourish:** hold anywhere for 0.35s to charge (the Brush rears back, screen edges bleed), release to sweep. Deletes all Blot projectiles on screen, deals `28 × (1 + 0.15 × rowCount)` damage in a 5u radius forward arc, and knocks non-boss Blot back 4u. Costs 40 Wetness, 6.0s cooldown. Holding while at <40 Wetness does nothing but shows the meter pulsing.

Design intent: Wetness converts the "always firing" default into an occasional decision to *stop*, which is when the player notices the road, the pools, and the Slips they're about to miss.

---

## 7. The road — what's on it

The Passage is an endless procedurally-assembled sequence of **segments**, each 120u long, drawn from a weighted table by the Spawn Director (§9).

### 7.1 Slips (recruitment)

Rows of paper slips staked along one or both verges, angled toward the player. Shooting one converts it into a Stroke that runs in and joins the back of the Line.

- `+1` Slip: 1 HP, class-tinted, appears in runs of 4–14.
- `+5` Slip: 6 HP, larger, appears singly or in pairs.
- `+25` Banner: 40 HP, spans a third of the lane, always at the end of a Slip run — a reward for having committed fire to that verge.
- Slips scroll past. Missing them costs nothing but opportunity. **This is the core decision surface — Slip density must always be high enough that the player feels the loss of not shooting them.**

Class assignment: each Slip run is single-class (so committing to a verge commits to a class). Class weighting adapts mildly: the class you currently have *least* of is 1.5× more likely to appear, so the game keeps offering you the choice you've been declining.

### 7.2 Gates

Paired paper doors, each spanning half the lane. You pass through one. Gate pairs appear roughly every 220u.

**Arithmetic:** `×2`, `×3`, `+12`, `+25`, `−10`, `÷2`
**Conversion:** `→ Hane`, `→ Tome`, `→ Harai` — converts the entire Line to that class
**Temper (run-scoped, stacking to 5):** `Rate +20%`, `Range +25%`, `Splash +30%`, `Wetness cap +25`
**Sealed:** shows only a seal mark; resolves on contact from a weighted table (60% good, 40% bad). Always paired against a known modest gate, so taking it is a real gamble.

Pairing rule: never pair two identical gates; never pair two strictly-bad gates; at least 1 in 4 pairs must be a genuine dilemma (e.g. `×2` vs `→ Tome` when Crust is about to appear).

**Gate maths order:** multiply before add within a single gate; conversion applies after count changes.

### 7.3 Sealstacks

A stacked column of discs blocking part of the lane, printed with a Blot figure, carrying an HP number. Shoot it down before contact or lose `ceil(remainingHP / 12)` Strokes on impact. They occupy one half of the lane, so they double as a forced lateral commitment.

### 7.4 Ink pools

See §6. Also visually reset the ink trail the Line leaves behind — the trail is the signature visual (§12).

---

## 8. The Blot and the Seals

### 8.1 Blot units

| Unit | HP | Speed | Behaviour |
|---|---|---|---|
| **Smudge** | 3 | 8 u/s | Marches straight at the Line. The bulk of every wave. |
| **Runner** | 2 | 16 u/s | Sprints; arrives ahead of its wave to punish over-committing to Slips. |
| **Crust** | 25 | 6 u/s | Armoured: halves Hane and Harai damage. Kills 3 Strokes on contact. |
| **Splitter** | 12 | 9 u/s | On death spawns 3 Smudges at ±1u. |
| **Blotter** | 8 | 5 u/s | Stops at 18u and lobs ink every 2.2s; a hit kills 1 Stroke. Must be prioritised. |
| **Drifter** | 6 | 10 u/s | Strafes laterally, forcing you to lead your shots. |

Blot render as ragged, wet-edged silhouettes with visible bleed — never detailed characters. A wave of 300 should read as a single advancing stain that resolves into individuals as it nears.

### 8.2 Seals (bosses)

A Seal appears at the end of every **stage** (§10), and in the arcade loop every 75s of Passage time. Approach is telegraphed 6s ahead: the road narrows, the music drops out, a vertical seal-mark rises in the distance.

Shared rules: segmented HP bar (segments = phase count), each phase ends with a stagger and a 1.5s damage window at ×2. HP = `420 × 1.62^(sealIndex)`. Contact damage is by attack only, never by touch. Seals do not block Slips — Slip runs continue during the fight along one verge, so the growth/survival tension persists into the boss.

Three Seals, cycling with increasing index:

**1. The Smear** (3 phases) — sweeps an arm laterally across two thirds of the lane, telegraphed by a 0.9s ink-gathering pull; kills Strokes it crosses. Phase 3 adds a trailing residue that must be dodged for 2s.

**2. The Press** (3 phases) — slams down, sending a shockwave ring; you must be outside the ring or in the one gap in it. Summons 8 Smudges per slam. Phase 2 adds a second, offset ring. Phase 3 slams on a 2-beat rhythm — deliberately learnable, deliberately musical.

**3. The Blank** (4 phases) — erases. Fires a beam that *removes Slips and Gates* from the road for 3s, plus a cone that converts hit Strokes into Blot that then attack you. The only Seal where losing feels like it compounds. Phase 4 erases the road markings entirely, leaving only the ink trail to navigate by.

Design rule for all Seal attacks: every attack has a telegraph of at least 0.7s, and every attack has a correct answer that is a *position*, not a reflex.

---

## 9. The Spawn Director

A single module owning all road content, driven by Passage time `t` and Line size `N`.

- **Pressure** `P = 1 + t/38 + log2(max(N,1)) × 0.55` — governs wave size and composition.
- Wave interval: `max(2.4, 7.5 − t/32)` seconds.
- Wave size: `round(4 + P × 3.2)`, capped 240.
- Composition by pressure band: P<3 Smudge only; P 3–6 add Runner (20%); P 6–10 add Crust (10%) and Blotter (12%); P>10 add Splitter (15%) and Drifter (15%), Crust to 18%.
- **Slip budget** is kept proportional: total Slip HP offered per 100u ≈ `18 + P × 6`. The game must always offer roughly enough growth to keep pace *if the player spends most of their fire on it* — and then not enough survival if they do. That knife edge is the game.
- **Mercy rule:** if `N` ≤ 2 for more than 4s, suppress Crust and Splitter spawns and raise Slip density 60% for 8s. Once per Passage. Never announce it.
- **Anti-snowball:** if `N` > 400, wave size multiplier ×1.35 and Crust share +8%.

Every director decision draws from the seeded PRNG. Nothing is frame-dependent.

---

## 10. Structure

### Phase-2 build (arcade + meta) — the first shippable game

One endless Passage. Seals every 75s, cycling with rising index. Death → run summary → Inkstone → run again. Loop target: from death to next Passage in **two taps and under 3 seconds**.

Run summary shows: distance, peak Line, Blot unbound, Seals broken, Gold Leaf earned, best-ever comparison. One animated number, the rest static — no drum roll.

**Gold Leaf earned** = `blotKilled × 1 + floor(distance / 8) + sealsBroken × 120`, then × the Leaf upgrade multiplier.

### The Inkstone (meta upgrades)

Eight tracks, 10 levels each. Cost at level `L` (0-indexed) = `round(base × 1.38^L)`.

| Track | Effect per level | Base cost |
|---|---|---|
| **Opening Stroke** | Start with +1 Stroke | 40 |
| **Grind** | +4% damage | 30 |
| **Nib** | +3% fire rate | 30 |
| **Well** | +8 Wetness cap | 25 |
| **Leaf** | +5% Gold Leaf | 35 |
| **Reach** | +4% range, +2% Slip damage | 25 |
| **Flourish Study** | −0.4s Flourish cooldown (floor 2.0s) | 45 |
| **Second Draft** | Levels 1/4/8 grant a revive at 35% of peak Line | 200 |

The Inkstone screen is a single scrollable slab, each track a horizontal row of 10 filled/unfilled marks. Affordable upgrades glow gold-leaf; unaffordable are inert. No confirmation dialogs — tapping buys.

### Phase-6 build (roguelite) — layered on top, not replacing

- **8 Scrolls** (chapters), each 5 Stages + a Seal. Stage = a fixed-length Passage of ~55s with a defined theme (Slip-rich, Crust gauntlet, Blotter field, narrow road, no-Gate).
- After each Stage, choose **1 of 3 Techniques** from a pool of 24 run-scoped perks (e.g. *Bleed*: Harai leaves damaging ink; *Weight*: Tome splash +80% but rate −20%; *Doubling*: every 5th Slip counts twice; *Dry Brush*: at Wetness 0, damage ×2). This is the one in-run menu, and it appears only between Stages.
- **4 Brushes** (unlockable archetypes) with distinct starting composition and one passive: *Student* (balanced, default), *Monk* (all-Tome start, Phrase cycle −0.5s), *Courier* (all-Hane start, +18% forward speed, −1 start Stroke), *Censor* (starts with a Blot Stroke that converts enemies on kill, 4% chance).
- **Relics** persisting within a Scroll, awarded by Seals.
- Endless mode unlocks after Scroll 8, using the arcade director with a Scroll-8 pressure floor.
- Arcade mode remains available and shares the Inkstone. Meta upgrades apply to both.

---

## 11. Balance targets

Verify these with the bot harness (`TECH_SPEC.md` §6). A run of 2000 simulated Passages must satisfy:

| Metric | Target |
|---|---|
| Median Passage length, zero upgrades, competent bot | 55–85s |
| Median Passage length, all upgrades level 5 | 150–230s |
| First Seal reached, zero upgrades | ≥70% of runs |
| First Seal broken, zero upgrades | 25–45% of runs |
| Peak Line size, median, zero upgrades | 25–60 |
| Peak Line size, median, upgrades level 5 | 90–250 |
| Runs to afford first upgrade | 2–3 |
| Runs to reach total upgrade level 40 | 55–90 |
| Deaths attributable to Crust | 15–30% |
| Deaths within 8s of a Gate choice | ≤12% (higher means gates are too swingy) |
| Bot "greedy Slips" strategy vs "greedy kill" strategy | neither wins by >20% median distance |

That last row is the most important number in the document. If either extreme strategy dominates, the core tension is broken and the Slip budget in §9 must be retuned until it isn't.

---

## 12. Art direction

**The brief in one sentence:** wet ink and mineral pigment on wet slate, seen from above, at night, with gold leaf used only for money.

**Palette** — exactly these, no others without logging a decision:

| Name | Hex | Use |
|---|---|---|
| Slate | `#2A3440` | Ground, road surface |
| Deep | `#171E26` | Water either side, vignette |
| Bone | `#E8E2D4` | Harai class, road markings, primary text |
| Jade | `#4FB79A` | Hane class, positive gates |
| Vermilion | `#D33A2C` | Tome class, Seals, danger |
| Gold Leaf | `#C9A227` | Currency and only currency |
| Blot | `#0E1116` | The enemy, always the darkest thing on screen |

Deliberately *not* a warm-cream-and-terracotta scheme and not a black-with-one-neon-accent scheme — the ground is cool mineral slate, and there are three chromatic accents in tension, which is the point, since class colour is load-bearing information.

**Colourblind requirement:** class must be legible from silhouette alone (§4). Ship a Shapes-Only toggle that additionally stamps a small glyph mark on every Stroke and Slip. Test by rendering greyscale and confirming classes remain distinguishable.

**Typography:** display/numerals **Shippori Mincho B1** (OFL, vendored, subset to Latin + digits); UI **Zen Kaku Gothic New** (OFL, vendored, subset). Gate numbers are the loudest type in the game — set them enormous, at Shippori's heaviest weight, with a bone stroke on the vermilion fill. Body copy stays small and quiet. No other faces.

**Signature element:** **the ink trail.** The Line leaves a wet, spreading brushstroke on the road behind it — width proportional to `N`, colour blended from the Line's class mix, edges bleeding outward with a subtle capillary wobble. It persists ~4s and darkens the road. Growth is therefore *painted*, not counted: a huge Line lays down a river of ink; a dying Line leaves a thin scratch. The Blank's phase-4 attack erases everything but this trail. Spend the animation budget here and keep everything else restrained.

**Motion rules:** camera shake only on Seal impacts and Flourish, ≤4px, ≤180ms. Hit feedback is an ink splat and a 60ms scale pop, never a flash. No screen-wide particle spam. Respect `prefers-reduced-motion` by halving shake and disabling trail wobble (never by removing gameplay feedback).

**Audio:** all synthesised at runtime. Fire = short filtered noise burst, pitch by class (Hane high tick, Tome low thud, Harai brushed sweep). Recruitment = a soft rising fifth. Gate = paper tear. Seal = detuned low drone. Music = a slow generative two-voice pattern in a pentatonic scale, tempo tied to Pressure, dropping to a single drone before a Seal. Mute persists.

---

## 13. Non-goals

Explicitly out of scope. Do not build these, do not ask about them.

- Ads, IAP, monetisation of any kind, or the plumbing for them.
- Accounts, cloud save, leaderboards, multiplayer, social features.
- Analytics or crash reporting.
- Any store-listing artwork or copy beyond what `README.md` needs.
- Localisation beyond English (but do route all UI strings through a single `strings.ts` so it stays possible).
- A tutorial with text panels. Teaching happens through level design: the first 20 seconds of a first-ever Passage present exactly one Slip run, then one Gate pair, then one wave, with nothing else on screen.
