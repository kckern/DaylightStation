# Surround Rail — Get It Right Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Take the Surround chrome from 31 failing tests and a half-merged design to a green suite with every deliberate behaviour change written down as a test.

**Architecture:** Three days of rail redesign landed as `1aca4d967`, then merged with `574abfd69` from another session. The merge combined two independent rewrites of `lyrics.js` and reversed one shipped contract without updating the tests that documented it. Separately, `railGroups` grew a field, a legacy module alias came back, and `band.measure.test.jsx` still queries testids that the `libretto` → `script-rail` rename (`ddc165a95`) deleted. This plan clears each of those, then closes the design defects the frontend-design critique found and nobody has acted on.

**Tech Stack:** React 18, SCSS (sass-embedded), Vitest + Testing Library (happy-dom), Playwright for measured layout specs.

---

## Before you start

**Working tree:** `main`, with uncommitted changes in `modules/SegmentMap.{jsx,scss,test.jsx}` (the fold room-gate, finished and green). Task 1 commits them.

**Worktree:** this plan was not written in a dedicated worktree. If you want isolation, create one before Task 2 — @superpowers:using-git-worktrees. Do NOT start a second backend for any of this; nothing here needs a running app (see `CLAUDE.local.md`).

**All paths below are relative to the repo root.** The Surround module lives at `frontend/src/modules/Surround/`.

**Baseline, measured 2026-08-20:**

```
npx vitest run frontend/src/modules/Surround/
→ 31 failed | 908 passed | 2 expected fail (941)
```

Broken down by file, with the cause:

| File | Fails | Cause |
|---|---|---|
| `band.measure.test.jsx` | 11 | Queries `surround-libretto-*` testids deleted by the rename |
| `band.test.js` | 7 | `railGroups` gained a `mini` field; `toEqual` is exact |
| `modules/SegmentMap.test.jsx` | 5 | Composed-rail group labels + a missing `text-overflow` |
| `lyrics.test.js` | 4 | The activation contract was reversed by `574abfd69` |
| `LyricRail.test.jsx` | 2 | Same reversal |
| `registry.test.js` | 1 | `libretto` came back as a legacy alias (8 → 9 names) |
| `density.test.js` | 1 | A fold no longer claims more than a chip |

---

## Open decisions — get answers BEFORE Task 3

These change what the tasks do. Do not guess; ask KC.

**D1 — Does the lyric rail stay up through an instrumental number?**
`574abfd69` reversed it: an instrumental (Sinfonia, Pifa) now returns `dormant` and the programme rail slides back in. The commit message says that is intended. But `LYRIC_GRACE_S` and its whole comment exist to stop the layout flapping, and Handel's Pifa is ninety seconds between two texted numbers — the rails will now slide out and back for it.
*Recommendation:* keep the new behaviour (it is newer and deliberate) but restore the grace window for gaps SHORTER than `LYRIC_GRACE_S`, so a four-second pause between two texted numbers does not slide the whole frame twice. That is the anti-flap case; the ninety-second Pifa is not.
*Affects:* Task 3.

**D2 — How tall should the part-label row be?**
Measured: the label row is `--group-row: 1.2rem` = 19px. Click-to-seek targets are 702×19px. Raising `--group-row` grows the band's `min-height` and shrinks the video.
*Affects:* Task 10.

