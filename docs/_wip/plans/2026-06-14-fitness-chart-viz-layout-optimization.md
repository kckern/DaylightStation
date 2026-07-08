# Fitness Session-Detail Chart — Visualization & Layout Optimization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the five highest-impact readability defects in the fitness session-detail chart (vertical-line forest, top-margin clipping + tie pile-up, indistinguishable racer lines, chrome-over-plot, axis-less HR lanes) so a 5-rider 42-minute session renders legibly.

**Architecture:** The view is composed of three stacked, tick-aligned layers — `FitnessChart` (coin-race line chart, top), `MarkerGutter` (annotation band, middle), `FitnessTimeline` (per-rider HR area lanes, bottom) — all inside `FitnessSessionDetailWidget`. We isolate every pure computation (nice ticks, identity colors, tie fanning, HR lane stats) into small TDD'd helpers, then wire them into the existing SVG renderers with surgical edits. Annotation lines get demoted to the gutter; the line chart and HR lanes stop redrawing them full-height.

**Tech Stack:** React (SVG-in-JSX), Vitest (co-located `*.test.js`), Playwright (visual verification), SCSS.

**Source audit:** `docs/_wip/audits/2026-06-14-fitness-chart-session-detail-design-sins-audit.md`

**Specimen session for all visual checks:** `20260612180809` — 5 riders, 42.3 min, 510 ticks, 13 challenges, 1 video, 1 voice memo. Final coins: **KC 431, User_3 382, User_2 382 (TIE), User_4 99, User_5 42**. The User_3/User_2 tie is the canary for Phase 2.

---

## Decisions locked before implementation

1. **Racer line identity = HYBRID** (user-selected): keep the zone-colored stroke, add a per-racer identity-colored underglow + identity-colored avatar ring/end-dot. Zone-on-line meaning is preserved; identity is the second channel. (Phase 3)
2. **Annotation lines live in the gutter** (audit recommendation): the full-height challenge/video lines are removed from `FitnessChart` and `FitnessTimeline`; `MarkerGutter` keeps them (softened) as the single connective cut. The line chart keeps short ticks + badges; lanes keep only race bands. (Phase 1)
3. **Scope = the audit's top-5 priority list.** Sins 5,7,12,16,17,18 are folded in opportunistically where a phase already touches that code, but are not gating.

If you disagree with #1 or #2, stop and renegotiate before Phase 1 — they shape everything downstream.

---

## Conventions for every task

- **Test runner:** `npx vitest run <path-to-test-file> --reporter=dot` for a single file.
- **Full suite (before final commit):** `npm run test:isolated`.
- **Commit cadence:** one commit per task (after its tests/verify pass). Branch first — do NOT work on `main` (CLAUDE.md rule). Suggested branch/worktree: `feat/fitness-chart-viz-cleanup`.
- **No raw console logging** in shipped code (CLAUDE.md) — the existing `console.log` at `FitnessChart.jsx:1136` is debug cruft; remove it if you touch that block.
- **Visual verification** uses the harness built in Task 0. Per project norm, a vision agent reviews screenshots — never ask the user to eyeball.

---

## Task 0: Build the visual-verification harness

**Why:** Phases 1, 2, 4, 5 are SVG/CSS changes that unit tests can't fully judge. We need a repeatable before/after screenshot + vision-agent review.

**Files:**
- Create: `tests/_scratch/shoot-session-chart.mjs`

**Step 1: Write the screenshot script**

```javascript
// tests/_scratch/shoot-session-chart.mjs
// Usage: BASE_URL=http://localhost:3111 SESSION=20260612180809 LABEL=before \
//        node tests/_scratch/shoot-session-chart.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'https://daylightlocal.kckern.net';
const SESSION = process.env.SESSION || '20260612180809';
const LABEL = process.env.LABEL || 'shot';
const OUT = `/tmp/session-chart-${LABEL}.png`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1728, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(`${BASE}/fitness/home/session-${SESSION}`, { waitUntil: 'networkidle' });
// The chart mounts async; wait for the race-chart svg + at least one avatar image.
await page.waitForSelector('.session-detail svg.race-chart__svg', { timeout: 20000 });
await page.waitForTimeout(1500);
const target = await page.$('.session-detail');
await (target || page).screenshot({ path: OUT });
console.log(`wrote ${OUT}`);
await browser.close();
```

**Step 2: Capture the BEFORE baseline (against prod, which has the data)**

Run: `BASE_URL=https://daylightlocal.kckern.net LABEL=before node tests/_scratch/shoot-session-chart.mjs`
Expected: `wrote /tmp/session-chart-before.png`

**Step 3: Make the session available to local dev (so AFTER screenshots reflect your edits)**

The specimen is NOT in the local data tree. Fetch it and write it where the dev backend reads history (DataService resolves `data/household/history/fitness/<date>/<id>.yml`). Convert the API JSON's inner `session` object to YAML:

Run:
```bash
curl -s "https://daylightlocal.kckern.net/api/v1/fitness/sessions/20260612180809" \
  | node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(0));const s=d.session;process.stdout.write(JSON.stringify(s))' \
  > /tmp/session-raw.json
node -e 'const fs=require("fs");const yaml=require("js-yaml");const s=JSON.parse(fs.readFileSync("/tmp/session-raw.json"));fs.mkdirSync("data/household/history/fitness/2026-06-12",{recursive:true});fs.writeFileSync("data/household/history/fitness/2026-06-12/20260612180809.yml",yaml.dump(s));console.log("wrote local fixture")'
```
Expected: `wrote local fixture`. (If the mount is read-only per CLAUDE.md, write via `ssh {env.prod_host}` is NOT needed here — this is your local dev tree, not prod.)

