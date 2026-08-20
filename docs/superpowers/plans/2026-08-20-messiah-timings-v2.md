# Messiah Timings, Revised Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive the 53 movement boundaries of `plex:6918` with a constraint strong enough to *select* the right alignment, not merely reject the worst — and prove that it selects before shipping anything.

**Supersedes** `2026-08-20-messiah-timings.md`, which was executed. Its Tasks 1–3 succeeded and their code ships; its Task 4 failed in a way that is worth stating precisely, because this plan exists to fix exactly that.

## What the first attempt established

Keep all of it. None of this needs redoing.

| Asset | State |
|---|---|
| `cli/libretto.cli.mjs` | **Done.** 53 numbers, parts 21/23/9, clean sequence checksum, 21 tests |
| `cli/segment-timings.cli.mjs` | **Done.** silence → candidates, applause detection, astats readers, DP aligner, gate. 30 tests |
| The sidecar | **Shipped.** `plex:6918` resolves a `concert-hall` surround with three Part boundaries |
| Part One break | **Confirmed twice independently** — 48.6 min, by silence and by applause |
| Part starts | `[25, 2960, 6180]`, `musicEndsAt: 7128`, self-consistent at 140 s/number across Parts One and Two |

## Why it failed, stated exactly

Two defects, one fixed and one not.

**Fixed:** the search optimised something the gate did not measure. `spanCost` grew linearly, so a span four seconds under its floor cost 4 while a skip cost 40; the search bought bad candidates. `IMPLAUSIBLE_COST` now exceeds every skip the work could need, making the objective lexicographic. That correction is real and stays.

**Not fixed, and the reason for this plan:** *per-form duration priors cannot select an alignment.* Measured — the gate held for four values of `musicEndsAt` spanning twelve minutes, producing materially different answers:

| `musicEndsAt` | gate | omitted | Part III lost | finale |
|---|---|---|---|---|
| 118.8 min | holds | 6 | 5/9 | dropped |
| 125 min | holds | 5 | 4/9 | **kept** |
| 129 min | holds | 4 | 3/9 | dropped |
| 131.3 min | holds | 4 | 3/9 | dropped |

A test that accepts four contradictory answers is not a test of which one is right. `Air: [90, 660]` admits almost anything; with 114 candidates and 53 numbers, an enormous number of alignments score zero. **The gate rejects; it does not select.**

The wrongness was caught only by the plan's insistence on naming the omitted numbers: the accepted alignment omitted **No. 53, the closing chorus and Amen**. No performance omits its own finale.

## The change: superimpose a reference timeline and fit it

Two changes, and the second is the one that makes the gate discriminate.

### Two reference recordings, not one

- **`plex:578447`** — a complete studio *Messiah* in the library. 51 tracks, 149.8 min, a duration on every track.
- **YouTube `2-QV_I-xseA`** — American Bach Soloists at Grace Cathedral, complete, **59 chapters** (57 musical) with exact start and end times, 141.5 min of music. `yt-dlp --write-info-json` reads them; the local Invidious instance cannot (its companion service is not installed).

They mostly agree — **median disagreement 8%** across probe movements, which is ordinary tempo variation between performances. Where they disagree wildly they disagree *informatively*: the studio album has one 450 s track for the closing chorus where the live performance splits it in two (198 s + 263 s = 461 s). Those reconcile almost exactly, and the discrepancy is a **granularity mismatch made visible** rather than a silently corrupted prior. Take a duration where both agree within ~15%; flag the rest as a probable split/merge to resolve rather than averaging them into a wrong number.

### Superimpose the timeline and fit it — the actual discriminator

The first attempt asked 53 *independent local* questions with wide ranges, so a great many alignments passed. Laying the reference timeline over ours asks **one global question with ~47 constraints on very few parameters**, which is massively over-determined — a wrong alignment cannot satisfy it.

The premise is that a performance holds a roughly constant tempo ratio ρ against a reference. **Measured, and it holds**, using only the three Part boundaries already shipped:

