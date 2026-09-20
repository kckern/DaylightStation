# Drama Nav Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 4:3 drama rail into a navigation surface — a horizontal Act-chip header over a Scene→Beat accordion, with per-item progress fill, operable by pointer and by the Shield remote's four keys.

**Architecture:** Everything is additive and data-driven. The `act → scene → beat` hierarchy is a third `groups:` level the backend store already flattens to any depth, so **no backend code changes**. `SegmentMap`'s `orientation: 'column'` branch grows a chip header, a scene/beat accordion and per-row fill, all gated on region keys the store passes through untouched. Remote navigation plugs into `componentOverrides`, an existing extension point that `keyboardManager.handleKeyDown` consults *before* playback and default key maps.

**Tech Stack:** React 18, Vitest + @testing-library/react, sass-embedded (for compiled-CSS assertions), YAML corpus in the Docker data volume.

**Spec:** [docs/superpowers/specs/2026-09-17-drama-nav-rail-design.md](../specs/2026-09-17-drama-nav-rail-design.md) (committed `bda253ca2`)

**Scope:** Code only. Authoring the full ~60–85 beats is a separate plan; Task 8 authors **Act IV alone** as a working fixture.

## Global Constraints

- **No use-case vocabulary in code.** `act`, `scene`, `beat` appear only as corpus data. `kind:` and `title:` are display-only and never read by a conditional.
- **`concert-hall` must render byte-identical.** It declares none of the new region keys.
- **The module contract is fixed:** `{ position, duration, playing, seeking, data, region, logger }`. Seek and nav travel as DOM CustomEvents, never as props.
- **Nothing renders below `--label-floor`** (8.64px at the 960 root; `min-height: calc(var(--label-floor) * 2)` = 17.28px per row).
- **No new glow, gradient, or border-radius.** Progress is a 2px fill; motion is `120ms linear` by `transform`.
- **No state may depend on `Esc`** — FKB swallows it on the Shield. Every state exits via D-pad + OK.
- **A band holding a nested `segment-map` is ≥82px** (`SegmentMap.scss:130`, `min-height: calc(3.9rem + var(--group-rows))`, which overrides any authored `height`). The nav-rail band therefore carries `cue-ticker` alone.
- **Test command:** `npm run test:unit:vitest` (→ `node scripts/gate-vitest.mjs`; `ROOTS` includes `frontend`). Single file: `npx vitest run <path>`.
- **Data-volume writes** use inline base64 — `sudo docker exec -i` is NOT NOPASSWD. Never `sed -i` YAML in the container. Verify `wc -c` + `md5sum` on both sides, and `chown 1000:1000` after (docker exec writes as root).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `frontend/src/modules/Surround/navMode.js` | **NEW.** Pure reducer for nav-mode selection state + the `surround-nav` event name. No React, no DOM. | Create |
| `frontend/src/modules/Surround/navMode.test.js` | Unit tests for the reducer. | Create |
| `frontend/src/modules/Surround/modules/SegmentMap.jsx` | Column branch: chip header, scene/beat accordion, per-row fill, nav-event listener. | Modify (column branch only, ~`:1294-1371`) |
| `frontend/src/modules/Surround/modules/SegmentMap.scss` | Chip, accordion, per-row fill rules; lift the row `max-height` cap. | Modify |
| `frontend/src/modules/Surround/modules/SegmentMap.test.jsx` | Specs for all of the above. | Modify |
| `frontend/src/modules/Surround/modules/PlayCard.jsx` | `identity: false` region flag. | Modify (`:70`, `:118`, `:122`) |
| `frontend/src/modules/Surround/modules/PlayCard.test.jsx` | Spec for the flag. | Modify |
| `frontend/src/modules/Surround/SurroundFrame.scss` | `--placard-straddle: -66.67%` → `-50%`. | Modify (`:73`) |
| `frontend/src/lib/Player/useMediaKeyboardHandler.js` | Register the four nav keys in `conditionalOverrides` when the surround declares a nav rail. | Modify (`~:301`) |
| `frontend/src/lib/Player/useMediaKeyboardHandler.navmode.test.jsx` | Specs for key interception + scoping. | Create |
| `data/content/surround/_surrounds/playhouse-rail.yml` | New region keys + band. | Modify (data volume) |
| `data/content/library/drama/shakespeare/taming-of-the-shrew.yml` | Act IV gains a beat level. | Modify (data volume) |

---

## Task 1: The nav-mode reducer

A pure state machine, built first because every later task consumes it and it is
the only piece with real branching logic. No React, no DOM, no events.

**Files:**
- Create: `frontend/src/modules/Surround/navMode.js`
- Test: `frontend/src/modules/Surround/navMode.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const SURROUND_NAV_EVENT = 'surround-nav'`
  - `export const NAV_IDLE_MS = 12000`
  - `export const navInitial = null`
  - `export function navReduce(state, action, world)` → `{ groupIndex, rowIndex } | null`
    - `state`: `{ groupIndex: number, rowIndex: number } | null` (null = not in nav mode)
    - `action`: `'enter' | 'up' | 'down' | 'left' | 'right' | 'select' | 'exit'`
    - `world`: `{ groups: Array<{index:number, from:number, count:number}>, soundingGroupIndex: number|null, soundingRowIndex: number }`
    - Returns the next state. `'select'` and `'exit'` return `null`.
  - `export function navSeekTarget(state, world)` → `number | null` — the row index to seek to, or null.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Surround/navMode.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { navReduce, navSeekTarget, navInitial, NAV_IDLE_MS, SURROUND_NAV_EVENT } from './navMode.js';

// Three groups: Act I (rows 0-1), Act II (row 2), Act III (rows 3-4).
const WORLD = {
  groups: [
    { index: 0, from: 0, count: 2 },
    { index: 1, from: 2, count: 1 },
    { index: 2, from: 3, count: 2 },
  ],
  soundingGroupIndex: 1,
  soundingRowIndex: 2,
};