**Step 4: Confirm dev serves it**

Start dev if not running (`lsof -i :3111` first; CLAUDE.md). Then:
Run: `curl -s "http://localhost:3111/api/v1/fitness/sessions/20260612180809" | head -c 120`
Expected: JSON beginning `{"session":{"version":3,...`

**Step 5: Define the AFTER + review recipe (used by later phases)**

After each phase, run:
`BASE_URL=http://localhost:3111 LABEL=<phaseN> node tests/_scratch/shoot-session-chart.mjs`
then dispatch a vision agent:

> Agent (general-purpose): "Read `/tmp/session-chart-before.png` and `/tmp/session-chart-<phaseN>.png`. The second should fix <specific sins>. Confirm each fix is visible and report any NEW visual regressions (clipping, overlap, misalignment). Be specific with coordinates/labels."

**Step 6: Commit**

```bash
git add tests/_scratch/shoot-session-chart.mjs
git commit -m "test(fitness): add session-chart screenshot harness for viz verification"
```

> Note: `tests/_scratch/` is for harness scripts; if it shouldn't be committed long-term, move it to `_deleteme/` at the end (CLAUDE.md) — but keep it for the duration of this plan.

---

## Phase 1 — Demote the vertical-line forest (Sins 8, 10)

**Outcome:** ~13 full-height triple-strength annotation lines stop slicing the line chart and HR lanes. The gutter becomes the single, softened connective cut. Duration-fill opacity unified.

### Task 1.1: Add shared annotation constants

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/chartConstants.js`

**Step 1: Add constants** (append to the file)

```javascript
// Annotation styling (challenge/video markers). Single source of truth so the
// line chart, gutter, and HR lanes never disagree (audit Sin 10).
export const MARKER_FILL_OPACITY = 0.06;          // duration-rect tint
export const MARKER_CHART_TICK_LEN = 14;          // short downward tick under a badge in the line chart
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Fitness/lib/chartConstants.js
git commit -m "feat(fitness): shared annotation marker constants"
```

### Task 1.2: Stop the line chart from drawing full-height annotation lines

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` — the `overlay` block in `RaceChartSvg` (~lines 579–695) and import (line 13).

**Step 1:** Add the new import to the existing `chartConstants` import (line 13):

```javascript
import { CHART_MARGIN, MIN_VISIBLE_TICKS, MIN_GAP_DURATION_FOR_DASHED_MS, MARKER_FILL_OPACITY, MARKER_CHART_TICK_LEN } from '@/modules/Fitness/lib/chartConstants.js';
```

**Step 2:** In the challenge-markers map (~line 588–602), replace the full-height end-line pair with a short tick under the badge row. Find:

```javascript
            {/* solid edge on the RIGHT (challenge end); runs through the axis strip */}
            <line x1={m.xEnd} y1={overlay.top} x2={m.xEnd} y2={height} stroke="rgba(0,0,0,0.55)" strokeWidth={3.5} />
            <line x1={m.xEnd} y1={overlay.top} x2={m.xEnd} y2={height} stroke={color} strokeWidth={1.5} opacity={0.9} />
```

Replace with:

```javascript
            {/* SHORT end tick under the badge row — the gutter carries the full cut (audit Sin 8) */}
            <line x1={m.xEnd} y1={overlay.top} x2={m.xEnd} y2={overlay.top + MARKER_CHART_TICK_LEN} stroke={color} strokeWidth={1.5} opacity={0.9} />
```

Also change the two whisper-fill rects in that block to use `MARKER_FILL_OPACITY` instead of the literal `0.05`.

**Step 3:** Remove the video-line extension group entirely (the `co-vid-ext` map, ~lines 604–609) — the gutter shows these. Delete:

```javascript
            {/* video-line extensions through the axis strip (labels paint on top) */}
            {(overlay.videoMarkers || []).map((m, i) => ( ... ))}
```

**Step 4:** In the `race-chart__seams` group (~lines 679–695), remove the full-height `co-vid` video-marker lines (keep seams). Delete the `(overlay.videoMarkers || []).map(...)` sub-block there. Replace each remaining full-height video line with nothing (gutter owns them). Keep the seam dashes (group-session feature).

**Step 5: Visual verify**

Build AFTER screenshot (`LABEL=phase1`) and run the vision agent: "Confirm the line chart no longer has full-height vertical lines crossing the plotted curves; challenge ends now show only a short tick under the top badge row. Race-band seams (if any) may remain."

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "feat(fitness): demote line-chart annotation lines to short ticks (audit Sin 8)"
```

### Task 1.3: Strip annotation lines from the HR lanes

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx` (~lines 321–344)

**Step 1:** Delete the challenge-marker `<line>` pairs (lines 328–329) and the video-marker group (lines 339–344). Keep the duration `<rect>` (line 327) but switch its opacity to the shared constant. Keep seams. The lanes should carry only: race bands, HR fills, faint duration tints, avatars.

