# COLORBLIND_REPORT

Automated check (Task 7.6) for GAME_DESIGN.md §4/§12: "class must be legible from silhouette alone." Rasterizes the exact glyph geometry `render/strokes.ts` draws (no browser/canvas dependency — a flat pixel buffer, same technique `generateIcons.ts` uses) and checks two independent things per class pair: whether *colour alone* still distinguishes them after a greyscale or dichromatic-vision transform (expected to often fail — that's the whole reason silhouette has to carry the load), and whether the *silhouette* does, which is colour-transform-independent by construction and is what actually gates pass/fail below.

## Silhouette distinctness (colour-independent, the actual pass/fail gate)

| Class pair | Jaccard distance | Result |
|---|---|---|
| hane vs tome | 0.882 | PASS (floor 0.5) |
| hane vs harai | 0.922 | PASS (floor 0.5) |
| tome vs harai | 0.852 | PASS (floor 0.5) |

## Fill-colour distance under each transform (context only, never gates pass/fail)

| Class pair | Original | Greyscale | Protanopia | Deuteranopia | Tritanopia |
|---|---|---|---|---|---|
| hane vs tome | 212.5 | 81.4 | 117.3 | 132.5 | 203.8 |
| hane vs harai | 169.2 | 133.4 | 157.3 | 172.5 | 164.6 |
| tome vs harai | 238.5 | 214.8 | 206.6 | 195.5 | 239.4 |

## Verdict: PASS

Every class pair stays silhouette-distinguishable regardless of colour transform — Task 5.3's claim holds structurally, not just by one-off eye verification.