**D3 — Should a part label seek ACROSS media items?**
On a season rail (Chopin's opus runs are three separate Plex items) `mediaStart` is the segment's offset inside its OWN file, and the seek handler sets `currentTime` on the element that is playing. Clicking Op. 10 while Op. 25 plays seeks the current file. Cross-item navigation is a player-queue capability the band does not have.
*Affects:* Task 11. If the answer is "leave it", Task 11 becomes "make the label inert across items rather than wrong".

**D4 — Is the fold's room threshold right at the 1280 root?**
`SEGMENT_CHIP_FLOOR_PX * 2` = 48px per segment. Chopin's 24 études get ~52px at 1920 (stays open, which is what KC asked for) but ~34px at 1280 (still folds).
*Affects:* Task 1 — nothing to do unless the answer is "lower it".

**D5 — Who owns `subheading:` and `heading:`?**
The band's NOW register prints `label:` AND `subheading · heading`; the script rail prints `heading` and `subheading`. Two of the three fields are on screen twice.
*Recommendation:* band keeps `label:`, rail keeps `heading`/`subheading`, `n:` stays the one deliberate overlap.
*Affects:* Task 12.

---

## Task 1: Land the in-flight fold room-gate

Already written and green. This just gets it out of the working tree so every later task starts clean.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx`
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss`
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

**Step 1: Confirm it is green**

```bash
npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx
```

Expected: `5 failed | 118 passed`. The 5 are the composed-rail failures Task 8 owns — check the names match the table above before continuing. If any test with "the fold" in its name fails, STOP and fix that first.

**Step 2: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx \
        frontend/src/modules/Surround/modules/SegmentMap.scss \
        frontend/src/modules/Surround/modules/SegmentMap.test.jsx
git commit -m "$(cat <<'EOF'
fix(surround): a fold is a concession to a crowded rule, not a house style

railFolds collapsed every non-sounding titled run unconditionally. Chopin's
Etudes is what showed it up: two opus runs at ~52px a segment on the office
screen, and the band still hatched Op. 10 away and printed "12" where twelve
etudes had room to be twelve marks.

Gated on foldsForRoom: fold only when the rule cannot give every AUTHORED
segment twice the chip floor. Measured on placedRail and the rule's own width,
neither downstream of the fold — a test reading the drawn rail would fold,
measure the folded rail as roomy, and unfold.

The fold tests all encoded unconditional folding on a rail with room, so the
block's measured geometry is halved (RAIL 1000 -> 500, labels 90 -> 45): every
ratio the width and density assertions read is preserved and the rail is
genuinely crowded. One assertion relaxed: under chips the sounding segment
takes the lion's share of what the folds gave back rather than three segments
splitting it evenly, so a flat `> 25%` floor became "wider than the elision
that paid for it".

Also: the group labels stretch to fill their row, so click-to-seek is the whole
area above a run rather than the text's 16px line box.
EOF
)"
```

---

## Task 2: Re-baseline and record it

**Step 1: Run the suite**

```bash
npx vitest run frontend/src/modules/Surround/ 2>&1 | tail -5
```

**Step 2: Write the count into the plan's progress log**

Append to the bottom of this file under `## Progress`. Every later task compares against this number and must never raise it.

---

## Task 3: Resolve the lyric-rail activation contract

**Blocked on D1.** Steps below assume the recommended answer: instrumentals hand back the screen, short gaps still hold.

**Files:**
- Modify: `frontend/src/modules/Surround/lyrics.js:165-190`
- Test: `frontend/src/modules/Surround/lyrics.test.js`
- Test: `frontend/src/modules/Surround/LyricRail.test.jsx`

**Step 1: Read what the merge actually left**

```bash
git show 574abfd69 -- frontend/src/modules/Surround/lyrics.js
sed -n '150,195p' frontend/src/modules/Surround/lyrics.js
```

You are looking at `lyricStateAt`. Note that `574abfd69` deleted the `LYRIC_GRACE_S` branch entirely, so `LYRIC_GRACE_S` may now be an unused export. Check before deleting it — `SurroundFrame.jsx` reads it too:

```bash
grep -rn "LYRIC_GRACE_S" frontend/src/modules/Surround/
```

**Step 2: Write the failing tests for the settled contract**

In `lyrics.test.js`, replace the two tests named `stays up through an instrumental number, showing no text` and `holds through a gap shorter than the grace window` with:

