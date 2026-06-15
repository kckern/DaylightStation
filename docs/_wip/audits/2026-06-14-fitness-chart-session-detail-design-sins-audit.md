# Fitness Session-Detail Chart — Design Sins Audit

**Date:** 2026-06-14
**Reviewer:** Senior design review (ornery mode, fully engaged)
**Subject:** `frontend/src/modules/Fitness/widgets/FitnessChart/` and the composed session-detail view it lives in
**Specimen:** `https://daylightlocal.kckern.net/fitness/home/session-20260612180809`

---

## The session under glass (so we're arguing about real data, not vibes)

Pulled live from `GET /api/v1/fitness/sessions/20260612180809`:

| Field | Value |
|---|---|
| Date / time | Fri 2026-06-12, 18:08 → 18:50 (**42.3 min**) |
| Duration | 510 ticks × 5s |
| Participants | 5 — kckern, milo, felix, soren, alan |
| **Final coins** | **KC Kern 431**, **Milo 382**, **Felix 382 (TIE)**, Alan 99, Soren 42 |
| Total coins | 1336 |
| Events | 15 → 1 media (Daytona USA 2001), 13 challenges (warm×9, hot×1, active×1, cycle×1), 1 voice memo |
| Group session? | No (`isGroup` unset, 0 seams, 0 activities) |

