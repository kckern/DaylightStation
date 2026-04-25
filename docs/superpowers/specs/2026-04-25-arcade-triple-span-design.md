# Arcade Triple-Row-Span + Area-Balanced Optimization Design

## Problem

Double-row band spans currently consume too much area for the layouts where many tall tiles exist. With 4 tall items in a 26-tile list, 4 doubles take ~30–40% of total area despite the talls being only ~15% of the items. The packer's score function (`fillRatio`) is blind to this imbalance — it picks the layout that fills `H` best, regardless of how dominant tall tiles look.

## Goal

1. Add **triple-row bands**: two tall tiles stacked vertically into a single band that spans three rows of non-tall tiles. Each tall consumes 1.5 row-equivalents of vertical space instead of 2 — tighter, less dominant.
2. Replace the simple `fillRatio` score with a **multi-objective composite** that penalizes tall-area dominance.
3. **Monte Carlo over band-type variants** per shuffle: enumerate combinations of (triples, doubles, singles) for the K tall items, score each, pick the best.

## Architecture

### Triple-band geometry

A triple band contains:
- Two **stacked tall tiles** (`t_top`, `t_bot`) sharing a single width `w_t` — heights vary by their individual ratios so the seam between them sits wherever the ratio difference puts it (not constrained to 50%).
- Three **normal-tile rows** (`top`, `mid`, `bot`) on the opposite side, each filling `(W − w_t − gap)` horizontally.
- Two **inter-row gaps** between the three normal rows; one **inter-tall gap** between the two stacked talls.

Pinning both talls to the same width is the key constraint that keeps the inside edge clean. Different ratios are accommodated by adjusting heights (`tall.h = w_t × r_t`).

### Closed form

Let:
- `r_t1`, `r_t2` = ratios of the two tall tiles
- `S_top`, `S_mid`, `S_bot` = `Σ(1/r_i)` over each normal row's tiles
- `n_top`, `n_mid`, `n_bot` = tile counts in each normal row
- `K = 1/S_top + 1/S_mid + 1/S_bot`
- `G = n_top/S_top + n_mid/S_mid + n_bot/S_bot`
- `R = r_t1 + r_t2`

Solve:
```
w_t = [W·K − gap·(G − 1)] / (R + K)
tall_top.h = w_t · r_t1
tall_bot.h = w_t · r_t2
top_h = (W − w_t − n_top·gap) / S_top
mid_h = (W − w_t − n_mid·gap) / S_mid
bot_h = (W − w_t − n_bot·gap) / S_bot
H_triple = top_h + mid_h + bot_h + 2·gap
```

Sanity check: `H_triple == tall_top.h + gap + tall_bot.h` — both must equal the band's vertical extent. The closed form guarantees this by construction (the `gap·(G − 1)` term subtracts inter-row gaps but adds back the inter-tall gap).

Validity: `w_t > 0`, all derived heights `> 0`, every normal row has ≥ 1 tile.

### Monte Carlo variant enumeration

For each shuffle of the input `order`, with `K` tall items detected:

For each `(t, d, s)` triple where `2t + d + s = K` and `0 ≤ t ≤ ⌊K/2⌋`:
1. Walk `order`. The first `2t` tall encounters pair up into triples (greedy adjacency). The next `d` talls become doubles. The remaining `s` become singles.
2. Build the band sequence with `buildBands` (extended to support triples).
3. Solve raw heights via `solveSingleBand`/`solveDoubleBand`/`solveTripleBand`.
4. Pre-scale `maxRowPct` rejection (existing behavior — checks each non-tall row in each band).
5. `renderBands` to produce placements.
6. Compute composite score.

Variant count per shuffle: `Σ_{t=0}^{⌊K/2⌋} (K − 2t + 1)` ≈ `O(K²)`. For K ≤ 10, that's at most 36 variants. Combined with 20 shuffle attempts × ~10 targetRows × ~36 variants ≈ 7,200 evaluations per pack — still well under 100ms with closed-form solvers.

### Scoring

```
fillRatio = renderedTotalH / H               (capped at 1, then inverted if > 1)
tallAreaFrac = Σ(tall_w · tall_h) / (W · H)
tallCountFrac = K / N
balanceTerm = 1 − |tallAreaFrac − tallCountFrac|
capPenalty = max(0, tallAreaFrac − HARD_CAP)

score = W1·fillRatio + W2·balanceTerm − W3·capPenalty
```