```javascript
  /**
   * AN INSTRUMENTAL NUMBER HANDS THE SCREEN BACK. The Sinfonia and the Pifa
   * have no words, and a lyric rail with no lyric is a mat with nothing in it.
   * The programme rail slides back in and says what is sounding instead.
   *
   * TO GO RED: return `active: true` with empty text for a sounding segment
   * that authored none, as every version before 574abfd69 did.
   */
  it('hands the screen back on an instrumental number', () => {
    const s = at(125);
    expect(s.active).toBe(false);
    expect(s.text).toBe('');
  });

  /**
   * ...BUT A SHORT GAP STILL HOLDS. The rails travel; between two texted
   * numbers four seconds apart, sliding out and back is the flap the grace
   * window exists to prevent. Ninety seconds of Pifa is not that case, which
   * is why the two rules do not contradict each other.
   */
  it('holds through a gap shorter than the grace window', () => {
    expect(at(40 + (LYRIC_GRACE_S - 10)).active).toBe(true);
  });
```

Then fix the two tests that assumed a sounding index during an instrumental:

- `promotes a lone subheading into the header` — its fixture (`label: Sinfonia`, `subheading: Sinfonia`, `text: ''`) is now dormant. Give the fixture a `text:` so the promotion rule is still exercised, and move the "no text at all" case into the instrumental test above.
- `reports the sounding index so a caller can key a transition on it` — `at(125)` is the Pifa and now returns `-1`. Change the second assertion to the third segment: `expect(at(140).index).toBe(2);`

In `LyricRail.test.jsx`, the test named `stays up through an instrumental number, and prints no text box` asserts the rail is present and the heading reads `Pifa`. Under the settled contract the rail is NOT present. Rewrite it:

```javascript
  it('hands the column back to the programme on an instrumental number', () => {
    const { container } = draw(withLyric, RAIL, 125);
    expect(container.querySelector('.surround-frame').className)
      .not.toContain('surround-frame--lyric');
    expect(screen.getByTestId('surround-rail')).not.toHaveAttribute('aria-hidden');
  });
```

**Step 3: Run them and watch them fail**

```bash
npx vitest run frontend/src/modules/Surround/lyrics.test.js frontend/src/modules/Surround/LyricRail.test.jsx
```

Expected: the grace-window test fails (`expected false to be true`); the instrumental tests pass already.

**Step 4: Restore the grace branch in `lyrics.js`**

Put back the gap branch that `574abfd69` deleted, immediately before the final `return dormant`:

```javascript
  // Nothing is sounding. An instrumental number has already returned dormant
  // above — this is a real GAP, between numbers or at a Part break, and only
  // its LENGTH decides. A short one holds the layout still; the rails travel,
  // and sliding them out and back for four seconds of silence between two
  // texted numbers is the flap this window exists to prevent.
  if (pos - lastEnd <= LYRIC_GRACE_S) {
    return { active: true, text: '', heading: '', subheading: '', index: -1 };
  }
  return dormant;
```

**Step 5: Run to green**

```bash
npx vitest run frontend/src/modules/Surround/lyrics.test.js frontend/src/modules/Surround/LyricRail.test.jsx
```

Expected: PASS, both files.

**Step 6: Commit**

```bash
git add frontend/src/modules/Surround/lyrics.js \
        frontend/src/modules/Surround/lyrics.test.js \
        frontend/src/modules/Surround/LyricRail.test.jsx
git commit -m "fix(surround): settle the lyric rail's activation contract

An instrumental number hands the screen back (574abfd69's rule, kept) but a
SHORT GAP still holds the layout still (the grace window, restored). The two
are not in tension: ninety seconds of Pifa is a different case from four
seconds between two texted numbers, and only the second is a flap.

The four tests that documented the old contract are rewritten rather than
deleted — the reversal was deliberate and now says so in a test."
```

---

## Task 4: `railGroups` grew a `mini` field

**Files:**
- Test: `frontend/src/modules/Surround/band.test.js`

**Step 1: See what the field is and where it comes from**

```bash
npx vitest run frontend/src/modules/Surround/band.test.js 2>&1 | grep -A 25 "gives one entry per consecutive run"
grep -n "mini" frontend/src/modules/Surround/band.js
```

`mini` is the group's short designation, used by `SegmentMap` when the full title will not fit. It is a real addition, so the tests are what is stale.