The single most important fact the design fails to communicate: **Milo and Felix tied at 382.** That tie is *the story of the race* and the chart actively hides it (see Sin #4). Hold that thought.

---

## Verdict

This is an information-dense chart fighting four other UIs for the same pixels, and losing. The underlying data viz idea — a coin-accumulation race with avatars riding the leading edge — is good. The execution is a margin-clipping, layer-overlapping, four-colors-for-everything pile-up. I counted **eighteen** distinct sins. They sort into five buckets: **margins & clipping**, **overlap & collision**, **the gutter / vertical-line forest**, **color & encoding**, and **the orphaned HR lanes**.

Severity legend: 🔴 breaks comprehension · 🟠 actively ugly / misleading · 🟡 polish debt.

---

## Bucket A — Margins & clipping (labels dying in the gutters)

### 🔴 Sin 1 — The top margin is 10px and the avatars are 60px. Everything clips.
`chartConstants.js`: `CHART_MARGIN = { top: 10, ... }`. `FitnessChart.jsx:27`: `AVATAR_RADIUS = 30` → a 60px avatar (plus a `+6` backdrop ring → 72px) at a value near the top of the scale gets its head and its value label guillotined by the viewBox edge. In the specimen you can see the leader cluster's "382" label rendered as a clipped **"38Z"** sliver against the top edge. A chart whose hero elements don't fit inside the chart is not finished.
**Fix:** top margin must clear `AVATAR_RADIUS + backdrop + labelFontSize` (≈ 30+6+20). Set `top: 44`, or clamp avatar Y so the glyph + label box stays inside `[top+r, bottom-r]`.

### 🟠 Sin 2 — The LOG toggle and the focus legend are dumped *on top of the plot*, top-left.
`FitnessChart.scss:51` `.race-chart__scale-toggle { position:absolute; top:1.5rem; left:2.5rem }` and `:78` `.race-chart__focus-filter { position:absolute; top:3.5rem; left:2.5rem }`. Both float over the plotting area at the exact spot where every participant's line *starts and climbs* (0:00–10:15). So the controls sit on top of the data, and the data climbs through the controls. In the specimen the "LOG" pill overlaps the 433 gridline and the Alan/Felix/KC/Milo/Soren legend sits squarely over the rising curves.
**Fix:** these are chrome, not data. Give them a reserved rail (left margin gutter or a header strip), or move the legend out of the SVG entirely into the panel header. Absolute-positioning UI over a live plot is how you get a chart you can't read.

### 🟠 Sin 3 — Y-axis labels are nonsense numbers.
`FitnessChart.jsx:1242` `label: value.toFixed(0)` over a power/log-warped domain produces ticks like **42, 172, 303, 433**. Those aren't human gridlines, they're whatever the scale function spat out. A coin axis should read 0 / 100 / 200 / 300 / 400, or be labeled in "nice" increments (d3's `.ticks()` / `niceNum`). Right now the axis tells the user nothing they can anchor to.
**Fix:** compute round ticks independent of the warp; place them at their warped Y. Label the axis ("coins") — see Sin 13.

---

## Bucket B — Overlap & collision (the avatar pile-up)

### 🔴 Sin 4 — Tied participants stack into an unreadable blob, and the layout manager makes it worse.
Milo and Felix both finished at **382**. Same X (end of race), same Y (same coins) → two 60px avatars on top of each other, one "382" label clipped behind the other, a stray connector stub linking them, and a *third* avatar (the 382-vs-431 cluster) jammed alongside. The `LayoutManager` (`layout/LayoutManager.js`, `maxDisplacement:100`) shoves them apart but the result reads as a car crash, not a podium. This is the climax of the race rendered as visual noise.
**Fix:** ties need an intentional treatment — a shared rung with both faces in a small horizontal cluster *and a "T1" / "=" affordance*, or a tiny vertical fan with a single shared value label. The current "displace and pray" loses the one fact that matters.

### 🟠 Sin 5 — Three avatar sizes, no hierarchy logic.
Legend avatars 20px (`.race-chart__focus-filter-avatar`), dropout badges 20px diameter (`ABSENT_BADGE_RADIUS = 10`), leading-edge avatars 60px (`AVATAR_RADIUS = 30`). Three sizes that don't encode anything — they're just whatever each subsystem happened to pick. Size should mean something (leader bigger? recency?) or be consistent.

### 🟠 Sin 6 — Mid-plot avatars collide with axis labels.
Alan (99) and Soren (42) sit mid-chart. Soren's avatar + its white "42" label land right on top of the **42** y-gridline label on the left axis — two different "42"s, one a coin value, one an axis tick, occupying the same neighborhood. Pure collision, pure confusion.

### 🟡 Sin 7 — Value labels are duplicated and detached.
The leader value renders both as an in-plot white number *and* beside the avatar; "431" floats far to the right, disconnected from its cluster by the `right:90` margin reserve. One value, one label, anchored to its avatar.

---

## Bucket C — The gutter & the vertical-line forest

### 🔴 Sin 8 — Thirteen full-height vertical lines shred all three layers.
This is the "center gutter breaking the vertical areas" the brief called out, and it's worse than described. Challenge/video markers are drawn **full height** in three separate components that all agree to cut top-to-bottom:
- `FitnessChart.jsx:598` challenge end line `y2={height}`; `:606` video line through the axis strip;
- `MarkerGutter.jsx:26-37` redraws the *same* lines `y1={0} y2={height}` across the gutter band;
- the HR lanes below inherit the same cuts.

13 events → ~13 vertical slashes (each a 3.5px black + 1.5px colored double-stroke) running through the line chart, the gutter, and the HR lanes. The result is a barcode. The *data* (smooth coin curves, HR area fills) becomes the background; the *annotations* become the foreground. That's backwards.
**Fix:** annotations are reference, not subject. Make them whisper — single hairline, ≤30% opacity, or confine them to the gutter band only and let ticks/badges carry the signal into the chart. Do not draw the same line three times at full strength.

### 🟠 Sin 9 — The challenge badge row is a crowded, low-information ribbon.
`FitnessChart.jsx:795-810`: 13 colored circles (r=11, so 22px) crammed along the top, collision-resolved to `minGap:24` (`:1295`) — i.e. they're touching. Of the 13, **nine are identical "Warm / 1"** badges. We're spending a dense ribbon of top-row real estate to say "warm challenge, warm challenge, warm challenge…". Repetition without aggregation is noise.
**Fix:** dedupe/cluster repeated adjacent challenges, or summarize ("9 warm, 1 hot, 1 active"). Reserve individual badges for the ones that differ.

### 🟡 Sin 10 — Challenge duration fills are invisible and inconsistent.
`FitnessChart.jsx:594` whisper fill at `opacity 0.05`, `MarkerGutter.jsx:25` at `0.06`. At those opacities on a dark ground they read as smudges, and the two components use *different* opacities for the *same* concept. Either commit to a visible band or drop the fill and keep the edge line.

---

## Bucket D — Color & encoding (four colors, five jobs)

### 🔴 Sin 11 — Everything is the same four zone colors, so nothing is distinguishable.
Green / blue / gold / orange (the HR zone palette) is doing **five** simultaneous jobs:
1. participant line color (`entry.zoneColor`, `FitnessChart.jsx:157`),
2. avatar ring color (`:777`),
3. challenge badge color (`getChallengeMarkerColor`),
4. HR-lane area fill color,
5. challenge band tint.

Consequence: in the 10:15–30:45 band all five participants' lines are the same green/blue mush — you cannot trace one rider. Color encodes *zone*, not *identity*, yet it's the only thing distinguishing lines. Identity has no stable channel.
**Fix:** pick one channel for identity (a per-participant hue, or avatar-anchored line tint) and a *different* channel for zone (the HR lanes already separate by row — let zone live there). Don't make one palette mean five things.

### 🟡 Sin 12 — Name casing is incoherent at the source and papered over in the UI.
Data has `display_name` as "KC Kern" but "milo / felix / soren / alan" (lowercase). The legend Title-Cases them for display, so the UI looks fine but the data model is inconsistent and any non-capitalizing surface (logs, exports, the HR lanes which show raw avatars only) will leak the lowercase. Fix the data, not just the one view that hides it.

### 🟡 Sin 13 — The chart never says what it's measuring.
No axis title, no unit. The Y axis is coins (0→433), the header says "🪙 1336" (the *sum*), and nothing connects "433 on this axis" to "1336 in the header." A first-time viewer cannot tell the vertical axis is coins, nor why the top number (433) ≠ the headline number (1336).
**Fix:** label the Y axis ("coins"), and reconcile per-rider max vs. session total in the header copy.

---

## Bucket E — The orphaned HR lanes (bottom third)

### 🔴 Sin 14 — Five stacked HR lanes with no axes, no labels, no scale.
The bottom third is five per-rider HR area charts (FitnessTimeline). They have **no Y axis, no HR labels, no shared baseline labels, and no X axis of their own** — the only time axis is on the *coin chart far above*, separated by the gutter. A reader can't tell what HR any peak represents, or even that these are HR at all vs. the coin lines above.
**Fix:** at minimum label the lane group ("Heart rate"), give one shared Y reference (zone thresholds as faint gridlines are right there), and either repeat a compact time axis at the bottom or visually tie the lanes to the top axis.

### 🟠 Sin 15 — Lanes have ragged, unequal right edges that read as "broken," not "stopped early."
Soren's and Alan's lanes end well short of 41:00 (Soren did only ~13 min active per `zone_minutes`). That's *true* — they left early — but rendered as a hard ragged cut with no end-marker it looks like truncated/corrupt data, not an intentional "rider departed." Same issue the dropout badges solve in the top chart; the bottom lanes get no such treatment.
**Fix:** terminate short lanes with a dropout marker / faded tail consistent with the top chart's vocabulary.

### 🟡 Sin 16 — Two coordinate systems, one crude bridge.
Top chart = coins vs. time; bottom lanes = HR vs. time; they share *only* the vertical marker lines as connective tissue, and those are the very lines indicting in Sin 8. There's no shared, legible time ruler binding the two halves — the relationship is asserted by alignment alone and immediately undercut by the line forest.

---

## Bucket F — Composition / header (bonus, since it's in the same frame)

### 🟡 Sin 17 — The game-screenshot card has white caption text over a bright sky.
Top-right: "The Dreamcast edition of Sega's legendary racer…" in white, partly over the bright sky/cliffs of the Daytona thumbnail → low contrast, hard to read. Caption needs a scrim/gradient behind it (the codebase already does this elsewhere).

### 🟡 Sin 18 — Floating divider + cramped-top / empty-bottom-right density imbalance.
A horizontal rule floats under the metadata with no clear grouping job, while the chart is jammed top-left and the bottom-right of the plot is near-empty (everyone's curve has flattened by 30:45, but the axis runs to 41:00 with a long dead zone). Tighten the X domain to where the action is, or use the dead space for the legend/controls evicted in Sin 2.

---

## Priority fix order (if you fix nothing else)

1. **Sin 8** (vertical-line forest) — biggest single readability win; stop drawing full-height triple-strength lines in three components.
2. **Sin 1 + Sin 4** (top-margin clip + tie collision) — the hero moment (KC wins, Milo/Felix tie) is currently the ugliest pixel in the frame.
3. **Sin 11** (color means five things) — give identity its own channel so the middle of the race is traceable.
4. **Sin 2** (chrome over plot) — evict LOG toggle + legend from the data area.
5. **Sin 14** (HR lanes have no axes) — label and scale the bottom third.

Everything else is polish that follows naturally once these five land.

---

## Code reference index

| Sin | Primary location |
|---|---|
| 1 | `lib/chartConstants.js` `CHART_MARGIN.top`; `FitnessChart.jsx:27` `AVATAR_RADIUS` |
| 2 | `FitnessChart.scss:51,78`; `FitnessChart.jsx:1377-1405` |
| 3,13 | `FitnessChart.jsx:1242` (`toFixed(0)`), `:618-631` (axes, no title) |
| 4,5,7 | `layout/LayoutManager.js`; `FitnessChart.jsx:720-792,1155-1220` |
| 6 | `FitnessChart.jsx:626-631` (y labels) vs `:720-792` (avatars) |
| 8 | `FitnessChart.jsx:598,606`; `MarkerGutter.jsx:26-37` |
| 9,10 | `FitnessChart.jsx:588-602,795-810,1291-1298`; `MarkerGutter.jsx:25` |
| 11 | `FitnessChart.jsx:157,777`; `lib/activities/challengeTypeRegistry.js`; FitnessTimeline fills |
| 12 | session data `participants[].display_name`; legend Title-Casing |
| 14,15,16 | `FitnessTimeline.jsx`, `MarkerGutter.jsx`, `sessionDetailUtils.js` |
| 17,18 | `FitnessSessionDetailWidget.jsx:298-431`, `.scss` |

---

## Resolved — 2026-06-14

The top-5 priority sins (8, 1+4+7, 11, 2+3+13, 14+15) were fixed on branch
`feat/fitness-chart-viz-cleanup` per
[the implementation plan](../plans/2026-06-14-fitness-chart-viz-layout-optimization.md).
Verified via before/after screenshots of session `20260612180809` (vision-reviewed):
line-forest removed, tie (Milo/Felix 382) fanned, identity underglow added, chrome
evicted + round ticks + COINS label, HR lanes labeled with peak bpm + early-stop dots.
Sins 5/6/10/12/16/17/18 partially addressed where phases overlapped; remaining items
left for a follow-up pass.