| | Part I | Part II | Part III |
|---|---|---|---|
| reference (min) | 54.4 | 52.5 | 34.6 |
| ours (min) | 48.9 | 53.7 | 15.8 |
| implied ρ | 0.899 | 1.023 | **0.456** |

Parts I and II agree within 13.8% — the same order as the 8% variation between the two references. Part III does not, and that is the method working: **a ρ far below its neighbours localises a cut.**

It also caught an error of mine. Re-running with `musicEndsAt` at 131.3 min instead of 118.8 lifts Part III's ρ from 0.456 to **0.817**, within 9% of Part I. The old gate accepted both end times; ρ-consistency plainly prefers the later one. I had taken the last long *silence* as the end of the music, when the largest applause runs — 66 s and 91 s at 131.3 and 132.5 min — mark where the work actually finishes.

**And that rewrites the cut estimate.** ρ ≈ 0.9–1.0 across Parts I and II means those parts are essentially *uncut*; the difference is tempo. Only Part III is genuinely short, by ~18%. So this is a nearly complete performance with a couple of cuts concentrated in Part III — not the eight to twelve omissions inferred earlier from the wrong end time. Any alignment omitting five of Part III's nine numbers is now visibly wrong on arithmetic alone.

### What that gives the cost function

Three terms instead of a range check:

1. **Proportional fit** — a span costs `|actual − ρ·expected| / (ρ·expected)`, a real distance rather than range membership.
2. **Global regularity** — penalise the *variance* of the per-number implied ρ. A correct alignment has consistent ρ; a wrong one scatters. This is the term the first attempt had no analogue of, and it is what turns rejection into selection.
3. **Cumulative monotonicity** — mapping reference cumulative time to ours must be monotonic with near-constant slope between cuts, dropping vertically at each omission. A jagged map is a wrong alignment, whatever its local scores.

## Global Constraints

- `export SCRATCH=/tmp/messiah && mkdir -p "$SCRATCH"` in every shell; agent shells do not persist state.
- `-v error` suppresses `silencedetect` (it logs at info). Always `-hide_banner -nostats … 2>&1 | grep silencedetect`, and `-vn` so 134 min of video is not decoded.
- Artefacts already in `$SCRATCH` from the first run — `messiah.libretto.json`, `silence.txt`, `rms.txt`, `hf.txt`, `applause.json` — are reusable. Do not re-extract.
- The data volume is not under git and `claude` cannot write it: `sudo docker exec daylight-station sh -c "echo '<b64>' | base64 -d > <path> && chown node:node <path>"`.
- **Never widen a prior to make the gate pass.** If the gate fails, report and keep the three-Part sidecar — which is already live and honest.
- Run tests from the worktree root: `npx vitest run cli/`.

---

### Task 1: Read the reference recording's durations

**Files:**
- Modify: `cli/segment-timings.cli.mjs`
- Modify: `cli/segment-timings.cli.test.mjs`

**Interfaces:**
- Produces: `matchReference({ items, tracks })` → `{ expected: Array<number|null>, report: { matched: number, unmatched: string[] } }`, where `expected[i]` is libretto number *i*'s duration in seconds from the reference, or `null` where no track matched.

- [ ] **Step 1: Pull the reference track list**

```bash
curl -s "http://localhost:3111/api/v1/queue/plex:578447" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const q=JSON.parse(d);
      require("fs").writeFileSync("/tmp/messiah/reference.json",
        JSON.stringify(q.items.map(t=>({title:t.title,seconds:Math.round(t.duration)})),null,1));
      console.log(q.items.length,"tracks");})'
```

Expected: `51 tracks`.

- [ ] **Step 2: Write the failing test**

The reference has **51** tracks against the libretto's **53** numbers, so the match is not one-to-one and must not pretend to be. Track titles carry the form and the incipit in one string; the libretto carries them separately.