**Step 2: Decide `toEqual` vs `toMatchObject` — deliberately**

Do NOT blanket-swap to `toMatchObject`. `toEqual` on a shape is what caught this in the first place, and softening it means the next added field lands silently. Add `mini` to the expected literals instead. Only where a test is genuinely about ONE property (the "at depth" three) is `toMatchObject` the honest call.

**Step 3: Update the four `railGroups` expectations**

Each expected object gains `mini: null` (or the authored short form where the fixture has one). Run after each file edit:

```bash
npx vitest run frontend/src/modules/Surround/band.test.js
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Surround/band.test.js
git commit -m "test(surround): railGroups carries a mini designation now

The four shape assertions are exact on purpose — an added field SHOULD break
them. Adding `mini` to the literals keeps that; softening them to
toMatchObject would have let the next one land silently."
```

---

## Task 5: `registry.test.js` — the legacy alias came back

**Files:**
- Test: `frontend/src/modules/Surround/registry.test.js:100-110`

**Step 1: Confirm what changed**

```bash
grep -n "LEGACY_MODULE_ALIASES" frontend/src/modules/Surround/builtins.js
```

You should see `{ 'movement-map': 'segment-map', 'libretto': 'script-rail' }`. Both aliases resolve to real modules; there is no `Libretto.jsx`. Nine resolvable names is correct.

**Step 2: Add `'libretto'` to the expected list, with a comment saying why**

```javascript
        // Both legacy names resolve — `movement-map` and `libretto` are
        // ALIASES (see LEGACY_MODULE_ALIASES), kept so a cached definition
        // written before either rename still mounts. They are resolvable
        // names, not modules: there is no Libretto.jsx.
        'composer-card', 'country-map', 'cue-ticker', 'libretto', 'movement-map',
        'place-carousel', 'script-rail', 'segment-map', 'work-placard',
```

**Step 3: Run and commit**

```bash
npx vitest run frontend/src/modules/Surround/registry.test.js
git add frontend/src/modules/Surround/registry.test.js
git commit -m "test(surround): libretto is a resolvable alias, not a ninth module"
```

---

## Task 6: `density.test.js` — a fold no longer outgrows a chip

This one may be a REAL regression, not a stale test. Diagnose before touching either side.

**Files:**
- Read: `frontend/src/modules/Surround/band.js` — `densityShares`, around line 313
- Test: `frontend/src/modules/Surround/density.test.js:40-52`

**Step 1: Reproduce and read the claim**

```bash
npx vitest run frontend/src/modules/Surround/density.test.js -t "PARENT TITLE"
```

Expected: `expected 0.24242424242424243 to be greater than 0.24242424242424243` — the fold and the chip beside it come out exactly equal.

**Step 2: Find out which side is wrong**

In `densityShares` the fold's claim is `Math.max(foldPx, chip)` where `foldPx = Number(foldMinPx) || 0`. The test does not pass `foldMinPx`, so the fold claims exactly `chip` and the assertion is unsatisfiable.

Two possibilities, and they need different fixes:

- **The test is stale.** `foldMinPx` is now supplied by the caller (`SegmentMap.jsx` computes it from the measured label and badge), so a test that omits it is describing a call that never happens. Fix: pass `foldMinPx: 190` in the fixture and keep the assertion.
- **`densityShares` regressed.** If it once derived the fold's width from `needs[i]` when `foldMinPx` was absent, that fallback is gone. Fix: restore the fallback.

Check with:

```bash
git log -p --follow -S 'foldMinPx' -- frontend/src/modules/Surround/band.js | head -80
```

**Step 3: Apply whichever the history says, run, commit.**

Whichever you pick, the commit message must say which of the two it was and how you decided — this is exactly the kind of failure that gets "fixed" by editing the assertion.

---

## Task 7: `band.measure.test.jsx` — the stale rename (biggest, 11 fails)

`ddc165a95` renamed the libretto rail to `script-rail` and changed every testid from `surround-libretto-*` to `surround-script-rail-*`. This measured spec was not updated. It is also the ONLY spec that runs a real layout engine over the rail, so it is the one that can catch the things unit tests cannot — it is worth repairing rather than deleting.

