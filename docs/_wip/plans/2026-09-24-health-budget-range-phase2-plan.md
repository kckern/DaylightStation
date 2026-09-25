# Health Budget Range — Phase 2 (Bar and Charts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** The Today bar becomes a labelled ruler, and the week strip and month block adopt the same range and zone colours.
- The Today bar gets ticks, the goal band, break-even, a hatched exercise credit, the net frontier coloured by zone, and a remaining run.
- The week strip and month block show the goal band (floor→top) and colour days by the server's zone.

**Architecture:**
- A new pure `today/budgetGeometry.js` turns a budget day and a pixel width into percentages: ruler, ticks, band, marks, segments and run. `BudgetBar` only renders it.
- `dayBars.barModel` takes the zone from the server and gains `floorPct`.
- The styles use `--ds-*` tokens only.

**Spec:** `docs/_wip/plans/2026-09-24-health-budget-range-design.md` rev 2, "Phase 2 — Bar and charts". It builds on Phase 1, which is merged and deployed.

## Global Constraints
- Zone colours: `incomplete` → `--ds-info` (blue, "still working toward it"); `in-range` and `declared` → `--ds-success`; `over` → `--ds-warning`; `past-even` → `--ds-danger`. Tokens only; `audit:ui` rejects raw colours.
- **Ruler.**
  - `left = −ceil250(exercise)`.
  - `right = max(maintenance, net, top, floor) × 1.12`.
  - Everything maps onto the full track width. On exercise days marks keep their values and move in pixels.
- **Ticks.**
  - Every 250.
  - Numbered at 1,000s under 600 px and at 500s from 600 px.
  - Suppressed within 12 px of a named mark (band edges, break-even, and the 0 line when there is exercise).
- **Band and labels.**
  - The band runs from `floor − exercise` to `top`, labelled "Goal {floor}–{top}".
  - It collapses to a single Goal line when `floor − exercise ≥ top`.
  - Break-even keeps only its number when within 40 px of the top.
- **Blocks.**
  - Food block: from −exercise, length = food. It carries a "N eaten" label when ≥ 70 px wide.
  - Earned hatch: from −exercise to 0. It carries a number when ≥ 36 px wide.
- **Run.** It is drawn from the frontier to the zone's mark:
  - `incomplete`: net → the band's left edge.
  - `in-range`: net → top.
  - `over`: top → net.
  - `past-even`: even → net.
  - `declared`: none.
- A budget without `range`/`zone` (an older server) renders the Phase 1 bar unchanged.

## Review Focus
1. **Negative net** (exercise > food): the food block ends left of 0, the hatch remainder shows, and nothing gets a negative width. Pinned in the geometry tests.
2. **Tiny widths** (a 280 px phone): no numbered tick overlaps a mark label, and the food label is dropped rather than overflowing. Pinned in the geometry tests.
3. **Floor − exercise below 0** (exercise > floor): the band's left edge clamps to the ruler's left, and the run for `incomplete` never goes negative. Pinned in the geometry tests.
4. **Strip day with no range** (older cached payload): the legacy zone mapping still paints. Pinned in the `dayBars` tests.
5. **Month caption:** "over" counts split into over-the-top and past break-even, and incomplete days are counted. Pinned in the `MonthBlock` test.

---

### Task 1: `budgetGeometry.js` (pure)
**Files:** create `frontend/src/modules/Health/today/budgetGeometry.js`, `budgetGeometry.test.js`.
**Produces:** `budgetGeometry(budget, { widthPx }) → { left, right, pct(v), ticks: [{ value, pct, label|null }], band: { fromPct, toPct, collapsed, label }, even: { pct, value, wordless }|null, zero: pct|null, earned: { fromPct, widthPct, value, labelled }|null, food: { fromPct, widthPct, value, labelled }, run: { fromPct, widthPct, value }|null, zone }`.
- [ ] Write tests (example day, negative net, exercise > floor, collapse, tick suppression, label fit by width, run per zone).
- [ ] Implement. Run `npx vitest run frontend/src/modules/Health/today/budgetGeometry.test.js`. Commit.

### Task 2: `BudgetBar` renders the geometry
**Files:** `EquationStrip.jsx` (`BudgetBar`), `health.scss` (`.health-budget*`), `EquationStrip.test.jsx`, `EquationStrip.geometry.test.js` (extend the markup fixture).
- [ ] Tests: the food block carries the zone class; the band label reads "Goal 1,200–1,791"; the earned hatch appears only with exercise; the run is absent when declared; a legacy budget still renders the old marks.
- [ ] Implement. Run the Health suite and the Playwright layout test. Commit.

### Task 3: Week strip and month block
**Files:** `dayBars.js` (zone from the server, `floorPct`, import placement fix), `WeekStrip.jsx`, `MonthBlock.jsx`, `health.scss`, and their tests.
- [ ] Tests: the fill class follows `day.zone`; the band spans floorPct→goalPct; a legacy day keeps under/deficit/surplus; the month caption counts over/past-even/incomplete.
- [ ] Implement. Run the Health suite. Commit.

### Task 4: Docs, render check, deploy
- [ ] README: the bar section and the week-strip/month-block sections describe the ruler.
- [ ] Headless screenshots, phone and desktop, of the live data and of staged exercise and negative-net days (via route interception).
- [ ] Merge, gate, build, gate, deploy, verify `/build.txt`.