```js
describe('matchReference', () => {
  const items = [
    { n: 1, form: 'Sinfonia', incipit: 'Sinfonia' },
    { n: 2, form: 'Recitative', incipit: 'Comfort ye, comfort ye my people,' },
    { n: 3, form: 'Air', incipit: "Ev'ry valley shall be exalted," },
  ];
  const tracks = [
    { title: 'Sinfony (Grave -- Allegro moderato)', seconds: 203 },
    { title: 'Accompagnato (Tenor)- Comfort ye my people', seconds: 205 },
    { title: "Air (Tenor)- Ev'ry valley shall be exalted", seconds: 211 },
  ];

  it('matches a libretto number to its reference track by incipit', () => {
    const { expected, report } = matchReference({ items, tracks });
    expect(expected).toEqual([203, 205, 211]);
    expect(report.matched).toBe(3);
  });

  it('leaves a number unmatched rather than guessing at it', () => {
    const { expected, report } = matchReference({
      items: [...items, { n: 4, form: 'Chorus', incipit: 'Something not recorded' }],
      tracks,
    });
    expect(expected[3]).toBeNull();
    expect(report.unmatched).toEqual(['No. 4 Something not recorded']);
  });

  /** The reference's Sinfony is the libretto's Sinfonia — the same movement, spelled differently. */
  it('matches on the distinctive words, not on an exact string', () => {
    const { expected } = matchReference({
      items: [{ n: 1, form: 'Sinfonia', incipit: 'Sinfonia' }],
      tracks: [{ title: 'Sinfony (Grave -- Allegro moderato)', seconds: 203 }],
    });
    expect(expected[0]).toBe(203);
  });
});
```

- [ ] **Step 3: Run it, watch it fail, implement**

Run: `npx vitest run cli/segment-timings.cli.test.mjs -t matchReference` → FAIL (`matchReference is not a function`)

Implement by normalising both sides (lowercase, strip punctuation and the form prefix the track titles carry) and scoring on shared distinctive words, taking the best score above a threshold. Titles are matched, never invented; anything below the threshold stays `null` and is reported.

- [ ] **Step 4: Run it on the real data and read the report**

```bash
node -e '…matchReference({items: libretto, tracks: reference})…'
```

Report `matched` of 53 and the `unmatched` list by name.

**Expect a handful unmatched, and do not force them.** The reference has 51 tracks for 53 numbers, so at least two libretto numbers share a track — most likely a recitative running into its air, and the `15a`/`15b` pair. A number with no reference duration keeps `null` and falls back to its form prior in Task 3.

- [ ] **Step 5: Commit**

```bash
git add cli/segment-timings.cli.mjs cli/segment-timings.cli.test.mjs
git commit -m "feat(cli): per-number durations from a reference recording"
```

---

### Task 2: Measure the cut, instead of estimating it

**Files:** `cli/segment-timings.cli.mjs`, its test.

**Interfaces:**
- Produces: `musicSeconds({ frames, applause, fromS, toS })` → the audible span minus detected applause, in seconds.

- [ ] **Step 1: Write the failing test**