Initial weights: `W1 = 1`, `W2 = 1`, `W3 = 10`. Hard cap: `HARD_CAP = 0.5` (talls cannot consume more than 50% of total area; if they do, heavy penalty).

### Pairing strategy

Greedy by adjacency in shuffled order. The first two talls encountered pair up, then the next two, etc. We do NOT enumerate all `K!/(2^t · t!)` pairing permutations — the shuffle loop (20 attempts) provides pairing diversity naturally.

### Tall-side alternation

Already implemented for double bands (alternates left/right). Extend to triple bands using the same `doubleBandIndex` counter, renamed `bigBandIndex` since it now counts both doubles and triples.

### Edge cases

- **Odd talls.** With an odd K, after pairing we have one leftover tall. It becomes a single-band tile (no span) or gets its own double band — whichever the variant enumeration picks (variants iterate over all valid `(t, d, s)`, so the leftover is naturally handled by varying `d`).
- **Talls sandwiched between talls.** During pair walking, if a tall appears immediately after another tall and there are no normals to fill the next row's three halves, that triple cannot form and the variant produces an invalid layout (some normal row count = 0). Variant rejected; algorithm picks a different `(t, d, s)`.
- **No normals available at all.** Tall falls back to a single-tile band. Existing behavior in `buildBands` already handles this.
- **Triple band with fewer than 3·minPerRow normals.** Each of the 3 rows must have at least 1 normal tile (validity requirement). If insufficient normals are available adjacent to the tall pair, that variant produces invalid bands → rejected → algorithm picks another.

## File structure

**Modify:** `frontend/src/modules/Menu/arcadePacker.js`
- Add `solveTripleBand({ tallRatios: [r1, r2], topRatios, midRatios, botRatios, W, gap })`.
- Extend `buildBands` to emit `{ type: 'triple', talls: [i1, i2], top: [...], mid: [...], bot: [...] }` when caller specifies `tripleCount`.
- Modify `buildBands` signature: add `tripleCount` and `doubleCount` params; the function consumes that many talls into triples/doubles, rest into singles.
- Extend `renderBands` to handle triple bands. Tall side uses the existing alternation counter (rename `doubleBandIndex` → `bigBandIndex`).
- Extend `solveBandRaw` for triple bands.
- In `packLayout`, add the `(t, d)` variant sweep nested inside the existing `targetRows` sweep.
- Replace `fillRatio` scoring with the composite formula.

**Modify:** `tests/isolated/frontend/arcadePacker.test.mjs`
- New `describe('solveTripleBand', …)` with worked examples.
- Extend `describe('buildBands', …)` to cover `tripleCount > 0`.
- Extend `describe('renderBands', …)` to verify triple-band geometry (stacked talls with seam at the right ratio-derived position).
- Extend `describe('packLayout (band-based)', …)` to verify the optimizer prefers triples in high-tall-density inputs.

**No changes** to `ArcadeSelector.jsx` — the public `packLayout` signature stays the same; the new behavior is internal.

## Testing strategy

- **Unit:** Worked examples for `solveTripleBand` (symmetric ratios → seam at 50%; asymmetric → seam shifted). Validity edge cases (empty rows, oversized inputs).
- **Behavioral:** Synthesize a 16-tile input with 6 talls + 10 normals; assert that `packLayout` produces at least one triple band (the optimizer should pick triples to balance area).
- **Regression:** All existing 33 tests stay green. The legacy parity tests already pin `tallThreshold: 999` so they're unaffected.
- **Visual:** Re-screenshot prod after deploy; verify the layout shows at least one triple span on N64 data (with 4 talls present, the optimizer should pair at least one).

## Tunable constants

```javascript
const DEFAULT_TALL_THRESHOLD = 1.1;   // already set
const DEFAULT_TALL_AREA_CAP = 0.5;    // hard cap on tall area fraction
const DEFAULT_FILL_WEIGHT = 1.0;      // W1 in composite score
const DEFAULT_BALANCE_WEIGHT = 1.0;   // W2 in composite score
const DEFAULT_CAP_PENALTY = 10.0;     // W3 in composite score
```

All overridable via `packLayout` params for tuning.

## Out of scope

- Smart pairing (similar-ratio matching). Adjacent-in-shuffle is good enough; the shuffle loop provides diversity.
- Quadruple-row bands (3 talls stacked). Diminishing returns and the geometry gets ugly with 3 different ratios.
- Triple-band horizontal orientation (talls in a row instead of a column). Not requested; would be a different feature entirely.