Add import:
```javascript
import { CHART_MARGIN, MIN_GAP_DURATION_FOR_DASHED_MS, MARKER_FILL_OPACITY } from '@/modules/Fitness/lib/chartConstants.js';
```
and use `opacity={MARKER_FILL_OPACITY}` on the retained challenge `<rect>`.

**Step 2: Visual verify** (`LABEL=phase1b`): "Confirm the bottom HR lanes no longer have vertical black/white lines slicing them; only soft challenge tints + race bands remain."

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx
git commit -m "feat(fitness): strip full-height annotation lines from HR lanes (audit Sin 8)"
```

### Task 1.4: Soften the gutter lines (the one place they stay)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx` (~lines 24–37)

**Step 1:** Reduce the double-stroke (3.5 black backing + 1.5 colored) to a single 1.5px colored line at ~0.8 opacity for challenges and a 1.5px dashed white at ~0.7 for videos. Use `MARKER_FILL_OPACITY` for the rect. The gutter is short (a thin band), so a single hairline reads cleanly as the cut without the heavy black backing.

**Step 2: Visual verify** (`LABEL=phase1c`): "Confirm the middle gutter band still shows aligned vertical markers connecting chart-to-lanes, but they're now thin/quiet, not heavy black bars."

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/MarkerGutter.jsx
git commit -m "feat(fitness): soften gutter annotation lines to single hairlines (audit Sin 8)"
```

---

## Phase 2 — Top-margin headroom + tie fanning (Sins 1, 4, 7)

**Outcome:** Avatars + value labels stop clipping at the top edge; the User_3/User_2 382 tie renders as a clean side-by-side fan with one shared "382", not an overlapping blob with a duplicated clipped label.

### Task 2.1: Give the chart top headroom

**Files:**
- Modify: `frontend/src/modules/Fitness/lib/chartConstants.js`

**Step 1:** Change the margin:

```javascript
export const CHART_MARGIN = { top: 40, right: 90, bottom: 38, left: 30 };
```

**Why 40:** clears the challenge-badge row (badges sit at `overlay.top + r + 1`, r=11) plus gives the avatar-label clamp room. `FitnessTimeline` ignores `.top` (it sets `plotHeight = height`), and `MarkerGutter` uses its own geometry, so only the line chart's `scaleY`/overlay shift — intended.

**Step 2: Visual verify** (`LABEL=phase2a`): "Confirm the top value labels (e.g. '382', '431') are fully visible, not clipped by the chart's top edge. Confirm the challenge badge row still sits at the top without overlapping the topmost gridline label."

**Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/lib/chartConstants.js
git commit -m "fix(fitness): top margin headroom so avatars/labels don't clip (audit Sin 1)"
```

### Task 2.2: Tie-fan helper (TDD)

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/tieFan.js`
- Test: `frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/tieFan.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { resolveTieFan } from './tieFan.js';

const A = (id, x, y, value) => ({ id, x, y, value, type: 'avatar' });