**Files:**
- Test: `frontend/src/modules/Surround/band.measure.test.jsx` (the `describe('the lyric rail, measured')` block, ~line 2905 onward)

**Step 1: See the scale of it**

```bash
grep -n "libretto" frontend/src/modules/Surround/band.measure.test.jsx
```

**Step 2: Rename the module and the testids**

- `{ module: 'libretto' }` → `{ module: 'script-rail' }` in the `SUNG` fixture
- `surround-libretto` → `surround-script-rail`
- `surround-libretto-text` → `surround-script-rail-text`
- `surround-libretto-heading` → `surround-script-rail-heading`
- `surround-libretto-plate` → `surround-script-rail-plate`

**Step 3: Run it and expect NEW failures, not zero**

```bash
npx vitest run frontend/src/modules/Surround/band.measure.test.jsx -t "the lyric rail, measured"
```

The rename alone will not make it pass, because the rail's LAYOUT changed underneath it (`1aca4d967`): the verse is at the top now, the programme is a footer, and the plate has no rule above it. In particular `expect(b.text.h + b.heading.h).toBeLessThanOrEqual(b.panel.h + 1)` no longer describes the box order.

**Step 4: Rewrite the geometry assertions against the CURRENT anatomy**

The rail is now, top to bottom: `__billing` (h2 + subheading) → `__text` → `__programme` → `__plate`. Assert:

- the verse still gets real height (`b.text.h > 80`) — this is the collapsed-box regression the block exists for
- the billing sits ABOVE the verse: `b.billing.t < b.text.t`
- the programme sits BELOW it: `b.programme.t > b.text.t`
- nothing overflows: `b.text.h + b.billing.h + b.programme.h <= b.panel.h + 1`

Add `billing: r(pick('.surround-script-rail__billing'))` and `programme: r(pick('.surround-script-rail__programme'))` to the `boxes()` evaluator.

**Step 5: Green, then commit**

```bash
npx vitest run frontend/src/modules/Surround/band.measure.test.jsx
```

Expected: 0 failed, 2 expected-fail (the corner-plate harness gap is `it.fails` and stays that way).

```bash
git add frontend/src/modules/Surround/band.measure.test.jsx
git commit -m "test(surround): the measured lyric-rail spec follows the rename and the reorder

It has been red since ddc165a95 renamed the module and its testids, and it is
the only spec that runs a real layout engine over this rail — so the geometry
assertions are rewritten against the current anatomy (billing, verse,
programme, plate) rather than deleted."
```

---

## Task 8: `SegmentMap.test.jsx` — the five composed-rail failures

**Files:**
- Test: `frontend/src/modules/Surround/modules/SegmentMap.test.jsx`
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss`

**Step 1: List them**

```bash
npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx 2>&1 | grep -E "FAIL|AssertionError"
```

Four are about group labels and short labels coming back empty/null; one is:

```
a heading with no ellipsis is a heading cut mid-word:
expected '.surround-segment-map__group {…' to match /text-overflow:\s*ellipsis/
```

**Step 2: Fix the ellipsis one FIRST — it is a real product bug**

`.surround-segment-map__group` has `white-space: nowrap; overflow: hidden;` and no `text-overflow`. A long set title is cut mid-word rather than ellipsized, which is the thing the frame's own law forbids.

**Careful:** Task 1 made `.__group` `display: flex` so the label fills its row as a seek target. `text-overflow` does not apply to a flex container's anonymous text child. Fix by wrapping the label text in an inner span in the JSX and putting `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` on THAT, or by reverting `.__group` to a block and stretching it another way. Whichever you pick, re-run the probe measurement test — `.__group` doubles as a ruler and the probe block overrides its `display`.

**Step 3: Diagnose the remaining four before editing them**

They report `['', '']` where `['Part One', 'Part Two']` is expected, and `[null × 6]` where short labels are expected. That is a label-resolution path returning empty, not a formatting difference. It is likely the same `mini`/designation change Task 4 found. Read `partDesignation` and the `metrics.labels` lookup at `SegmentMap.jsx:1300-1330` before assuming the tests are stale.

**Step 4: Run, commit.** Separate commits for the ellipsis fix (product) and the label fixes.

---

## Task 9: The whole suite is green

**Step 1:**

```bash
npx vitest run frontend/src/modules/Surround/
```

Expected: `0 failed | 941 passed | 2 expected fail`.

**Step 2: Also run the suites that import from Surround**

```bash
npx vitest run frontend/src/modules/
```

**Step 3: Commit any straggler, then tag the milestone in the progress log.**

Everything below this line is design work, not repair. It is safe to stop here and ship.

---

## Task 10: The part-label row's height

**Blocked on D2.** If the answer is "leave it", skip.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss:121` (`--group-row`)