```js
describe('musicSeconds', () => {
  it('subtracts applause from the span, because applause is not music', () => {
    const frames = Array.from({ length: 100 }, (_, t) => ({ t, full: -20, hf: -60 }));
    const applause = [{ start: 40, end: 49 }];      // 10s
    expect(musicSeconds({ frames, applause, fromS: 0, toS: 100 })).toBe(90);
  });

  it('counts only applause that falls inside the span', () => {
    const frames = Array.from({ length: 100 }, (_, t) => ({ t, full: -20, hf: -60 }));
    expect(musicSeconds({ frames, applause: [{ start: 200, end: 240 }], fromS: 0, toS: 100 })).toBe(100);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, implement, watch it pass**

- [ ] **Step 3: Measure the real shortfall and derive the expected omission count**

```
reference music, live (57 chapters)  : 8491 s   (141.5 min)
reference music, studio (51 tracks)  : 8988 s   (149.8 min)
this performance, span minus applause: <measure, from 25s to the corrected end>
shortfall                            : <derive>
```

**Use the corrected end time.** `musicEndsAt` is where the closing ovation *begins* — the 66 s and 91 s applause runs at 131.3 and 132.5 min — not the last long silence at 118.8 min, which is what the first attempt used and what cost Part III twelve minutes.

Then report the shortfall **per Part**, not just globally, because that is where it localises: ρ ≈ 0.9–1.0 for Parts I and II says those are uncut and the difference is tempo, while Part III's ~18% shortfall is one or two real omissions. Sort the reference durations within Part III descending and report how many numbers account for it, as a range.

**This number is an input to Task 4's discrimination test, not a target to hit.** Record it and move on.

- [ ] **Step 4: Commit**

---

### Task 3: Cost an assignment against its own expected duration

**Files:** `cli/segment-timings.cli.mjs`, its test.

**Interfaces:**
- Produces: `spanCost(item, seconds, expectedS)` — a third parameter. When `expectedS` is a number, cost is the *distance* from it; when `null`, the existing form-prior behaviour is kept unchanged.

- [ ] **Step 1: Write the failing test**

```js
describe('spanCost with a per-number expectation', () => {
  const chorus = { form: 'Chorus' };

  it('costs the distance from the expected duration, not a range membership', () => {
    expect(spanCost(chorus, 450, 450)).toBe(0);
    expect(spanCost(chorus, 470, 450)).toBeGreaterThan(0);
    expect(spanCost(chorus, 470, 450)).toBeLessThan(spanCost(chorus, 520, 450));
  });

  /**
   * A LIVE PERFORMANCE IS NOT THE REFERENCE. Tempi differ, repeats differ, and a
   * span 10% from its expectation is an ordinary reading rather than a wrong
   * boundary. The tolerance is proportional, and only outside it does the cost
   * become the implausible one.
   */
  it('tolerates a tempo difference but not a different movement', () => {
    expect(spanCost(chorus, 450 * 1.08, 450)).toBeLessThan(IMPLAUSIBLE_COST);
    expect(spanCost(chorus, 450 * 2.0, 450)).toBeGreaterThan(IMPLAUSIBLE_COST);
  });

  it('falls back to the form prior when the number has no reference duration', () => {
    expect(spanCost(chorus, 200, null)).toBe(0);                     // inside 60-420
    expect(spanCost(chorus, 900, null)).toBeGreaterThan(IMPLAUSIBLE_COST);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, implement**

Thread `expected` through `alignLibretto` and `validateSpans` as a parallel array, exactly as `starts` is. Both must keep working when it is absent, so the first plan's tests stay green — run the whole suite, not just the new tests.

- [ ] **Step 3: Commit**

---

### Task 4: Prove the gate discriminates — before trusting any answer

**This is the task the first plan lacked, and the reason it shipped a wrong alignment past a passing gate.**

**Files:** `cli/segment-timings.cli.test.mjs`, and a reporting script.

- [ ] **Step 1: Write the discrimination test**

```js
/**
 * A GATE THAT ACCEPTS TWO CONTRADICTORY ANSWERS HAS NOT BEEN TESTED, IT HAS
 * BEEN ASKED. The first attempt's gate held for four values of musicEndsAt
 * twelve minutes apart, each producing a different alignment — so passing it
 * carried no information. This asserts the property that was missing: the right
 * input must score MATERIALLY better than a wrong one.
 */
it('scores a correct end time far better than one twelve minutes out', () => {
  const { cost: right } = alignLibretto({ items, candidates, endS: TRUE_END, expected });
  const { cost: wrong } = alignLibretto({ items, candidates, endS: TRUE_END - 720, expected });
  expect(wrong).toBeGreaterThan(right * 2);
});

it('never omits the finale, whose expected duration is the longest in the work', () => {
  const { starts } = alignLibretto({ items, candidates, endS: TRUE_END, expected });
  expect(starts[52], 'the closing chorus and Amen was omitted').not.toBeNull();
});
```

- [ ] **Step 2: Sweep `musicEndsAt` and require a single clear minimum**

Run the alignment across 115–133 min in 30-second steps and plot cost against end time. **Acceptance: one clear minimum**, with the neighbouring values materially worse. A flat curve means the constraint is still too weak and the method has not improved — in which case stop and report, exactly as before.

The sweep has a known answer to check itself against: ρ-consistency across the
three Parts already prefers ~131 min over 118.8, computed from nothing but the
shipped Part boundaries. If the cost curve's minimum disagrees with that, one of
the two is wrong and neither should be trusted until it is understood.

- [ ] **Step 2b: Require the per-number ρ to be consistent**

The global regularity term is the one the first attempt had no analogue of, so
assert it directly rather than trusting it implicitly:

```js
it('produces a consistent tempo ratio across the work, not a scattered one', () => {
  const { starts } = alignLibretto({ items, candidates, endS: TRUE_END, expected });
  const rhos = starts
    .map((s, i) => (s === null ? null : spanOf(starts, i, TRUE_END) / expected[i]))
    .filter((r) => r !== null);
  const mean = rhos.reduce((a, b) => a + b, 0) / rhos.length;
  const spread = Math.sqrt(rhos.reduce((a, r) => a + (r - mean) ** 2, 0) / rhos.length) / mean;
  // The two reference recordings disagree by a median 8%; a correct alignment
  // against ONE of them should not scatter much beyond that.
  expect(spread, `per-number tempo ratios scatter by ${(spread * 100).toFixed(0)}%`)
    .toBeLessThan(0.25);
});
```

A wrong alignment fails this even when every individual span sits inside its
prior, which is precisely the case that got through last time.

- [ ] **Step 3: Sanity-check the omitted list by name**

Print every omitted number. **The finale, the Part Three opening, and the Hallelujah must all be present in the kept set.** A famous number in the omitted list means the alignment is wrong however well it scores — that is what caught the first attempt, and it is cheaper than any other check available.

- [ ] **Step 4: Commit the finding either way**

---

### Task 5: Ship the 53 boundaries, or say why not

- [ ] **Step 1: Write the 53 starts to the sidecar**

Only if Task 4's discrimination test passed *and* the omitted list survived inspection. The corpus work still has three segments, so shipping 53 starts requires the corpus restructure — that is plan 2's job. Write the artefact to `$SCRATCH/messiah.starts.json` and hand it on.

- [ ] **Step 2: If either check failed, stop**

Keep the three-Part sidecar, which is live and honest. Report the sweep, the omitted list, and the cost curve. **A rail that lies about position is worse than a coarse one** — the principle this subsystem is built on, and the reason the first attempt's fallback was the right outcome rather than a disappointment.

---

## What would still be unproven

Even a clean sweep and a sane omitted list leave the boundaries *plausible*, not *verified*. The only thing that closes that gap is listening: three or four spot-checks against the audio, especially either side of a claimed omission. That is cheap, and it is the last step before anyone treats these timings as fact.

---

## EXECUTED — and the result, recorded so nobody repeats it

The metadata half is **done and live**: `messiah-part-1/2/3.yml` carry all 53
numbers (21/23/9) with name, form, voice, scripture and text — forms 53/53,
scripture 51/53, text 51/53, the two gaps being the instrumental Sinfonia and
Pifa. They sit as standalone corpus entries; `messiah.yml` is deliberately NOT
pointed at them yet, because 53 segments against 3 starts would break the rail.

The timing half **refuses, and the bottleneck is now measured rather than
guessed: it is candidate detection, not scoring.**

**Per-number priors did not rescue the gate.** Sweeping `musicEndsAt` across
116–133 min gave costs of 1079–1367 — a 26% spread, non-monotonic, a flat curve
— while keeping only 26–28 of 53 numbers at *every* end time, which contradicts
the ρ evidence that Parts I and II are essentially uncut.

**ρ-prediction with a ±30 s snap window, tried next, gave the clearest reading
of all.** Per-Part ratios fit consistently — **0.907 / 1.014 / 0.935**, within
11% of each other — and predictions were checked against detected candidates:

| window | snapped | median offset |
|---|---|---|
| ±10 s | 12/53 | 6 s |
| ±30 s | **20/53** | 9 s |
| ±60 s | 31/53 | 21 s |

Two things follow, and they point opposite ways. **The prediction is good** — a
median 9 s error inside movements averaging 140 s is ~6%, and the 20 hits are
spread across all three Parts (9/21, 8/23, 3/9) rather than clustered, so the
model holds over the whole work. **But the candidates are not there.** Loosening
detection to −45 dB / 0.25 s yields 165 silences against 142 — 16% more, not the
2–3× required. Those boundaries are not in the audio *as silences*: the
movements run attacca or with sub-threshold gaps.

**And partial timings cannot ship.** With ~20 of 53 numbers timed, the store's
positional-null semantics let the previous segment absorb the gap, so a single
label would be drawn over up to three consecutive movements — the rail printing
one name while several sound. That is precisely the rail-that-lies the design
refuses, so "ship what we have" is not available.

### What the next attempt must do differently

Not another scoring function. **Detect boundaries by texture rather than by
silence** — the plan's leg 2, never implemented — using the ρ-predicted times to
say *where to look*: a ±30 s window around each of the 33 unconfirmed
predictions is a small, well-posed search for a spectral change, not a sweep of
134 minutes. The prediction accuracy measured here (median 9 s) is what makes
that search tractable.

Before any of that, the cheapest check remains unrun and would settle more than
another inference pass: **listen at four or five predicted boundaries.** If they
land, the model is confirmed and texture detection is worth building. If they
drift, nothing downstream of ρ is worth building at all.

### Texture detection was built, and it does not work

Four bands (0–300, 300–1200, 1200–4000, 4000+ Hz) at one-second resolution,
normalised to shares of total power so loudness cannot register as texture, with
novelty measured as total-variation distance between the mean profile either
side of a second. 11 unit tests; `cli/texture.cli.mjs`.

**Calibrated against held-out ground truth** — the 20 boundaries silence already
found and ρ corroborated — and it fails the only test that matters:

| | |
|---|---|
| ground-truth points | 20 |
| detector returned a peak | 9 |
| landed within 5 s of the true boundary | **2 of 9 (22%)** |
| random chance in a 61 s window | **18%** |
| error median / p75 / max | 10 s / 32 s / 40 s |

Indistinguishable from guessing. A first calibration reported "1.81× the median
random second" and looked encouraging, but that threshold was invented and the
distribution underneath contradicted it: median novelty at a boundary (0.146)
sits *below* the random 90th percentile (0.196), so any threshold catching the
median boundary also catches a tenth of all seconds — about six false peaks per
window.

**Why it is too crude.** Four bands at one-second frames is a very coarse timbre
descriptor. Movement boundaries in this repertoire often join textures that share
a spectral envelope — a solo air into a chorus keeps the same orchestra — so the
distinguishing information is in finer spectral structure and in onset patterns,
neither of which four one-second bands can represent. A real attempt would need
MFCC or chroma features at ~10 Hz framing, which is a signal-processing project
rather than an ffmpeg pass.

### Four methods, four measured failures — the state to hand on

1. **Per-form duration priors.** Gate held for four end times twelve minutes apart. Rejects; does not select.
2. **Per-number priors from two reference recordings.** Flat cost curve, 26% spread, kept 26–28 of 53 at every end time.
3. **ρ-prediction with a snap window.** Prediction good (median 9 s error, spread across all three Parts) but only 20 of 53 boundaries have a candidate to snap to.
4. **Texture detection.** Does not localise: 22% vs 18% chance.

The through-line is consistent and now well evidenced: **the boundaries are not
recoverable from this recording's audio by any of these means, because a third of
them leave no acoustic trace at one-second resolution.** The tempo model is
sound; the detection is not.

**Do not attempt a fifth inference method without new information.** The cheapest
new information remains a human listening at four or five ρ-predicted times —
that would confirm or kill the tempo model directly, and it is the one input none
of these four attempts had.