describe('resolveTieFan', () => {
  it('leaves a non-tied set untouched (offsets 0, labels shown)', () => {
    const out = resolveTieFan([A('kc', 300, 50, 431), A('user_5', 100, 200, 42)], { spacing: 64 });
    expect(out.map(a => a.id)).toEqual(['kc', 'user_5']);
    expect(out.every(a => (a.offsetX || 0) === 0 && a.labelHidden !== true)).toBe(true);
  });

  it('fans two tied avatars horizontally around their shared endpoint, centered', () => {
    const out = resolveTieFan([A('user_3', 300, 50, 382), A('user_2', 300, 50, 382)], { spacing: 64 });
    const user_3 = out.find(a => a.id === 'user_3');
    const user_2 = out.find(a => a.id === 'user_2');
    // centered fan: offsets -32 and +32
    expect([user_3.offsetX, user_2.offsetX].sort((a, b) => a - b)).toEqual([-32, 32]);
    expect(user_3.offsetY).toBe(0);
  });

  it('shows the value label on exactly one tied member (the last)', () => {
    const out = resolveTieFan([A('user_3', 300, 50, 382), A('user_2', 300, 50, 382)], { spacing: 64 });
    const hidden = out.filter(a => a.labelHidden === true);
    const shown = out.filter(a => a.labelHidden !== true);
    expect(hidden.length).toBe(1);
    expect(shown.length).toBe(1);
  });

  it('groups by approximate endpoint within tolerance', () => {
    const out = resolveTieFan([A('a', 300, 50, 382), A('b', 301, 51, 382)], { spacing: 64, xTol: 3, yTol: 3 });
    expect(out.filter(a => a.labelHidden === true).length).toBe(1); // treated as a tie
  });

  it('fans three tied avatars symmetrically (-spacing, 0, +spacing)', () => {
    const out = resolveTieFan([A('a', 300, 50, 9), A('b', 300, 50, 9), A('c', 300, 50, 9)], { spacing: 60 });
    expect(out.map(a => a.offsetX).sort((x, y) => x - y)).toEqual([-60, 0, 60]);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/tieFan.test.js --reporter=dot`
Expected: FAIL ("resolveTieFan is not a function" / cannot find module).

**Step 3: Implement**

```javascript
// frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/tieFan.js

/**
 * Detect avatars sharing (approximately) the same endpoint — a tie — and fan them
 * horizontally around that endpoint with a single shared value label.
 *
 * Tied avatars otherwise stack into an unreadable blob with a duplicated, often
 * clipped, value label (audit Sin 4 + Sin 7). This runs AFTER the LayoutManager
 * and overrides offsets for tied groups using each avatar's BASE (x, y) endpoint.
 *
 * @param {Array<{id,x,y,value}>} avatars
 * @param {Object} opts
 * @param {number} opts.spacing  horizontal gap between fanned members (px)
 * @param {number} [opts.xTol=2] x tolerance for "same endpoint"
 * @param {number} [opts.yTol=2] y tolerance for "same endpoint"
 * @returns {Array} new avatar objects with offsetX/offsetY and labelHidden set
 */
export function resolveTieFan(avatars = [], opts = {}) {
  const { spacing = 64, xTol = 2, yTol = 2 } = opts;
  if (!Array.isArray(avatars) || avatars.length === 0) return avatars;

  // Group by approximate endpoint. Greedy: assign each avatar to the first group
  // whose representative is within tolerance.
  const groups = [];
  for (const a of avatars) {
    const g = groups.find((grp) =>
      Math.abs(grp.x - a.x) <= xTol && Math.abs(grp.y - a.y) <= yTol);
    if (g) g.members.push(a);
    else groups.push({ x: a.x, y: a.y, members: [a] });
  }

  const out = [];
  for (const g of groups) {
    if (g.members.length < 2) {
      out.push({ ...g.members[0], offsetX: g.members[0].offsetX || 0, offsetY: g.members[0].offsetY || 0 });
      continue;
    }
    // Stable order so layout is deterministic across renders.
    const members = [...g.members].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const n = members.length;
    members.forEach((m, k) => {
      const offsetX = (k - (n - 1) / 2) * spacing;
      out.push({
        ...m,
        offsetX,
        offsetY: 0,
        tied: true,
        labelHidden: k !== n - 1, // single shared label on the last member
      });
    });
  }
  return out;
}
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/tieFan.test.js --reporter=dot`
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/tieFan.js frontend/src/modules/Fitness/widgets/FitnessChart/layout/utils/tieFan.test.js
git commit -m "feat(fitness): tie-fan layout helper for tied racers (audit Sin 4)"
```

### Task 2.3: Wire tie-fan into the chart and suppress duplicate labels

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` — import (top), the `{ avatars, badges, connectors }` useMemo (~line 1209–1220), and `RaceChartSvg` avatar label render (~lines 762–772).

**Step 1:** Import the helper near the other layout imports:

```javascript
import { resolveTieFan } from './layout/utils/tieFan.js';
```

**Step 2:** In the layout useMemo, after `const resolvedAvatars = elements.filter(e => e.type === 'avatar');`, fan ties:

```javascript
    const resolvedAvatars = resolveTieFan(
      elements.filter(e => e.type === 'avatar'),
      { spacing: AVATAR_RADIUS * 2 + 4 }
    );
```

(Connectors among tied members will now be near-zero length and harmless; no extra change needed, but if the vision check flags stray connector stubs between fanned ties, filter them: drop connectors whose `id` matches a `tied` avatar.)

**Step 3:** In `RaceChartSvg`, gate the coin label on `!avatar.labelHidden`. Find the `<text ... className="race-chart__coin-label">` block (~line 762) and wrap it:

```javascript
                {!avatar.labelHidden && (
                  <text
                    x={labelX}
                    y={labelY}
                    className="race-chart__coin-label"
                    textAnchor={textAnchor}
                    dominantBaseline="middle"
                    fontSize={COIN_FONT_SIZE}
                    aria-hidden="true"
                  >
                    {formatCompactNumber(avatar.value)}
                  </text>
                )}
```

**Step 4: Visual verify** (`LABEL=phase2c`): "Confirm User_3 and User_2 (both 382) now render side-by-side, fully visible, with a SINGLE '382' label between/beside them — not overlapping, not duplicated, not clipped. KC's '431' and the others remain correct."

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "feat(fitness): fan tied racer avatars with one shared label (audit Sins 4,7)"
```

---

## Phase 3 — Hybrid line identity: zone stroke + identity underglow (Sin 11)

**Outcome:** Each racer's line keeps its zone color but gains a stable, personal underglow + identity-colored avatar ring, so you can trace one rider through the mid-race tangle without losing zone meaning.

### Task 3.1: Identity-color helper (TDD)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/participantColors.js`
- Test: `frontend/src/modules/Fitness/lib/participantColors.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { assignIdentityColors, IDENTITY_PALETTE } from './participantColors.js';
import { ZoneColors } from '@/modules/Fitness/domain';

describe('assignIdentityColors', () => {
  it('returns a stable color per id regardless of input order', () => {
    const a = assignIdentityColors(['user_3', 'user_2', 'user_1']);
    const b = assignIdentityColors(['user_1', 'user_3', 'user_2']);
    expect(a.get('user_3')).toBe(b.get('user_3'));
    expect(a.get('user_1')).toBe(b.get('user_1'));
  });

  it('gives distinct colors to up to palette-length ids', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const m = assignIdentityColors(ids);
    const colors = ids.map(i => m.get(i));
    expect(new Set(colors).size).toBe(5);
  });

  it('never collides with a zone color', () => {
    const zone = new Set(Object.values(ZoneColors).map(c => c.toLowerCase()));
    expect(IDENTITY_PALETTE.every(c => !zone.has(c.toLowerCase()))).toBe(true);
  });

  it('cycles the palette when there are more ids than colors', () => {
    const ids = Array.from({ length: IDENTITY_PALETTE.length + 1 }, (_, i) => `u${i}`);
    const m = assignIdentityColors(ids);
    expect(m.size).toBe(ids.length);
    // first and (palette-length+1)-th share a color
    expect(m.get('u0')).toBe(m.get(`u${IDENTITY_PALETTE.length}`));
  });

  it('handles empty / falsy input', () => {
    expect(assignIdentityColors([]).size).toBe(0);
    expect(assignIdentityColors(['', null, 'x']).get('x')).toBeTruthy();
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/lib/participantColors.test.js --reporter=dot`
Expected: FAIL (module not found).

**Step 3: Implement**

```javascript
// frontend/src/modules/Fitness/lib/participantColors.js

// Identity palette — deliberately distinct from the HR zone palette
// (blue/green/yellow/orange/red/gray). Used as a soft underglow + avatar ring so a
// racer's line is traceable WITHOUT replacing the zone-colored stroke (audit Sin 11).
export const IDENTITY_PALETTE = Object.freeze([
  '#b388ff', // violet
  '#ff6fd8', // magenta-pink
  '#00bfa5', // teal
  '#7e57c2', // deep purple
  '#ff8f6b', // coral (warm but clearly not zone orange #ff922b at glow opacity)
  '#26c6da', // cyan (only reached for a 6th rider)
]);

/**
 * Assign a stable identity color to each participant id. Assignment is by sorted-id
 * order so the same roster always yields the same colors regardless of render order.
 * @param {string[]} ids
 * @returns {Map<string,string>}
 */
export function assignIdentityColors(ids = []) {
  const clean = [...new Set((ids || []).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
  const map = new Map();
  clean.forEach((id, i) => map.set(id, IDENTITY_PALETTE[i % IDENTITY_PALETTE.length]));
  return map;
}
```

> If the test `never collides with a zone color` flags coral `#ff8f6b` as too close to `#ff922b` for your taste, swap it for `#a1887f` (taupe) — the test only checks exact-value collision, so use the vision check in Task 3.3 as the real arbiter.

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/lib/participantColors.test.js --reporter=dot`
Expected: PASS (5 tests).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/participantColors.js frontend/src/modules/Fitness/lib/participantColors.test.js
git commit -m "feat(fitness): identity-color helper distinct from zone palette (audit Sin 11)"
```

### Task 3.2: Render the underglow + identity ring

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` — import, `paths` useMemo (~1114–1139), `RaceChartSvg` paths group (~633–659) and avatar zone-ring (~774–778), avatar-building useMemo (~1166–1185).

**Step 1:** Import the helper:

```javascript
import { assignIdentityColors } from '@/modules/Fitness/lib/participantColors.js';
```

**Step 2:** Compute the identity map once (near the top of the component body, after `allEntries` is available, ~line 906):

```javascript
	const identityColors = useMemo(
		() => assignIdentityColors(allEntries.map((e) => e.id)),
		[allEntries]
	);
```

**Step 3:** Attach the glow color to each path in the `paths` useMemo. In the `created.map((p, idx) => ({ ...p, id: entry.id, ... }))` (~line 1131), add `glowColor`:

```javascript
			return created.map((p, idx) => ({
				...p,
				id: entry.id,
				glowColor: identityColors.get(entry.id) || null,
				key: `${entry.id}-${globalIdx++}-${idx}`
			}));
```

Add `identityColors` to that useMemo's dep array. Also delete the stray `console.log('[FitnessChart] Gap paths in render:' ...)` debug block (~lines 1134–1137) while you're here (CLAUDE.md: no raw console logging).

**Step 4:** In `RaceChartSvg`, render the glow as a wide, blurred, low-opacity stroke BEHIND the zone stroke. Inside the `race-chart__paths` group's `sorted.map(...)`, return a fragment with the glow first:

```javascript
					return (
						<g key={`${path.zone || 'seg'}-${idx}`}>
							{!path.isGap && path.glowColor && (
								<path
									d={path.d}
									stroke={path.glowColor}
									fill="none"
									strokeWidth={PATH_STROKE_WIDTH + 6}
									opacity={finalOpacity * 0.35}
									strokeLinecap="round"
									strokeLinejoin="round"
									style={{ filter: 'blur(2px)' }}
								/>
							)}
							<path
								d={path.d}
								stroke={isLongGap ? ZONE_COLOR_MAP.default : path.color}
								fill="none"
								strokeWidth={PATH_STROKE_WIDTH}
								opacity={finalOpacity}
								strokeLinecap={isLongGap ? 'butt' : 'round'}
								strokeLinejoin="round"
								strokeDasharray={isLongGap ? '4 4' : undefined}
							/>
						</g>
					);
```

(Remove the old single `<path key=...>` return it replaces.)

**Step 5:** Give the avatar an identity ring + end-dot. In the avatar-building useMemo (~line 1175), add the identity color to the returned avatar object:

```javascript
				identityColor: identityColors.get(entry.id) || entry.color,
```

Add `identityColors` to that useMemo's deps. Then in `RaceChartSvg`, change the `.race-chart__avatar-zone` ring stroke from `avatar.color` (zone) to `avatar.identityColor`, and add a small identity end-dot. Find:

```javascript
								<circle
									className="race-chart__avatar-zone"
									r={AVATAR_RADIUS + 1.5}
									stroke={avatar.color}
								/>
```

Replace `stroke={avatar.color}` with `stroke={avatar.identityColor || avatar.color}`. (The end-dot is optional polish — the ring + glow already encode identity; add a `<circle r={5} fill={identityColor}>` at the line endpoint only if the vision check says identity isn't obvious enough.)

**Step 6: Visual verify** (`LABEL=phase3`): "Each racer's line should now sit on a soft, personal-colored halo (violet/teal/pink/etc.) while the line itself keeps its zone color (yellow/green/blue). The avatar ring color should match that racer's halo. Confirm you can visually trace each of the 5 lines through the 10:00–30:00 tangle. Confirm halos are distinct from each other and don't read as a zone color."

**Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "feat(fitness): identity underglow + ring for traceable racer lines (audit Sin 11)"
```

---

## Phase 4 — Evict chrome, nice ticks, axis label (Sins 2, 3, 13)

### Task 4.1: Nice-number tick helper (TDD)

**Files:**
- Create: `frontend/src/modules/Fitness/lib/chartScale.js`
- Test: `frontend/src/modules/Fitness/lib/chartScale.test.js`

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { niceNum, niceTicks } from './chartScale.js';

describe('niceNum', () => {
  it('rounds a range to a friendly magnitude', () => {
    expect(niceNum(433, false)).toBe(500);
    expect(niceNum(96, false)).toBe(100);
  });
});

describe('niceTicks', () => {
  it('produces round human ticks across a coin range', () => {
    expect(niceTicks(0, 433, 5)).toEqual([0, 100, 200, 300, 400, 500]);
  });
  it('never emits the toFixed garbage (172/303/433)', () => {
    const ticks = niceTicks(0, 433, 5);
    expect(ticks).not.toContain(172);
    expect(ticks).not.toContain(303);
  });
  it('handles a tiny range without dividing by zero', () => {
    expect(niceTicks(0, 0, 4)).toEqual([0]);
    expect(Array.isArray(niceTicks(40, 42, 4))).toBe(true);
  });
  it('handles a nonzero start', () => {
    const t = niceTicks(40, 440, 5);
    expect(t[0]).toBeLessThanOrEqual(40);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(440);
    expect(t.every(v => Number.isInteger(v))).toBe(true);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/lib/chartScale.test.js --reporter=dot`
Expected: FAIL.

**Step 3: Implement**

```javascript
// frontend/src/modules/Fitness/lib/chartScale.js

/** Round a positive range to a "nice" magnitude (1/2/5 × 10^n). */
export function niceNum(range, round) {
  if (!(range > 0)) return 0;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nf;
  if (round) {
    if (frac < 1.5) nf = 1; else if (frac < 3) nf = 2; else if (frac < 7) nf = 5; else nf = 10;
  } else {
    if (frac <= 1) nf = 1; else if (frac <= 2) nf = 2; else if (frac <= 5) nf = 5; else nf = 10;
  }
  return nf * Math.pow(10, exp);
}

/**
 * Human-friendly axis ticks spanning [min,max] with ~desiredCount steps.
 * Replaces FitnessChart's `value.toFixed(0)` over a warped domain, which produced
 * nonsense ticks like 42/172/303/433 (audit Sin 3).
 */
export function niceTicks(min, max, desiredCount = 5) {
  if (!(max > min)) return [Math.round(min) || 0];
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, desiredCount - 1), true) || 1;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}
```

**Step 4: Run to verify it passes**

Run: `npx vitest run frontend/src/modules/Fitness/lib/chartScale.test.js --reporter=dot`
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/lib/chartScale.js frontend/src/modules/Fitness/lib/chartScale.test.js
git commit -m "feat(fitness): nice-number axis tick helper (audit Sin 3)"
```

### Task 4.2: Use nice ticks for the Y axis

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` — `yTicks` useMemo (~1222–1247), import.

**Step 1:** Import: `import { niceTicks } from '@/modules/Fitness/lib/participantColors.js';` — **NO**, from `chartScale.js`:

```javascript
import { niceTicks } from '@/modules/Fitness/lib/chartScale.js';
```

**Step 2:** Replace the manual `values` computation in `yTicks` with nice ticks clipped to the visible domain. Keep the `scaleY(value)` positioning. Replace the body from `const span = ...` through the `filteredValues` map with:

```javascript
		const top = paddedMaxValue;
		const ticks = niceTicks(start, top, MIN_GRID_LINES + 1)
			.filter((v) => v >= start - 0.5 && v <= top + 0.5);
		const filteredValues = isSingleUser ? ticks.filter((v) => v > 0) : ticks;
		return filteredValues.map((value) => ({
			value,
			label: value.toFixed(0),
			y: scaleY(value),
			x1: 0,
			x2: chartWidth
		}));
```

**Step 3: Visual verify** (`LABEL=phase4a`): "Confirm the left Y-axis labels are now round numbers (e.g. 0/100/200/300/400) instead of 42/172/303/433."

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "fix(fitness): round Y-axis ticks instead of warped toFixed values (audit Sin 3)"
```

### Task 4.3: Move the LOG toggle + focus legend out of the plot; add an axis label

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.scss` (~lines 51–123)
- Modify: `frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx` — `RaceChartSvg` axes group (add the Y title).

**Step 1 (CSS — relocate chrome):** The `right` margin is 90px and largely empty; the bottom-right of the plot is dead space (everyone's curve flattens by ~30:45). Move chrome there.
- `.race-chart__scale-toggle`: change `left: 2.5rem` → `right: 0.75rem; left: auto` (top-right corner, over the empty right margin).
- `.race-chart__focus-filter`: change `top: 3.5rem; left: 2.5rem` → anchor bottom-right: `bottom: 3rem; right: 0.5rem; left: auto; top: auto;` and right-align items (`align-items: flex-end`). This parks the legend in the dead lower-right instead of over the climbing lines.

> If the vision check finds the legend still overlaps the leader avatar (KC at far right ~431), fall back to a horizontal legend strip in the panel header instead (a `.race-chart__legend--top` flex row above the SVG). Flag this and pick during review.

**Step 2 (Y-axis title):** In `RaceChartSvg`'s `race-chart__axes` group, add a rotated label near the top of the Y axis:

```javascript
				<text
					className="race-chart__axis-title"
					x={-CHART_MARGIN.top}
					y={14}
					transform="rotate(-90)"
					textAnchor="end"
					fontSize={12}
				>
					COINS
				</text>
```

And in SCSS add:

```scss
  .race-chart__axis-title {
    fill: rgba(255, 255, 255, 0.45);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 700;
  }
```

**Step 3: Visual verify** (`LABEL=phase4c`): "Confirm the LOG toggle and the racer legend are no longer sitting on top of the climbing lines in the upper-left; they're now in the right/lower-right area. Confirm a small vertical 'COINS' label marks the Y axis. No control should overlap a data line or an avatar."

**Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.scss frontend/src/modules/Fitness/widgets/FitnessChart/FitnessChart.jsx
git commit -m "feat(fitness): evict chrome from plot + label the coin axis (audit Sins 2,13)"
```

---

## Phase 5 — HR lanes: labels, scale, end markers (Sins 14, 15)

### Task 5.1: Return per-lane HR stats from buildHrAreaPath (TDD)

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx` (`buildHrAreaPath`)
- Create: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.hrpath.test.js`

> `buildHrAreaPath` is module-private. Export it (named) so it's testable; this is a low-risk export-for-test.

**Step 1:** Add `export` to `function buildHrAreaPath(...)`.

**Step 2: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { buildHrAreaPath } from './FitnessTimeline.jsx';

describe('buildHrAreaPath stats', () => {
  const zones = ['active', 'active', 'active', 'active', 'active'];
  it('reports hrMax, hrMin, and lastActiveTick for a simple series', () => {
    const hr = [100, 120, 150, 130, 110];
    const r = buildHrAreaPath(hr, zones, 5, 100, 0, 50, 5000);
    expect(r.hrMax).toBe(150);
    expect(r.hrMin).toBe(100);
    expect(r.lastActiveTick).toBe(4);
    expect(Array.isArray(r.fills)).toBe(true);
  });
  it('lastActiveTick is the final tick with HR for a rider who left early', () => {
    const hr = [100, 120, 130, null, null]; // dropped at tick 3
    const r = buildHrAreaPath(hr, zones, 5, 100, 0, 50, 5000);
    expect(r.lastActiveTick).toBe(2);
  });
  it('returns empty stats for an all-null series', () => {
    const r = buildHrAreaPath([null, null], ['active', 'active'], 2, 100, 0, 50, 5000);
    expect(r.fills).toEqual([]);
    expect(r.lastActiveTick).toBe(-1);
  });
});
```

**Step 3: Run to verify it fails**

Run: `npx vitest run frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.hrpath.test.js --reporter=dot`
Expected: FAIL (`r.hrMax` undefined; `lastActiveTick` undefined).

**Step 4: Implement** — in `buildHrAreaPath`, change the early `return { fills: [] }` sites to `return { fills: [], hrMin: null, hrMax: null, lastActiveTick: -1 }`, and the final `return { fills }` to:

```javascript
  return { fills, hrMin, hrMax, lastActiveTick: lastValid };
```

(`hrMin`/`hrMax`/`lastValid` are already computed in scope.)

**Step 5: Run to verify it passes**

Run: same command.
Expected: PASS.

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.hrpath.test.js
git commit -m "feat(fitness): expose per-lane HR stats from buildHrAreaPath (audit Sin 14)"
```

### Task 5.2: Render lane labels, a group title, and dropout end-markers

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx` (`lanes` useMemo + SVG render)
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.scss`

**Step 1:** In the `lanes` useMemo, thread the new stats through:

```javascript
      const { fills, hrMax, lastActiveTick } = buildHrAreaPath(hrSeries, zoneSeries, effectiveTicks, plotWidth, laneTop, laneHeight, intervalMs);
      // ...
      return { userId, name, avatarUrl, isGuest, laneTop, laneHeight, fills, hrMax, lastActiveTick };
```

**Step 2:** Add a peak-HR label per lane (right after the avatar, near lane start) and an end-marker dot at `lastActiveTick` when the rider stopped before the axis end (`lastActiveTick < effectiveTicks - 2`). Add a single "HEART RATE" group caption at the top-left of the timeline SVG. Concretely, add these JSX blocks inside the `<svg>`:

```javascript
        {/* group caption */}
        <text className="fitness-timeline__caption" x={CHART_MARGIN.left} y={12}>HEART RATE</text>
        {/* per-lane peak HR + early-stop marker */}
        {lanes.map((lane) => {
          const cy = lane.laneTop + lane.laneHeight / 2;
          const endX = tickToX(lane.lastActiveTick, effectiveTicks, plotWidth);
          const stoppedEarly = lane.lastActiveTick >= 0 && lane.lastActiveTick < effectiveTicks - 2;
          return (
            <g key={`lane-meta-${lane.userId}`}>
              {Number.isFinite(lane.hrMax) && (
                <text className="fitness-timeline__hr-max" x={lane.laneHeight + 8} y={lane.laneTop + 12}>
                  {Math.round(lane.hrMax)} bpm
                </text>
              )}
              {stoppedEarly && (
                <circle className="fitness-timeline__end-dot" cx={endX} cy={cy} r={3} />
              )}
            </g>
          );
        })}
```

**Step 3:** SCSS additions:

```scss
  .fitness-timeline__caption {
    fill: rgba(255, 255, 255, 0.5);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .fitness-timeline__hr-max {
    fill: rgba(255, 255, 255, 0.7);
    font-size: 10px;
    font-weight: 600;
  }
  .fitness-timeline__end-dot {
    fill: rgba(255, 255, 255, 0.85);
    stroke: rgba(0, 0, 0, 0.6);
    stroke-width: 1;
  }
```

**Step 4: Visual verify** (`LABEL=phase5`): "Confirm the bottom HR lanes now have: a 'HEART RATE' caption, a peak-bpm number on each lane, and a small end-dot on lanes for riders who stopped early (User_5, User_4). Confirm the ragged lane ends now read as intentional stops, not broken data."

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessTimeline.scss
git commit -m "feat(fitness): label HR lanes + mark early-stop riders (audit Sins 14,15)"
```

---

## Phase 6 — Final verification & cleanup

### Task 6.1: Full regression run

**Step 1:** Run the isolated suite (covers all the helpers + existing chart/timeline tests):
Run: `npm run test:isolated`
Expected: PASS. If any pre-existing chart test asserts on `CHART_MARGIN.top`, the legacy yTick formula, or the old single-`<path>` structure, update the assertion to the new behavior (these are intended changes, not regressions) and note it in the commit.

**Step 2:** Final full-frame screenshot + holistic vision review:
Run: `BASE_URL=http://localhost:3111 LABEL=final node tests/_scratch/shoot-session-chart.mjs`
Vision agent: "Compare `/tmp/session-chart-before.png` and `/tmp/session-chart-final.png`. Verify all of: (1) no full-height annotation lines slicing the chart/lanes; (2) no clipped top labels; (3) User_3/User_2 tie fanned with one label; (4) traceable identity-haloed lines; (5) chrome off the plot + COINS axis label + round ticks; (6) labeled HR lanes with end-dots. Report ANY new regression."

### Task 6.2: Cleanup

**Step 1:** Remove the local data fixture if you don't want it lingering (it's untracked; `data/` is typically gitignored — verify with `git status`). Remove `/tmp/session-chart-*.png`.

**Step 2:** Decide the harness's fate: keep `tests/_scratch/shoot-session-chart.mjs` (useful) or `mv` it to `_deleteme/` (CLAUDE.md) if it shouldn't ship.

**Step 3:** Update the audit doc with a short "Resolved YYYY-MM-DD" footer linking this plan, and move it from `_wip/audits/` to `_archive/` only if fully closed (otherwise leave it).

**Step 4:** Per CLAUDE.md docs rule, if any reference docs describe the chart's axis/marker behavior, update them. (Search: `grep -ril "race-chart\|FitnessChart" docs/`.)

**Step 5: Finishing the branch** — REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch to merge into `main` (no PR per CLAUDE.md) or present options. Do NOT auto-merge or run deploy.sh (CLAUDE.md).

---

## Risk notes for the executor

- **`CHART_MARGIN` is shared** by `FitnessChart`, `FitnessTimeline`, `MarkerGutter`, and `useTimelineMarkers`. Only `.top` changes and only the line chart consumes `.top` — but grep `CHART_MARGIN.top` before/after to be sure nothing else regresses alignment.
- **Tick-axis alignment across the three layers** is load-bearing (challenge/video markers line up vertically). The X-scale (`effectiveTicks`, `innerWidth`, `CHART_MARGIN.left/right`) is untouched by this plan — keep it that way, or alignment breaks.
- **`buildSegments` colors are zone colors and many tests depend on that.** Phase 3 does NOT touch `buildSegments`; it adds the glow as a separate render layer keyed by participant id. Keep it that way.
- **The identity glow uses an SVG `blur` filter** — cheap here (few paths) but if `useRenderProfiler` flags regressions on the live (non-historical) chart, gate the glow to `isHistorical` only, since the live cycle view is the perf-sensitive one.
- **Local data availability:** the specimen session isn't in the local tree by default (Task 0 Step 3 fixes that). Without it, dev screenshots will 404.