describe('navMode reducer', () => {
  it('exports the event name and the idle grace', () => {
    expect(SURROUND_NAV_EVENT).toBe('surround-nav');
    expect(NAV_IDLE_MS).toBe(12000);
    expect(navInitial).toBeNull();
  });

  it('enters at the sounding row, not at the top', () => {
    expect(navReduce(navInitial, 'enter', WORLD)).toEqual({ groupIndex: 1, rowIndex: 2 });
  });

  it('down moves to the next row within the selected group, and stops at its end', () => {
    const s = navReduce({ groupIndex: 2, rowIndex: 3 }, 'down', WORLD);
    expect(s).toEqual({ groupIndex: 2, rowIndex: 4 });
    // Already on the last row of the group: it holds rather than leaking into the next.
    expect(navReduce(s, 'down', WORLD)).toEqual({ groupIndex: 2, rowIndex: 4 });
  });

  it('up past the first row of the group EXITS — the no-Esc escape hatch', () => {
    expect(navReduce({ groupIndex: 2, rowIndex: 4 }, 'up', WORLD)).toEqual({ groupIndex: 2, rowIndex: 3 });
    expect(navReduce({ groupIndex: 2, rowIndex: 3 }, 'up', WORLD)).toBeNull();
  });

  it('right previews the next group at its first row, and clamps at the last group', () => {
    expect(navReduce({ groupIndex: 0, rowIndex: 0 }, 'right', WORLD)).toEqual({ groupIndex: 1, rowIndex: 2 });
    expect(navReduce({ groupIndex: 2, rowIndex: 3 }, 'right', WORLD)).toEqual({ groupIndex: 2, rowIndex: 3 });
  });

  it('left previews the previous group at its first row, and clamps at the first', () => {
    expect(navReduce({ groupIndex: 1, rowIndex: 2 }, 'left', WORLD)).toEqual({ groupIndex: 0, rowIndex: 0 });
    expect(navReduce({ groupIndex: 0, rowIndex: 0 }, 'left', WORLD)).toEqual({ groupIndex: 0, rowIndex: 0 });
  });

  it('select and exit both leave nav mode', () => {
    expect(navReduce({ groupIndex: 0, rowIndex: 1 }, 'select', WORLD)).toBeNull();
    expect(navReduce({ groupIndex: 0, rowIndex: 1 }, 'exit', WORLD)).toBeNull();
  });

  it('an action while not in nav mode is inert, except enter', () => {
    expect(navReduce(null, 'down', WORLD)).toBeNull();
    expect(navReduce(null, 'left', WORLD)).toBeNull();
  });

  it('navSeekTarget names the selected row, and nothing when idle', () => {
    expect(navSeekTarget({ groupIndex: 2, rowIndex: 4 }, WORLD)).toBe(4);
    expect(navSeekTarget(null, WORLD)).toBeNull();
  });

  it('enters at row 0 when nothing is sounding', () => {
    const gap = { ...WORLD, soundingGroupIndex: null, soundingRowIndex: -1 };
    expect(navReduce(null, 'enter', gap)).toEqual({ groupIndex: 0, rowIndex: 0 });
  });

  // THE FOUR BELOW ARE NOT OPTIONAL. Each one failed against the first draft of
  // this reducer, and the bugs they catch are not hypothetical — they were
  // shipped, reviewed, and fixed. Dropping them re-opens all three.

  it('enter with soundingRowIndex outside the resolved group’s span clamps into that group', () => {
    // soundingGroupIndex null -> falls back to groups[0] (rows 0-1), but the
    // stale row is 4. Unclamped, navSeekTarget would seek row 4.
    const stale = { ...WORLD, soundingGroupIndex: null, soundingRowIndex: 4 };
    expect(navReduce(null, 'enter', stale)).toEqual({ groupIndex: 0, rowIndex: 1 });
  });

  it('right at the LAST group starting from its LAST row is a no-op', () => {
    // MUST start from the last row. Starting from the group's FIRST row hides
    // the bug, because the erroneous reset lands on the row you started from.
    const at = { groupIndex: 2, rowIndex: 4 };
    expect(navReduce(at, 'right', WORLD)).toEqual({ groupIndex: 2, rowIndex: 4 });
  });

  it('left at the FIRST group starting from a non-first row is a no-op', () => {
    const at = { groupIndex: 0, rowIndex: 1 };
    expect(navReduce(at, 'left', WORLD)).toEqual({ groupIndex: 0, rowIndex: 1 });
  });

  it('down and up heal a groupIndex that is absent from world.groups', () => {
    const shrunk = { ...WORLD, groups: [WORLD.groups[0], WORLD.groups[1]] };
    const orphan = { groupIndex: 2, rowIndex: 3 };
    expect([0, 1]).toContain(navReduce(orphan, 'down', shrunk).groupIndex);
    expect([0, 1]).toContain(navReduce(orphan, 'up', shrunk).groupIndex);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Surround/navMode.test.js`
Expected: FAIL — `Failed to resolve import "./navMode.js"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Surround/navMode.js`:

```js
/**
 * NAV MODE — the selection state for a navigable rail.
 *
 * Pure by design: no React, no DOM, no timers. The rail renders it, the
 * Player's key handler advances it, and neither owns it. That is what lets the
 * module contract stay read-only — the state travels as a DOM CustomEvent in
 * one direction and a seek in the other, exactly as `surround-seek` already does.
 *
 * WHY UP-PAST-THE-TOP EXITS. FKB swallows Esc on the Shield, and the remote has
 * only a D-pad and OK, so every state must be escapable from those four keys
 * alone. Up is the one direction that has a natural edge to fall off.
 */

/** The DOM event the Player dispatches and the rail listens for. */
export const SURROUND_NAV_EVENT = 'surround-nav';

/**
 * THE REPLY CHANNEL, and it has to exist.
 *
 * The rail owns the selection; the Player owns the keys. When the reducer
 * leaves nav mode — `up` past the first row, `select`, or `exit` — the Player
 * MUST hear about it, because it is the Player that decides whether Up/Left/
 * Right/Enter are borrowed or handed back. Without this the rail silently goes
 * idle while the Player still believes it is navigating, and every one of those
 * keys stays swallowed until an idle timer rescues the viewer.
 */
export const SURROUND_NAV_STATE_EVENT = 'surround-nav-state';

/** Leave nav mode after this long without a key. Matches the footer-zoom grace. */
export const NAV_IDLE_MS = 12000;

/** Not in nav mode. */
export const navInitial = null;

const groupAt = (world, groupIndex) => (Array.isArray(world?.groups)
  ? world.groups.find((g) => g.index === groupIndex) ?? null
  : null);

const firstRowOf = (group) => (group ? group.from : 0);
const lastRowOf = (group) => (group ? group.from + group.count - 1 : 0);

/**
 * @param {{groupIndex:number,rowIndex:number}|null} state
 * @param {'enter'|'up'|'down'|'left'|'right'|'select'|'exit'} action
 * @param {{groups:Array<{index:number,from:number,count:number}>,
 *          soundingGroupIndex:number|null, soundingRowIndex:number}} world
 * @returns {{groupIndex:number,rowIndex:number}|null}
 */
export function navReduce(state, action, world) {
  const groups = Array.isArray(world?.groups) ? world.groups : [];
  if (groups.length === 0) return null;

  if (action === 'enter') {
    // The sounding row, so the first press lands where the viewer already is.
    // In a gap nothing is sounding, and the top of the rail is the honest answer.
    const gi = Number.isFinite(world?.soundingGroupIndex) && world.soundingGroupIndex !== null
      ? world.soundingGroupIndex : groups[0].index;
    const group = groupAt(world, gi) ?? groups[0];
    let row = world?.soundingRowIndex >= 0 ? world.soundingRowIndex : firstRowOf(group);
    // CLAMP INTO THE RESOLVED GROUP. When `gi` falls back to groups[0] — a stale
    // or null soundingGroupIndex beside a stale soundingRowIndex — the row must
    // not survive from the group we did NOT enter. `navSeekTarget` forwards this
    // row unchanged, so an unclamped value seeks the wrong place.
    row = Math.max(firstRowOf(group), Math.min(row, lastRowOf(group)));
    return { groupIndex: group.index, rowIndex: row };
  }

  if (!state) return null;
  if (action === 'select' || action === 'exit') return null;

  const here = groupAt(world, state.groupIndex) ?? groups[0];
  const at = groups.indexOf(here);

  if (action === 'down') {
    // Held at the group's last row rather than leaking into the next group:
    // moving between groups is what left/right is for, and a Down that silently
    // changed act would make the chip row lie about what is selected.
    // HEAL the group: `here` may have fallen back to groups[0] because
    // state.groupIndex names a group that is no longer in world.groups, and
    // spreading `...state` would keep that dead index alive forever.
    return { groupIndex: here.index, rowIndex: Math.min(state.rowIndex + 1, lastRowOf(here)) };
  }

  if (action === 'up') {
    // THE EXIT. Past the first row there is nowhere above to go, so nav mode
    // ends and the arrows go back to the Player. This is the escape hatch: the
    // Shield remote has only a D-pad and OK, and FKB swallows Esc.
    if (state.rowIndex <= firstRowOf(here)) return null;
    return { groupIndex: here.index, rowIndex: state.rowIndex - 1 };
  }

  if (action === 'left' || action === 'right') {
    const nextAt = Math.max(0, Math.min(groups.length - 1, at + (action === 'right' ? 1 : -1)));
    const next = groups[nextAt];
    // CLAMPED AT A BOUNDARY MEANS NO-OP, not "move inside the group we are
    // already in". Without this guard, `right` on the last row of the last
    // group returned firstRowOf(that same group) — the selection jumped
    // BACKWARD on a press that should have done nothing.
    if (next.index === state.groupIndex) return state;
    // Previewing only. The playhead does not move until OK.
    return { groupIndex: next.index, rowIndex: firstRowOf(next) };
  }

  return state;
}

/**
 * The row a `select` should seek to.
 * @returns {number|null} row index, or null when not in nav mode.
 */
export function navSeekTarget(state, world) {
  if (!state) return null;
  const groups = Array.isArray(world?.groups) ? world.groups : [];
  if (groups.length === 0) return null;
  return state.rowIndex;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Surround/navMode.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/navMode.js frontend/src/modules/Surround/navMode.test.js
git commit -m "feat(surround): add the nav-mode reducer for a navigable rail"
```

---

## Task 2: Chip header in the column

The column grows a header of one chip per top-level group, built from `railGroups`
— the same function the horizontal rail uses — so a group with no placed segment
gets no chip. Gated on `region.groups === 'header'` so nothing else changes.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx` (column branch, `~:1294-1371`)
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss`
- Test: `frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

**Interfaces:**
- Consumes: `railGroups(placed, selectGroup)` from `../band.js` → `Array<{title, mini, index, from, count, span}>`; `placedRail` (`Array<{index, segment}>`); `activeIndex` (number, `-1` when nothing sounds); `outerAt(i)` (the column branch's existing helper).
- Produces (later tasks depend on this name): `const soundingGroupIndex = outerAt(activeIndex)?.index ?? null;` — **do not** use the module's `activeGroupIndex` here. It is gated on `nested`, which requires two or more ancestor levels (the horizontal fold's threshold), so it is permanently `null` for a work grouped at one tier and no chip would ever light.
- Produces: DOM `[data-testid="surround-nav-chips"]` containing `[data-testid="surround-nav-chip"]` elements, each with `data-group-index` and `data-state` of **`sounding | idle`**. (`selected` is added later, by Task 5, when nav mode can preview a group that is not the sounding one — do not implement it here.)

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/modules/Surround/modules/SegmentMap.test.jsx`:

```jsx
describe('SegmentMap — column chip header', () => {
  // Two placed groups; a third authored group has no placeable segment and
  // must NOT get a chip (the Shrew's Induction is cut in this production).
  const GROUPED = {
    contentId: 'plex:1',
    timeline: { totalSounding: 300 },
    segments: [
      { n: 1, label: 'Scene 1', contentId: 'plex:1', start: 0, offset: 0, duration: 100, end: 100,
        ancestors: [{ index: 0, title: 'Act I', kind: 'act' }] },
      { n: 2, label: 'Scene 2', contentId: 'plex:1', start: 100, offset: 100, duration: 100, end: 200,
        ancestors: [{ index: 0, title: 'Act I', kind: 'act' }] },
      { n: 1, label: 'Scene 1', contentId: 'plex:1', start: 200, offset: 200, duration: 100, end: 300,
        ancestors: [{ index: 1, title: 'Act II', kind: 'act' }] },
    ],
  };
  const region = { module: 'segment-map', orientation: 'column', groups: 'header' };

  it('renders one chip per placed group', () => {
    const { container } = render(
      <SegmentMap position={10} duration={300} data={GROUPED} region={region} />,
    );
    const chips = container.querySelectorAll('[data-testid="surround-nav-chip"]');
    expect(chips.length).toBe(2);
    expect(chips[0]).toHaveAttribute('data-group-index', '0');
    expect(chips[1]).toHaveAttribute('data-group-index', '1');
  });

  it('lights the chip whose group is sounding', () => {
    const { container } = render(
      <SegmentMap position={250} duration={300} data={GROUPED} region={region} />,
    );
    const chips = [...container.querySelectorAll('[data-testid="surround-nav-chip"]')];
    expect(chips.find((c) => c.dataset.state === 'sounding')).toHaveAttribute('data-group-index', '1');
  });

  it('renders NO chip header when the definition does not ask for one', () => {
    const { container } = render(
      <SegmentMap position={10} duration={300} data={GROUPED}
        region={{ module: 'segment-map', orientation: 'column' }} />,
    );
    expect(container.querySelector('[data-testid="surround-nav-chips"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx -t "chip header"`
Expected: FAIL — `chips.length` is `0`, no `surround-nav-chip` in the DOM.

- [ ] **Step 3: Implement**

No import changes are needed: `railGroups` is already imported from `../band.js`
(`SegmentMap.jsx:69`). Inside `if (orientation === 'column') {`, immediately after
the `const marks = ...` block, insert:

```jsx
    // ONE CHIP PER PLACED GROUP. `railGroups` is the horizontal rail's own
    // run-builder, reused unchanged: a group whose every segment was refused a
    // start (this production cuts the Induction) never appears in `placedRail`,
    // so it never becomes a run, so it never gets a chip you cannot seek to.
    const wantsChips = region?.groups === 'header';
    const chipRuns = wantsChips
      ? railGroups(placedRail, (segment) => segment?.ancestors?.[0] ?? null)
        .filter((run) => run.index !== null)
      : [];
    // WHICH CHIP IS SOUNDING. Read from the same source the row marks use, so
    // it is correct at one ancestor level AND at two. The module's
    // `activeGroupIndex` is NOT usable here: it is gated on `nested` (two levels
    // or more — the horizontal fold's own threshold), so on a work grouped at a
    // single tier it is permanently null and no chip ever lights.
    const soundingGroupIndex = outerAt(activeIndex)?.index ?? null;
```

Then, inside the returned `<div className="surround-segment-map surround-segment-map--column" …>`,
as the **first** child (before the `__spine` span):

```jsx
        {chipRuns.length > 0 && (
          <div className="surround-segment-map__chips" data-testid="surround-nav-chips">
            {chipRuns.map((run) => (
              <button
                type="button"
                key={run.index}
                className="surround-segment-map__chip"
                data-testid="surround-nav-chip"
                data-group-index={String(run.index)}
                data-state={run.index === soundingGroupIndex ? 'sounding' : 'idle'}
                onClick={() => {
                  const first = placedRail[run.from]?.segment;
                  if (first) seekTo(first.mediaStart ?? first.start ?? 0, first.contentId);
                }}
              >
                {run.mini || run.title}
              </button>
            ))}
          </div>
        )}
```

> `<button>` rather than `<span>` is deliberate: it is focusable, so the chips are
> reachable by `useScopedRemoteControls` on any surface that uses it, without
> this module knowing anything about that.

In `SegmentMap.scss`, append to the column block (after the `--column` rule):

```scss
/* THE CHIP HEADER. One mark per group, in a row, at the rail's head. No radius
   and no glow — the band's standing rule — so a chip is distinguished by ground
   and weight alone, exactly as the sounding row is. */
.surround-segment-map__chips {
  display: flex;
  gap: 0.25em;
  flex: 0 0 auto;
  padding: 0 0 0.4em;
}

/* FALLBACKS ARE THE BASE VALUES, NOT THE REMAPPED ONES. `SurroundFrame.scss:26`
   and `:31` define `--programme-edge: #ddd0b4` and `--ink-soft: #6b6152`; the
   band and rail then REMAP them to their dark equivalents at `:430-432` and
   `:489-491`. A SCSS fallback therefore carries the base value — the remap
   already happens at runtime whenever the frame is present. Writing the dark
   value here is only ever visible when the module renders OUTSIDE the frame,
   which is exactly where a wrong colour hides longest. */
.surround-segment-map__chip {
  flex: 1 1 0;
  min-width: 0;
  appearance: none;
  border: 1px solid var(--programme-edge, #ddd0b4);
  background: transparent;
  color: var(--ink-soft, #6b6152);
  font-family: var(--surround-body);
  font-size: var(--label-floor, 11.52px);
  line-height: 1.25;
  padding: 0.3em 0;
  cursor: pointer;
  text-align: center;

  &[data-state="sounding"] {
    background: var(--bond-ground, rgba(233, 223, 200, 0.14));
    color: var(--ink, #332b20);
    font-weight: 600;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx`
Expected: PASS — the three new specs plus every existing SegmentMap spec.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx frontend/src/modules/Surround/modules/SegmentMap.scss frontend/src/modules/Surround/modules/SegmentMap.test.jsx
git commit -m "feat(surround): give the column a chip header built from placed groups"
```

---

## Task 3: Scope the column's rows to one group

With `region.scope === 'group'` the column lists only the selected group's
segments instead of all of them. This is what turns fourteen cramped rows into
five legible ones.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx` (column branch)
- Test: `frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

**Interfaces:**
- Consumes: `chipRuns` and `soundingGroupIndex` from Task 2.
- Produces: the column's `<ol>` renders only rows whose `ancestors[0].index` matches the shown group. Row `data-testid` stays `surround-segment-row`; a new `data-row-index` carries the row's index in the **full** rail so seeking is unambiguous.

- [ ] **Step 1: Write the failing test**

Append to `SegmentMap.test.jsx`, inside the `column chip header` describe (it
shares the `GROUPED` fixture):

```jsx
  it('lists only the sounding group’s rows when the definition scopes to a group', () => {
    const scoped = { module: 'segment-map', orientation: 'column', groups: 'header', scope: 'group' };
    // position 250 is inside Act II, which has exactly one scene.
    const { container } = render(
      <SegmentMap position={250} duration={300} data={GROUPED} region={scoped} />,
    );
    const rows = container.querySelectorAll('[data-testid="surround-segment-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveAttribute('data-row-index', '2');
  });

  it('lists every row when the definition does not scope', () => {
    const { container } = render(
      <SegmentMap position={250} duration={300} data={GROUPED}
        region={{ module: 'segment-map', orientation: 'column', groups: 'header' }} />,
    );
    expect(container.querySelectorAll('[data-testid="surround-segment-row"]').length).toBe(3);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx -t "scopes to a group"`
Expected: FAIL — `rows.length` is `3`, expected `1`.

- [ ] **Step 3: Implement**

In the column branch, after the `chipRuns` block from Task 2, add:

```jsx
    // WHICH GROUP THE LIST IS SHOWING. The sounding one by default; nav mode
    // overrides it to preview another (Task 5). Scoping is what buys the rows
    // their height: five scenes at 32px read, fourteen at 17px do not.
    //
    // USE `soundingGroupIndex` (defined in Task 2), NOT the module's
    // `activeGroupIndex`. The latter is gated on `nested`, which demands two or
    // more ancestor levels — the horizontal fold's threshold — so it is
    // permanently `null` for a work grouped at a single tier, and scoping
    // against it would show an EMPTY list rather than the sounding group's rows.
    const scopeToGroup = region?.scope === 'group' && chipRuns.length > 0;
    const shownGroupIndex = soundingGroupIndex;
    const rowIndices = segments.map((_, i) => i).filter((i) => (
      !scopeToGroup || (drawnRail[i]?.segment?.ancestors?.[0]?.index ?? null) === shownGroupIndex
    ));
```

Then change the `<ol>` body from `segments.map((seg, i) => …)` to iterate
`rowIndices`, carrying the true index:

```jsx
        <ol className="surround-segment-map__rows">
          {rowIndices.map((i) => {
            const seg = segments[i];
            return (
              <li
                key={`${seg.contentId ?? 'row'}:${i}`}
                className="surround-segment-map__row"
                data-testid="surround-segment-row"
                data-row-index={String(i)}
                data-state={i === activeIndex ? 'sounding' : (activeIndex >= 0 && i < activeIndex ? 'played' : 'ahead')}
                onClick={() => seekTo(seg.mediaStart ?? seg.start ?? 0, seg.contentId)}
              >
                <span className="surround-segment-map__row-mark" data-testid="surround-row-mark">{marks[i]}</span>
                <span className="surround-segment-map__row-label">{seg.annotation || seg.label}</span>
              </li>
            );
          })}
        </ol>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx`
Expected: PASS — all specs, including the pre-existing eleven-row column specs (which pass no `scope`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx frontend/src/modules/Surround/modules/SegmentMap.test.jsx
git commit -m "feat(surround): scope the column's rows to one group when asked"
```

---

## Task 4: Per-row progress fill, and rows that breathe

Each row gets its own `--fill` — the fraction of *that row* elapsed — drawn with
the horizontal rail's existing 2px bar language. The `max-height` cap is lifted
so a five-row list fills the rail instead of stacking at its floor.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx` (column branch)
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss` (`:1150-1177` row rule)
- Test: `frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

**Interfaces:**
- Consumes: `segments` entries carrying `{ start, stop }` on the rail axis; `activeIndex`; `railPosition`.
- Produces: each row contains `<span class="surround-segment-map__row-bar">` with an inline `--fill` between 0 and 1, and `data-fill` to four decimals.

- [ ] **Step 1: Write the failing test**

```jsx
describe('SegmentMap — column row progress', () => {
  const FLAT = {
    contentId: 'plex:2',
    timeline: { totalSounding: 200 },
    segments: [
      { n: 1, label: 'One', contentId: 'plex:2', start: 0, offset: 0, duration: 100, end: 100 },
      { n: 2, label: 'Two', contentId: 'plex:2', start: 100, offset: 100, duration: 100, end: 200 },
    ],
  };
  const region = { module: 'segment-map', orientation: 'column' };

  it('fills each row by its OWN fraction: elapsed 1, sounding partial, future 0', () => {
    const { container } = render(
      <SegmentMap position={150} duration={200} data={FLAT} region={region} />,
    );
    const bars = container.querySelectorAll('[data-testid="surround-row-bar"]');
    expect(bars.length).toBe(2);
    expect(Number(bars[0].dataset.fill)).toBe(1);
    expect(Number(bars[1].dataset.fill)).toBeCloseTo(0.5, 2);
  });

  it('a future row is empty', () => {
    const { container } = render(
      <SegmentMap position={10} duration={200} data={FLAT} region={region} />,
    );
    const bars = container.querySelectorAll('[data-testid="surround-row-bar"]');
    expect(Number(bars[1].dataset.fill)).toBe(0);
  });

  it('rows may grow past four floors so a short list fills the rail', () => {
    const css = compileSheetOnce(path.join(__dirname, 'SegmentMap.scss')).css;
    const rule = css.match(/\.surround-segment-map__row\s*\{[^}]*\}/)[0];
    expect(rule).toContain('min-height: calc(var(--label-floor, 11.52px) * 2)');
    expect(rule).not.toContain('max-height');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx -t "column row progress"`
Expected: FAIL — no `surround-row-bar` elements; the CSS assertion fails on the still-present `max-height`.

- [ ] **Step 3: Implement**

In the column branch, before the `return (`, add:

```jsx
    // THE FILL IS A FRACTION OF THIS ROW, which is what makes it immune to the
    // accordion: whatever height the row is drawn at, the bar reaches its edge
    // exactly at the boundary. Same derivation as the horizontal rail's.
    const rowFill = (i) => {
      const seg = segments[i];
      const length = (seg?.stop ?? 0) - (seg?.start ?? 0);
      // NOTHING SOUNDING HAS TWO CAUSES AND THEY ARE OPPOSITES. `activeIndex`
      // is -1 both before the first segment starts and after the last one ends
      // (`band.js` `activeSegmentIndex`). Collapsing both to 0 empties every bar
      // in the rail at the final curtain, which reads as "none of this played".
      if (activeIndex < 0) return railPosition >= end ? 1 : 0;
      if (i < activeIndex) return 1;
      if (i > activeIndex) return 0;
      return length > 0 ? clamp01((railPosition - seg.start) / length) : 0;
    };
```

Add `<span>` as the last child of each row `<li>`:

```jsx
                <span
                  className="surround-segment-map__row-bar"
                  data-testid="surround-row-bar"
                  data-fill={rowFill(i).toFixed(4)}
                  style={{ '--fill': String(rowFill(i)) }}
                  aria-hidden="true"
                />
```

In `SegmentMap.scss`, **delete** the `max-height` line from
`.surround-segment-map__row` and update the comment above it:

```scss
  /* THE ROWS BREATHE INTO THE RAIL THEY WERE GIVEN, with no cap. The cap
     existed to stop a three-scene play taking a hundred pixels a row; scoping
     the list to one group (region `scope: group`) is what solves that now, and
     a capped row in a scoped list leaves dead ground under five scenes. */
  flex: 1 1 auto;
  min-height: calc(var(--label-floor, 11.52px) * 2);
```

Append the bar rules:

```scss
/* THE ROW'S OWN PROGRESS, in the band's one progress language: a 2px rule that
   fills. No glow, no gradient — `SegmentMap.jsx` records why the lit tip was
   removed, and a row is not a licence to reintroduce it. */
.surround-segment-map__row-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--ink-soft, #6b6152);
  opacity: 0.35;

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    transform: scaleX(var(--fill, 0));
    transform-origin: left center;
    /* `#2a1d07` is the BASE `--ink` (`SurroundFrame.scss:30`). Several older
       rules in this sheet carry `#332b20`, which matches no token at all — a
       literal that drifted. Do not copy it forward for consistency's sake;
       consistency with a wrong neighbour is not a virtue. */
    background: var(--ink, #2a1d07);
    transition: transform var(--head-ms, 120ms) linear;
  }
}

.surround-segment-map__row { position: relative; }

@media (prefers-reduced-motion: reduce) {
  .surround-segment-map__row-bar::after { transition: none; }
}
```

> `clamp01` is a module-local helper defined at `SegmentMap.jsx:115` and is
> already in scope. It is **not** exported by `band.js` — do not add it to that
> import.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx frontend/src/modules/Surround/modules/SegmentMap.scss frontend/src/modules/Surround/modules/SegmentMap.test.jsx
git commit -m "feat(surround): give each column row its own progress fill"
```

---

## Task 5: The rail listens for nav events

The column subscribes to `surround-nav` and renders the selection: the previewed
group's rows, the selected row outlined, the sounding chip still lit.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.jsx`
- Modify: `frontend/src/modules/Surround/modules/SegmentMap.scss`
- Test: `frontend/src/modules/Surround/modules/SegmentMap.test.jsx`

**Interfaces:**
- Consumes: `navReduce`, `navInitial`, `SURROUND_NAV_EVENT` from `../navMode.js`; `chipRuns`, `soundingGroupIndex`, `activeIndex` from Tasks 2–3.
- Produces: rows carry `data-selected="true"` when selected; chips carry `data-state="selected"` for a previewed (non-sounding) group. The rail dispatches `surround-seek` on `'select'`.

- [ ] **Step 1: Write the failing test**

```jsx
describe('SegmentMap — nav mode', () => {
  const region = { module: 'segment-map', orientation: 'column', groups: 'header', scope: 'group' };
  const fire = (action) => act(() => {
    document.dispatchEvent(new CustomEvent('surround-nav', { detail: { action } }));
  });

  it('enter selects the sounding row; right previews the next group without seeking', () => {
    const seeks = [];
    document.addEventListener('surround-seek', (e) => seeks.push(e.detail));
    const { container } = render(
      <SegmentMap position={10} duration={300} data={GROUPED} region={region} />,
    );
    fire('enter');
    expect(container.querySelector('[data-selected="true"]')).toHaveAttribute('data-row-index', '0');
    fire('right');
    // Previewing Act II: its row is listed, and NOTHING has been sought.
    expect(container.querySelector('[data-selected="true"]')).toHaveAttribute('data-row-index', '2');
    expect(seeks).toHaveLength(0);
    // The sounding chip is still Act I; Act II is merely selected.
    const chips = [...container.querySelectorAll('[data-testid="surround-nav-chip"]')];
    expect(chips[0].dataset.state).toBe('sounding');
    expect(chips[1].dataset.state).toBe('selected');
  });

  it('OK seeks to the selected row and leaves nav mode', () => {
    const seeks = [];
    document.addEventListener('surround-seek', (e) => seeks.push(e.detail));
    const { container } = render(
      <SegmentMap position={10} duration={300} data={GROUPED} region={region} />,
    );
    fire('enter'); fire('right'); fire('select');
    expect(seeks).toHaveLength(1);
    expect(seeks[0].seconds).toBe(200);
    expect(container.querySelector('[data-selected="true"]')).toBeNull();
  });

  it('up past the first row exits without seeking — the no-Esc escape', () => {
    const seeks = [];
    document.addEventListener('surround-seek', (e) => seeks.push(e.detail));
    const { container } = render(
      <SegmentMap position={10} duration={300} data={GROUPED} region={region} />,
    );
    fire('enter'); fire('up');
    expect(container.querySelector('[data-selected="true"]')).toBeNull();
    expect(seeks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx -t "nav mode"`
Expected: FAIL — no element carries `data-selected`.

- [ ] **Step 3: Implement**

Add to the `../navMode.js` import at the top of `SegmentMap.jsx` (a new import
line; `useState`, `useRef` and `useEffect` are already imported at `:62`):

```js
import { navReduce, navInitial, SURROUND_NAV_EVENT, SURROUND_NAV_STATE_EVENT } from '../navMode.js';
```

Add these three lines near the other hooks, **above** the `orientation === 'column'`
branch — hooks must never sit inside it, because the branch returns early and a
16:9 work would then render a different number of hooks:

```jsx
  const [nav, setNav] = useState(navInitial);
  // Assigned during render, read inside the listener. This is what lets the
  // subscription be registered ONCE instead of re-subscribing on every 10 Hz
  // tick — the same device `SurroundHost` uses for `getHandleRef`.
  const navRef = useRef({ world: null, segments: null });
```

Still above the branch, add the listener:

```jsx
  // THE RAIL IS TOLD, it does not listen to the keyboard. The Player owns the
  // keys and dispatches intent; this turns intent into selection, and a
  // selection into a seek through the same `surround-seek` the click path uses.
  useEffect(() => {
    const onNav = (e) => {
      const action = e?.detail?.action;
      if (!action) return;
      setNav((prev) => {
        const { world, segments: rows } = navRef.current;
        if (!world) return prev;
        if (action === 'select' && prev) {
          const seg = rows?.[prev.rowIndex];
          if (seg) seekTo(seg.mediaStart ?? seg.start ?? 0, seg.contentId);
        }
        const next = navReduce(prev, action, world);
        // TELL THE PLAYER. It owns the keys and decides whether the four are
        // borrowed or handed back, and it cannot see this reducer. Every
        // transition in or out of nav mode is reported — `up` past the first
        // row and `exit` included, not just `select` — because those are
        // exactly the exits the Player would otherwise never hear about.
        if (Boolean(next) !== Boolean(prev)) {
          document.dispatchEvent(new CustomEvent(SURROUND_NAV_STATE_EVENT, {
            detail: { active: Boolean(next) },
          }));
        }
        return next;
      });
    };
    document.addEventListener(SURROUND_NAV_EVENT, onNav);
    return () => document.removeEventListener(SURROUND_NAV_EVENT, onNav);
  }, [seekTo]);
```

> The seek is dispatched from inside the updater deliberately: `prev` is the only
> place the selected row is known, and reading it from `nav` outside would race a
> key pressed twice inside one React batch.

In the column branch, after `chipRuns`, build the world and publish it to the ref:

```jsx
    // NAV MOVES AT THE LEVEL THE LIST SHOWS. `chipRuns` are outermost-level and
    // name the chips. The list shows the DEEPEST group's rows. Feeding the
    // reducer chip runs makes `nav.groupIndex` an outermost index that gets
    // compared against deepest-level indices — a comparison that matches nothing
    // the moment a work authors three levels — and makes `nav.rowIndex` range
    // over rows the list is not displaying. On a two-level work the deepest runs
    // ARE the chip runs, so this changes nothing already shipped.
    const leafRuns = railGroups(placedRail, (segment) => segment?.ancestors?.at(-1) ?? null)
      .filter((run) => run.index !== null);
    const navWorld = {
      groups: leafRuns,
      soundingGroupIndex: soundingLeafIndex,
      soundingRowIndex: activeIndex,
    };
    navRef.current = { world: navWorld, segments };
```

(Replace the `shownGroupIndex` line from Task 3 with these three.)

**Also change the row filter to scope by the DEEPEST group, not the outermost.**
Task 3 wrote `ancestors?.[0]`, which is the act. Once a work authors a third
level, the rows are beats and `[0]` would list *every beat of every scene in the
act*, flat, with scene names never appearing. Scoping by the deepest ancestor is
what makes the list "this scene's beats":

```jsx
    const leafAt = (i) => drawnRail[i]?.segment?.ancestors?.at(-1) ?? null;
    // NOTHING SOUNDING IS AN ORDINARY STATE, NOT AN ERROR. `activeIndex` is -1
    // before the first segment starts, after the last ends, and in any gap —
    // which includes a paused screen before playback begins. Scoping against a
    // null group would keep only rows whose group index IS null, i.e. none, and
    // the rail would render EMPTY at exactly the moment a viewer is most likely
    // to be looking at it. Fall back to the first group instead.
    const soundingLeafIndex = leafAt(activeIndex)?.index ?? null;
    const firstLeafIndex = leafAt(0)?.index ?? null;
    const shownLeafIndex = nav
      ? nav.groupIndex
      : (soundingLeafIndex ?? firstLeafIndex);
    const rowIndices = segments.map((_, i) => i).filter((i) => (
      !scopeToGroup || (leafAt(i)?.index ?? null) === shownLeafIndex
    ));
```

**Add a spec for this** — it is a Task 3 review finding carried forward, and it
ships uncovered otherwise:

```jsx
  it('falls back to the first group’s rows when nothing is sounding', () => {
    // position 0 with a rail whose first segment starts later: activeIndex is -1.
    const region = { module: 'segment-map', orientation: 'column', groups: 'header', scope: 'group' };
    const { container } = render(
      <SegmentMap position={0} duration={300} data={GROUPED} region={region} />,
    );
    const rows = container.querySelectorAll('[data-testid="surround-segment-row"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveAttribute('data-row-index', '0');
  });
```

> On a two-level work `ancestors.at(-1)` **is** `ancestors[0]`, so every existing
> spec and the shipped behaviour are unchanged — this only bites once a third
> level exists. `indexAtDepth` in the store counts globally per depth, so a
> deepest-group index is unique across the whole work and cannot collide between
> two acts. Chips keep using `ancestors[0]`: they name acts, not scenes.

> `soundingGroupIndex` is the value Task 2 derives (`outerAt(activeIndex)?.index ?? null`),
> **not** the module's `activeGroupIndex`. `activeGroupIndex` is gated on `nested`
> (two ancestor levels or more) and is permanently `null` for a work grouped at one
> tier, which would feed the reducer a null sounding group — so `enter` would land on
> the first group every time instead of where the viewer actually is.

On the row `<li>`, add:

```jsx
                data-selected={nav && nav.rowIndex === i ? 'true' : undefined}
```

On the chip `<button>`, change `data-state` to:

```jsx
                data-state={run.index === soundingGroupIndex ? 'sounding'
                  : (nav && nav.groupIndex === run.index ? 'selected' : 'idle')}
```

SCSS — the selection outline is the one place an edge is allowed, because it must
read against both the lit and unlit grounds:

```scss
.surround-segment-map__row[data-selected="true"] {
  box-shadow: inset 0 0 0 2px var(--brass-lit, #f6e3a0);
}

.surround-segment-map__chip[data-state="selected"] {
  box-shadow: inset 0 0 0 2px var(--brass-lit, #f6e3a0);
  color: var(--ink, #332b20);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Surround/modules/SegmentMap.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/modules/SegmentMap.jsx frontend/src/modules/Surround/modules/SegmentMap.scss frontend/src/modules/Surround/modules/SegmentMap.test.jsx
git commit -m "feat(surround): let the column render a nav selection"
```

---

## Task 6: The Player dispatches nav intent

Four keys are intercepted **only** when the playing item's surround declares a
nav rail. `componentOverrides` is consulted before playback keys and the default
map, so nothing in `keyboardConfig.js` changes and `cycleShaders` is untouched
everywhere else.

**Files:**
- Modify: `frontend/src/lib/Player/useMediaKeyboardHandler.js` (`~:301`)
- Create: `frontend/src/lib/Player/useMediaKeyboardHandler.navmode.test.jsx`

**Interfaces:**
- Consumes: `meta.surround.definition.regions` (the store ships `definition: { regions, collapse, band }`); `SURROUND_NAV_EVENT`, `NAV_IDLE_MS` from `../../modules/Surround/navMode.js`.
- Produces: `document` CustomEvents `surround-nav` with `detail.action` ∈ `enter|up|down|left|right|select`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/Player/useMediaKeyboardHandler.navmode.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useMediaKeyboardHandler } from './useMediaKeyboardHandler.js';

function Harness(props) { useMediaKeyboardHandler(props); return null; }

const NAV_SURROUND = {
  id: 'playhouse-rail',
  segments: [],
  definition: { regions: { right: [{ module: 'segment-map', orientation: 'column', groups: 'header' }] } },
};
const PLAIN_SURROUND = {
  id: 'concert-hall',
  segments: [],
  definition: { regions: { right: [{ module: 'composer-card' }] } },
};

const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('useMediaKeyboardHandler — nav mode', () => {
  let events;
  const record = (e) => events.push(e.detail.action);
  beforeEach(() => { events = []; document.addEventListener('surround-nav', record); });
  afterEach(() => { document.removeEventListener('surround-nav', record); });

  const base = { mediaRef: { current: null }, getMediaEl: () => null, queuePosition: 0 };

  it('ArrowDown enters nav mode on a work whose surround declares a nav rail', () => {
    render(<Harness {...base} meta={{ surround: NAV_SURROUND }} />);
    press('ArrowDown');
    expect(events).toEqual(['enter']);
  });

  it('subsequent keys advance the selection, and OK selects', () => {
    render(<Harness {...base} meta={{ surround: NAV_SURROUND }} />);
    press('ArrowDown'); press('ArrowDown'); press('ArrowRight'); press('Enter');
    expect(events).toEqual(['enter', 'down', 'right', 'select']);
  });

  it('does NOT intercept on a work with no nav rail — shaders keep ArrowDown', () => {
    render(<Harness {...base} meta={{ surround: PLAIN_SURROUND }} />);
    press('ArrowDown');
    expect(events).toEqual([]);
  });

  it('does NOT intercept when there is no surround at all', () => {
    render(<Harness {...base} meta={{}} />);
    press('ArrowDown');
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/lib/Player/useMediaKeyboardHandler.navmode.test.jsx`
Expected: FAIL — `events` is `[]` in the first spec.

- [ ] **Step 3: Implement**

Add near the top of `useMediaKeyboardHandler.js`:

```js
import { SURROUND_NAV_EVENT, NAV_IDLE_MS } from '../../modules/Surround/navMode.js';
```

Immediately **before** `const conditionalOverrides = { ...keyboardOverrides };`:

```js
  /**
   * DOES THIS WORK HAVE A RAIL WORTH NAVIGATING?
   *
   * Read off the SAME `meta.surround` the transport already reads for
   * `segmentInput`, so the keys can never be bound for a frame that is not on
   * screen. A definition that asks for a chip header is asking to be navigated;
   * nothing else in the corpus is affected, which is what keeps `ArrowUp`/
   * `ArrowDown` on the shaders for every classical work.
   */
  const navRailRegions = meta?.surround?.definition?.regions ?? null;
  const hasNavRail = Boolean(navRailRegions && Object.values(navRailRegions)
    .flatMap((slot) => (Array.isArray(slot) ? slot : [slot]))
    .some((r) => r?.module === 'segment-map' && r?.groups === 'header'));

  // STATE, NOT A REF. `componentOverrides` is an identity-compared dependency of
  // keyboardManager's listener effect, and which keys are PRESENT in it has to
  // change when nav mode opens and closes. A ref mutates without re-rendering,
  // so the map would be rebuilt with the same key set forever.
  const [navActive, setNavActive] = useState(false);
  const navIdleRef = useRef(null);

  // THE RAIL'S REPLY. The reducer lives in the rail and the Player cannot see
  // it, so the rail reports every entry into and exit from nav mode — including
  // `up` past the first row, which is an exit the Player would otherwise never
  // hear about, leaving it holding four keys the viewer can no longer use.
  useEffect(() => {
    const onState = (e) => {
      const active = e?.detail?.active;
      if (typeof active !== 'boolean') return;
      if (!active && navIdleRef.current) {
        clearTimeout(navIdleRef.current);
        navIdleRef.current = null;
      }
      setNavActive(active);
    };
    document.addEventListener(SURROUND_NAV_STATE_EVENT, onState);
    return () => document.removeEventListener(SURROUND_NAV_STATE_EVENT, onState);
  }, []);

  const sendNav = useCallback((action) => {
    if (navIdleRef.current) clearTimeout(navIdleRef.current);
    document.dispatchEvent(new CustomEvent(SURROUND_NAV_EVENT, { detail: { action } }));
    // `navActive` is NOT set here. The rail is the authority on whether a
    // selection exists — it may refuse an action, and `up` at the first row
    // exits — so the Player waits to be told rather than guessing.
    if (action === 'select') return;
    // THE GRACE. Nav mode must not hold the arrows for the rest of the film
    // because somebody brushed the remote. Idling out hands seeking back.
    navIdleRef.current = setTimeout(() => {
      document.dispatchEvent(new CustomEvent(SURROUND_NAV_EVENT, { detail: { action: 'exit' } }));
    }, NAV_IDLE_MS);
  }, []);
  useEffect(() => () => { if (navIdleRef.current) clearTimeout(navIdleRef.current); }, []);
```

Then, after the existing `conditionalOverrides` / `isPaused` block, append:

```js
  if (hasNavRail) {
    // PRESENCE IS THE SWITCH, NOT THE HANDLER'S BODY. `keyboardManager`'s
    // `handleKeyDown` does `if (componentOverrides[event.key]) { preventDefault();
    // override(event); return; }` — it never inspects what the override did. So a
    // key that is PRESENT but whose handler no-ops is a key that is SWALLOWED:
    // it never reaches seekBackward/seekForward/cycleShaders/togglePlayPause.
    //
    // Registering all five up front therefore kills play/pause and seeking for
    // the whole runtime of any work with a nav rail. The four borrowed keys must
    // be ABSENT from the map whenever nav mode is idle, so they fall through to
    // their ordinary bindings. Only ArrowDown is always present — it is the way in.
    conditionalOverrides.ArrowDown = () => sendNav(navActive ? 'down' : 'enter');
    if (navActive) {
      conditionalOverrides.ArrowUp = () => sendNav('up');
      conditionalOverrides.ArrowLeft = () => sendNav('left');
      conditionalOverrides.ArrowRight = () => sendNav('right');
      conditionalOverrides.Enter = () => sendNav('select');
    }
  }
```

> `ArrowUp`/`Left`/`Right`/`Enter` are no-ops until nav mode is entered, so
> seeking and play/pause behave exactly as before until `ArrowDown` is pressed.
> An `up` that exits sets `navActiveRef` false via the rail's own reply — the
> reducer returns `null` and the next `ArrowDown` re-enters.

Add `useCallback`/`useEffect`/`useRef` to the React import if not already present.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/lib/Player/useMediaKeyboardHandler.navmode.test.jsx frontend/src/lib/Player/useMediaKeyboardHandler.ownership.test.jsx`
Expected: PASS — the new specs, and the existing ownership spec unbroken.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/Player/useMediaKeyboardHandler.js frontend/src/lib/Player/useMediaKeyboardHandler.navmode.test.jsx
git commit -m "feat(player): dispatch nav intent for works with a navigable rail"
```

---

## Task 7: `identity: false` on PlayCard, and the placard's straddle

Two small, independent presentation changes, folded together because they share a
test cycle and neither warrants its own.

**Files:**
- Modify: `frontend/src/modules/Surround/modules/PlayCard.jsx` (`:70`, `:118`, `:122`)
- Modify: `frontend/src/modules/Surround/SurroundFrame.scss` (`:73`)
- Test: `frontend/src/modules/Surround/modules/PlayCard.test.jsx`

**Interfaces:**
- Produces: `region.identity === false` suppresses `[data-testid="surround-play-header"]`; the fact zone is unaffected.

- [ ] **Step 1: Write the failing test**

Append to `PlayCard.test.jsx`, inside the existing `describe('PlayCard', …)`:

```jsx
  it('renders facts only when the definition turns its identity off', () => {
    const { container } = renderCard({ region: { module: 'play-card', identity: false } });
    expect(container.querySelector('[data-testid="surround-play-header"]')).toBeNull();
    expect(container.querySelector('[data-testid="surround-play-fact-zone"]')).not.toBeNull();
  });

  it('renders nothing when identity is off and there is no fact to carry', () => {
    const { container } = renderCard({
      data: { contentId: 'plex:1', assetBase: 'surround/drama', piece: { title: 'X' }, segments: [] },
      region: { module: 'play-card', identity: false, facts: false },
    });
    expect(container.querySelector('.surround-play-card')).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run frontend/src/modules/Surround/modules/PlayCard.test.jsx -t "identity"`
Expected: FAIL — the header is still rendered.

- [ ] **Step 3: Implement**

In `PlayCard.jsx`, beside `showFacts` (`:70`):

```js
  /**
   * DOES THIS CARD CARRY ITS IDENTITY BLOCK? The mirror of `facts`, and for the
   * same reason: in a rail under a placard that already sets the work's title,
   * the header prints it a second time. The definition decides; the card is told.
   */
  const showIdentity = region?.identity !== false;
```

Change `:118` and `:122`:

```js
  if (!(showIdentity && hasIdentity) && !(showFacts && shownFact.text)) return null;
```

```jsx
      {showIdentity && hasIdentity && (
```

In `SurroundFrame.scss:73`, change the value and amend the comment:

```scss
  /* HOW FAR THE PLATE SITS OVER THE PICTURE. Half on the hall, half on the
     picture: the plate reads as a caption fixed to the frame's top edge rather
     than as a band floating above it. */
  --placard-straddle: -50%;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run frontend/src/modules/Surround/modules/PlayCard.test.jsx frontend/src/modules/Surround/modules/WorkPlacard.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Surround/modules/PlayCard.jsx frontend/src/modules/Surround/modules/PlayCard.test.jsx frontend/src/modules/Surround/SurroundFrame.scss
git commit -m "feat(surround): let a region ask a play card for facts without identity"
```

---

## Task 8: The definition and one authored Act

Wire the pieces together in data, and author **Act IV's beats only** as a working
fixture. The remaining ~11 scenes are a separate plan.

**Files:**
- Modify: `data/content/surround/_surrounds/playhouse-rail.yml` (data volume)
- Modify: `data/content/library/drama/shakespeare/taming-of-the-shrew.yml` (data volume)
- Modify: `data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml` (data volume)

**Interfaces:**
- Consumes: every region key from Tasks 2–7.
- Produces: a live 4:3 frame whose rail is chips + scoped rows + who's-who, and whose band is the ticker alone.

- [ ] **Step 1: Stage the three files locally**

The data volume is root-owned and `sudo docker exec -i` is not NOPASSWD, so read
out, edit locally, write back as base64.

```bash
S=/tmp/navrail && mkdir -p "$S"
for f in _surrounds/playhouse-rail.yml drama/shakespeare/taming-of-the-shrew.bbc1980.yml; do
  sudo docker exec daylight-station sh -c "cat data/content/surround/$f" > "$S/$(basename $f)"
done
sudo docker exec daylight-station sh -c 'cat data/content/library/drama/shakespeare/taming-of-the-shrew.yml' > "$S/work.yml"
```

- [ ] **Step 2: Rewrite the definition**

Replace the `regions:` and `collapse:` blocks of `$S/playhouse-rail.yml` with:

```yaml
regions:
  top: { module: work-placard }
  right:
    - { module: segment-map, width: "40%", orientation: column,
        groups: header, scope: group, height: fill }
    - { module: play-card, identity: false, height: 150 }
  bottom:
    - { module: cue-ticker, height: fill }
collapse:
  footerFloor: 90
  # 108 = 540 - 432. The 4:3 picture takes the column's width; what it cannot
  # take is the 22px the placard straddles plus the 86px band beneath it.
  # THE BAND CARRIES THE TICKER ALONE: a nested segment-map claims >=82px by
  # min-height (SegmentMap.scss:130), which is what left the ticker too short to
  # set a single note when the two shared a band.
  mediaReserve: 108
```

- [ ] **Step 3: Author Act IV's beats**

In `$S/work.yml`, replace Act IV's `segments:` list with a `groups:` list — each
scene becomes a group, each beat a segment. Beat starts are seconds into the
file, snapped to subtitle cues in
`/media/kckern/Media/TV Shows/Shakespeare/Season 1/Shakespeare - S01E13 - The Taming Of The Shrew.srt`.
Act IV scene 1 begins at 3913s; the five beats below sit inside it.

```yaml
  - kind: act
    title: "Act IV"
    mini: "IV"
    # BOTH facts are carried across unchanged. The Act authors two, and the
    # second is the longest and most substantive in the work — dropping it
    # while "restructuring" would be a silent content loss disguised as a
    # shape change.
    facts:
      - "Petruchio's taming escalates methodically across all five scenes of this Act: denying Kate food, sleep, and even her wedding gown, all under what he repeatedly calls the name of perfect kindness."
      - "Scholars are sharply divided on how to read this Act. Some (following Emily Detmer's 1997 Shakespeare Quarterly article) compare Petruchio's methods directly to the psychology of hostage-taking; others read Kate as recognizing Petruchio's behavior as a mirror of her own and choosing to out-maneuver him at his own game."
    groups:
      - kind: scene
        title: "Starved at Her Own Table"
        heading: "A hall in Petruchio's country house."
        listen:
          - "Petruchio's falconry speech — \"my falcon now is sharp and passing empty\" — is the moment he tells the audience outright what he is doing: starving Kate into obedience exactly as a trainer starves a hawk."
        segments:
          - { n: 1, name: "Grumio arrives frozen", start: 3913 }
          - { n: 2, name: "The servants are dressed down", start: 4091 }
          - { n: 3, name: "The meal is thrown out", start: 4395 }
          - { n: 4, name: "The bride is denied her bed", start: 4516 }
          - { n: 5, name: "The falconry soliloquy", start: 4613 }
      - kind: scene
        title: "The Tutor Unmasked"
        heading: "Padua. Before Baptista's house."
        listen:
          - "Hortensio abandons his pursuit of Bianca the instant he sees her flirt with \"Cambio\" — played for comedy here, but it is the same taming logic Petruchio is applying to Kate in the very next scene."
        segments:
          - { n: 1, name: "Hortensio gives up on Bianca", start: 4695 }
      - kind: scene
        title: "The Gown Torn Up"
        heading: "A room in Petruchio's house."
        listen:
          - "Petruchio rejects the tailor's gown and the haberdasher's cap on principle, not because either is actually wrong — \"this doth fit the time,\" he insists of a cap he has already decided to hate."
        segments:
          - { n: 1, name: "The cap and gown refused", start: 5067 }
      - kind: scene
        title: "A Father Counterfeited"
        heading: "Padua. Before Baptista's house."
        listen:
          - "The Pedant, dressed as Vincentio, negotiates Bianca's dowry with Baptista while the real Vincentio is still on the road to Padua — the disguise plot's riskiest bluff yet."
        segments:
          - { n: 1, name: "The Pedant bargains as Vincentio", start: 5687 }
      - kind: scene
        title: "The Sun and the Moon"
        heading: "A public road."
        # CARRIED FROM THE OLD SEGMENT, NOT INVENTED. This scene re-describes
        # ONE name, which replaces the work-level Petruchio card from here on
        # while every other character keeps its baseline. Losing it would quietly
        # revert the card to the generic description at the play's hinge —
        # precisely where the sharper one earns its place.
        characters:
          - { name: "Petruchio", role: "a gentleman of Verona, suitor to Kate", description: "Deep into the taming — has spent this Act starving and sleep-depriving Kate under the banner of \"kindness,\" and now tests how far her compliance goes by insisting the sun is the moon." }
        listen:
          - "The \"sun or moon\" exchange is the hinge of the whole play — Kate agrees the sun is the moon the instant Petruchio insists on it, and by the scene's end she is playing his same game, unprompted, on a total stranger."
        segments:
          - { n: 1, name: "Kate agrees the sun is the moon", start: 5962 }
```

**Nothing authored may be lost in the restructure.** Act IV's five old segments
carry a `listen:` note each, `heading:`s, and (on scene 5) a `characters:`
override. The scene-groups above take over the `heading:`s and the character
override; every `listen:` note moves onto the scene-group that replaces its
segment. Before writing the file, diff the old Act IV block against the new one
and account for every authored line — a restructure that drops teaching material
is a regression wearing a refactor's clothes.

**EVERY scene of the Act is a group — no mixed children.** `nestedGroupSegments`
(`YamlSurroundStore.mjs:95-118`) pushes a group's own `segments` **before** it
recurses into its `groups`. So an Act holding four loose scene-segments *and* one
scene-group would flatten to `IV.2, IV.3, IV.4, IV.5, <beats of IV.1>` — out of
chronological order — and `starts:` pairs **positionally** with that flattened
list, so the sidecar would have to be authored in that scrambled order to match.
Giving scenes 2–5 a one-segment group each costs four lines and keeps the
flattened order chronological.

Scenes 2–5 reuse their existing scene starts, so no new timings are needed.

**These five are SNAPPED, not estimated.** Each sits on a real subtitle cue in
`Shakespeare - S01E13 - The Taming Of The Shrew.srt`, verified 2026-09-17:

| start | the cue it lands on |
|---|---|
| 3913 | "And all mad masters and all foul ways." |
| 4091 | "I call forth Nathaniel, Joseph, Nicholas, Philip, Walter Sugarsop…" |
| 4395 | "What dogs are these?" |
| 4516 | "Where is he?" — answered "In her chamber, making a sermon of continency" |
| 4613 | "She eat no meat today, nor none shall eat." (the falconry soliloquy) |

Scene 2 begins at 4695.9s ("Mistress Bianca doth fancy any other but Lucentio"),
so the last beat sits ~82s clear of the boundary. The earlier draft of this plan
carried invented round numbers — its final beat was at 4330, **283 seconds before
the line it claimed to mark**. Do not re-estimate these; they are measured.

> `mini: "IV"` is what the chip prints — `railGroups` carries `mini` already, and
> a chip has room for a numeral, not for "Act IV".
> **Beat starts above are placeholders pending the snapping pass in the authoring
> plan**; verify each against the SRT before committing, and adjust so they are
> strictly increasing and inside the scene's span.

- [ ] **Step 4: Extend `starts:` in the sidecar**

`starts:` pairs **positionally** with the store's flattened walk, so one wrong
entry silently misaligns every scene after it. Act IV goes from one entry to
nine — five beats for scene 1, then one for each of scenes 2–5 — and nothing
else moves. Write the whole list, do not hand-edit around it:

```yaml
starts:
  - null   # Induction, Scene 1 — cut in this production
  - null   # Induction, Scene 2 — cut in this production
  - 41     # Act I, Scene 1
  - 653    # Act I, Scene 2
  - 1384   # Act II, Scene 1
  - 2859   # Act III, Scene 1
  - 3216   # Act III, Scene 2
  # --- Act IV, Scene 1 — five beats, each snapped to a subtitle cue ---
  - 3913   # IV.1 beat 1 — "And all mad masters and all foul ways."
  - 4091   # IV.1 beat 2 — "I call forth Nathaniel, Joseph, Nicholas, Philip…"
  - 4395   # IV.1 beat 3 — "What dogs are these?"
  - 4516   # IV.1 beat 4 — "Where is he?" / "In her chamber…"
  - 4613   # IV.1 beat 5 — "She eat no meat today, nor none shall eat."
  # --- Act IV, Scenes 2-5 — one segment each, at their existing starts ---
  - 4695   # Act IV, Scene 2
  - 5067   # Act IV, Scene 3
  - 5687   # Act IV, Scene 4
  - 5962   # Act IV, Scene 5
  - 6208   # Act V, Scene 1
  - 6660   # Act V, Scene 2
```

That is **18 entries**: 2 nulls + 5 scenes before Act IV + 9 for Act IV + 2 for
Act V. Count them after writing — and count the flattened segments the work body
produces too, because the two must be equal or every scene after the mismatch is
stamped with the wrong time. The store keeps a refused entry in place rather
than dropping it, so the two leading nulls must stay — removing them would shift
every Act by two.

- [ ] **Step 5: Write all three back and verify**

```bash
write() { # write <local> <container-path>
  B=$(base64 -w0 "$1")
  sudo docker exec daylight-station sh -c "echo '$B' | base64 -d > $2 && chown 1000:1000 $2"
  echo "local : $(md5sum < "$1")"
  echo "remote: $(sudo docker exec daylight-station sh -c "md5sum < $2")"
}
write "$S/playhouse-rail.yml" data/content/surround/_surrounds/playhouse-rail.yml
write "$S/work.yml"           data/content/library/drama/shakespeare/taming-of-the-shrew.yml
write "$S/taming-of-the-shrew.bbc1980.yml" data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml
```

Each pair of md5s must match.

- [ ] **Step 6: Point the work back at the rail**

```bash
sudo docker exec daylight-station sh -c \
  'grep -n "^surround:" data/content/surround/drama/shakespeare/taming-of-the-shrew.bbc1980.yml'
```

It currently reads `playhouse` (the interim). Change it to `playhouse-rail` using
the same base64 write.

- [ ] **Step 7: Commit**

Data-volume files are outside the repo; commit only if the repo carries copies.
Otherwise record the change in the task's notes and proceed.

---

## Task 9: Measure the live frame

The spec's own history is the argument for this task: the last drama change
verified an inline style string, shipped, and put the band 0.4px tall on the
family TV. **Assertions here are measurements, never a screenshot glance.**

**Files:**
- Create: `/tmp/navrail/measure.mjs` (throwaway)

- [ ] **Step 1: Write the measurement script**

```js
import { chromium } from '/opt/Code/DaylightStation/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
await p.goto('http://localhost:3111/tv?play=' + encodeURIComponent('plex:697661'),
  { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForSelector('[data-testid="surround-frame"]', { timeout: 45000 });
await p.waitForTimeout(6000);
const o = await p.evaluate(() => {
  const box = (s) => { const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1) }; };
  const ticker = document.querySelector('.surround-cue-ticker');
  return {
    media: box('[data-testid="surround-media"]'),
    rail: box('[data-testid="surround-rail"]'),
    footer: box('[data-testid="surround-footer"]'),
    chips: document.querySelectorAll('[data-testid="surround-nav-chip"]').length,
    rows: document.querySelectorAll('[data-testid="surround-segment-row"]').length,
    bars: document.querySelectorAll('[data-testid="surround-row-bar"]').length,
    rowH: +(document.querySelector('[data-testid="surround-segment-row"]')?.getBoundingClientRect().height ?? 0).toFixed(1),
    tickerLen: ticker ? (ticker.innerText || '').trim().length : 0,
  };
});
const ok = (c) => (c ? 'OK  ' : 'FAIL');
const m = o.media;
console.log(JSON.stringify(o, null, 2), '\n---');
console.log(ok(m && Math.abs(m.w / m.h - 4 / 3) < 0.01), 'picture holds an exact 4:3');
console.log(ok(o.chips === 5), 'five chips — Acts I-V, no Induction');
// Scoping is by the DEEPEST group (Task 5), so while Act IV scene 1 sounds the
// list is that scene's five beats — not the whole Act's nine rows.
console.log(ok(o.rows === 5), 'five rows — Act IV scene 1 scoped to its beats');
console.log(ok(o.bars === o.rows), 'every row carries a progress bar');
console.log(ok(o.rowH >= 17.28), 'rows sit at or above the label floor');
console.log(ok(o.footer && o.footer.h > 80), 'the band has real height');
console.log(ok(o.tickerLen > 0), 'the ticker SETS text rather than refusing it');
await p.screenshot({ path: '/tmp/navrail/navrail.png' });
await b.close();
```

- [ ] **Step 2: Run it**

Run: `node /tmp/navrail/measure.mjs`
Expected: every line `OK`. A `FAIL` on the ticker means the band is still too
short — check `mediaReserve` and that no `segment-map` shares the band.

- [ ] **Step 3: Run the full gate**

Run: `npm run test:unit:vitest`
Expected: PASS at baseline. Capture the real exit code: `echo "exit=$?"`.

- [ ] **Step 4: Check the deploy gate, then deploy**

```bash
./scripts/deploy-gate.sh   # exit 0 = clear; it must be able to HALT the sequence
```

Only on exit 0:

```bash
./scripts/build-daylight.sh
./scripts/deploy-gate.sh   # re-run: a build takes minutes and someone can walk up
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 5: Re-measure against the deployed container and commit**

Run `node /tmp/navrail/measure.mjs` once more against the deployed build, then:

```bash
git add -A && git commit -m "feat(surround): ship the drama nav rail"
```

---

## Self-Review

**Spec coverage:**

| Spec § | Task |
|---|---|
| §4 hierarchy as data | 8 (no code — the store already flattens to any depth) |
| §5 layout + definition | 8 |
| §6 chips / heading / accordion / who's-who | 2, 3, 7 |
| §7 progress language | 4 |
| §8 placard straddle | 7 |
| §9 compress then auto-scroll | 4 (cap lifted + floor kept) — **gap, see below** |
| §10 pointer + remote | 2 (chip clicks), 5 (rail), 6 (Player) |
| §11 data authoring | 8 (Act IV only; rest is a separate plan) |
| §12 invariants | Global Constraints |
| §13 testing | every task + 9 |

**Known gap, stated rather than hidden:** §9's *auto-scroll* is not implemented by
any task. Scoping the list to one group (Task 3) means five rows where there were
fourteen, and the measurements in §15 say 6–10 rows fit — so scrolling is
unreachable for this corpus and building it now would be speculative. If a later
work authors more beats than fit, add `scrollIntoView({ block: 'nearest' })` on the
sounding/selected row as its own task. **Do not** add it speculatively.

**Placeholder scan:** the only deliberate placeholders are Task 8's five beat
timestamps, explicitly flagged as pending the SRT snapping pass, with the file
path and the verification rule given.

**Type consistency:** `navReduce(state, action, world)` and `navSeekTarget(state, world)`
are used with those exact signatures in Tasks 1 and 5. `SURROUND_NAV_EVENT` is
imported in Tasks 5 and 6. `chipRuns` entries are `railGroups` output
(`{title, mini, index, from, count, span}`) and are consumed as `{index, from, count}`
by the reducer's `world.groups` — consistent.