Note `--group-row` also feeds `min-height: calc(3.9rem + var(--group-rows))` on the band, and a two-level work uses `calc(var(--group-row) * 2)`. Raising it makes the band taller and the video smaller on every screen. Verify with the Playwright harness, not by eye:

```bash
# scratch harness pattern: see _deleteme/_scratch.band.test.jsx for a working
# SSR + compiled-SCSS + elementFromPoint rig
```

---

## Task 11: Cross-item seek

**Blocked on D3.** If the answer is "leave it", the task is to make a cross-item label INERT rather than wrong — clicking Op. 10 while Op. 25 plays currently seeks the playing file to 0, which is worse than doing nothing.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx:1316,1371` (the two group-label `onClick`s)
- Read: `frontend/src/modules/Surround/SurroundHost.jsx:135-145` (the `surround-seek` handler)

**The inert version:**

```javascript
// A SEASON'S RUNS ARE SEPARATE MEDIA ITEMS. `mediaStart` is an offset inside a
// segment's OWN file and the handler sets `currentTime` on the element that is
// playing, so seeking to another opus's label would move the WRONG recording.
// Cross-item navigation is a player-queue capability the band does not have —
// until it does, a label that cannot be reached does nothing rather than
// something wrong.
const target = segments[group.from];
const reachable = !target?.contentId || target.contentId === contentId;
```

...and gate both the `onClick` and the `--clickable` class on `reachable`, so the cursor stops promising something that cannot happen.

Test in `SegmentMap.test.jsx`: a season fixture with two contentIds; assert the label for the OTHER item has no `--clickable` class and dispatches no `surround-seek`.

---

## Task 12: The band and the rail print the same fields

**Blocked on D5.** Recommended split: band keeps `label:`, rail keeps `heading`/`subheading`.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/CueTicker.jsx:816-830`
- Test: `frontend/src/modules/Surround/modules/CueTicker.test.jsx`
- Docs: `docs/reference/player/surround/classical/README.md` — the four-fields table says the NOW register sets `subheading · heading`. If that changes, the table changes in the same commit.

---

## Task 13: The brass plate is the loudest object in the frame

Found by the design critique, never acted on. The nameplate is a high-luminance, high-chroma yellow in a field where every other surface sits on a ramp of L\* 2.9–15.2. At ten feet the eye reaches the composer's name before the sung words, which inverts the rail's own priority.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/ComposerCard.scss`

**Step 1:** knock the brass down ~25–30% in luminance and pull the yellow toward aged brass (roughly `#EDD9A8` → `#C4A96F`).
**Step 2:** verify with a screenshot at all three fleet roots, not by eye on one.
**Step 3:** in the same pass, two smaller ones from the same critique:
- the portrait crop cuts mid-torso on a coat button — bias `object-position` to about `center 25%` so the crop favours the face
- `Halle` is orphaned under the plate at 0.82rem with no relationship to anything; either put it on the brass beside the dates or drop it from the `plate` variant

---

## Progress

Append one line per task as you finish it: task number, the suite count after it, and the commit sha.

```
Task 1 — 31 failed (unchanged; the gate was already green) — <sha>
```
