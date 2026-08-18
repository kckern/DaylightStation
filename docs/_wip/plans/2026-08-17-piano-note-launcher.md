# Piano Note Launcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the nine per-game MIDI activation combos on the office-screen piano with a single combo that opens a note-driven game launcher, and hoist the shared pieces out of `PianoKiosk/` so the office screen never imports from the kiosk.

**Architecture:** A new `game-platform/launcher/` module owns a pure note-map (`launcherNotes.js`), a state-machine hook (`useNoteLauncher.js`), and a keyboard-shaped overlay (`NoteLauncher.jsx`). `PianoVisualizer.jsx` mounts it and drops `useGameActivation.js` entirely. The icon set moves from `PianoKiosk/icons/` to `modules/Piano/ui/icons/` first, so the dependency arrow points out of the kiosk rather than into it.

**Tech Stack:** React 18, Vite, Vitest + @testing-library/react, SCSS. Tests run from the worktree root with `npx vitest run <path>` — running from `frontend/` breaks `import.meta.url` resolution and produces spurious failures.

**Export convention for the new modules:** components (`.jsx`) default-export; everything else is named-export only. One import form per symbol.

**Worktree:** `.worktrees/piano-note-launcher` on branch `feature/piano-note-launcher`, branched from `main` @ `8279851a5`. `node_modules` and `frontend/node_modules` are symlinked to the main checkout — do not run `npm install`.

---

## Background you need before starting

**Two surfaces share this code.**

- **Office screen** — `frontend/src/screen-framework/` mounts `PianoVisualizer` as an overlay widget (registered as `piano` in `screen-framework/widgets/builtins.js`) when the MIDI WebSocket fires. No touch, no router. Background is `#d9d0c1` (warm bone) — see `PianoVisualizer.scss:7`.
- **Piano kiosk** — `frontend/src/modules/Piano/PianoKiosk/`, the tablet. Touch-first, routed, has its own `modes/Games/Games.jsx` picker. **This plan does not change kiosk behavior.** The kiosk keeps its touch picker.

**How game activation works today (and why it's being replaced).** `useGameActivation.js` reads the `games:` map from piano config and, for each game, checks whether that game's two-note combo is held (`isActivationComboHeld`). Live config at `data/household/piano/config.yml` defines five: `space-invaders` (F#1+F#7), `tetris` (G1+G7), `flashcards` (F1+F7), `hero` (G#1+G#7), `side-scroller` (E1+E7). Re-pressing the same combo toggles the game off.

**Critical fact:** the registry (`gameRegistry.js`) has **nine** games, but only those **five** appear in config — so `chess`, `connect-four`, `checkers`, and `card-game` are currently unreachable from the office screen. The launcher drives off the **registry**, not config, so it newly exposes chess, connect-four, and checkers there. This is intended. Verified safe: `PianoChessGame.jsx:194` defaults `gameConfig = null` and derives its own defaults; `PianoConnectFour.jsx` and `PianoCheckers.jsx` never read `gameConfig`. `card-game` is `status: 'preview'` and is filtered out.

**Design decisions already settled (do not re-litigate):**

1. Nine white keys, C4–D5: `[60, 62, 64, 65, 67, 69, 71, 72, 74]`.
2. Slots bind to **visible tiles in registry order**; `status !== 'released'` games are omitted entirely.
3. Combo is the lowest + highest key of the configured range (`[21, 108]`), held within 300ms.
4. Combo **press toggles** the launcher. Combo **held past 2s** force-exits to free-play.
5. **Dismissing the launcher returns you to whatever was running.** This refines the diagram approved during design: an accidental combo mid-Tetris must not cost you the game. Only hold-to-exit force-quits. Timeout, escape, and combo-tap are all "never mind" and restore the prior state.
6. 30s timeout is **absolute from open** — playing notes does not reset it. Noodling over an open menu *is* the "I'm just playing" signal.
7. Layout is **one row of N**, not `balancedColumns`. A 5+4 wrap would sever the 1:1 key mapping that makes the interaction self-explanatory.
8. Roboto Condensed only — it is the app's canonical face. Personality comes from weight, tracking, color, and motion, never a second typeface.

---

## Task 1: Hoist the icon set out of the kiosk

Pure mechanical move, its own commit, no behavior change. The launcher needs `Icon`, and `game-platform/` importing from `PianoKiosk/` is the dependency direction this whole exercise exists to fix. Two files already reach into the kiosk for icons from outside it (`Apps/PianoApp.jsx`, `PianoHeroGame/PianoHeroGame.jsx`) — this fixes those too.

**Files:**
- Move: `frontend/src/modules/Piano/PianoKiosk/icons/` → `frontend/src/modules/Piano/ui/icons/`
- Modify: every file importing it (enumerated by the grep in Step 2)

**Step 1: Record the current test baseline**

```bash
npx vitest run frontend/src/modules/Piano frontend/src/Apps 2>&1 | tail -5
```

Write down the passed/failed counts. Task 1 must not change them.

**Step 2: List every importer**

```bash
grep -rn "icons/Icon" frontend/src --include='*.jsx' --include='*.js' | grep -v "modules/School"
```

`grep -v "modules/School"` matters: `modules/School/home/icons/Icon.jsx` is a **separate** icon set. Do not touch School.

Filter on `modules/School`, not on `home/icons`: School's importers sit at `School/home/SchoolHome.jsx` and import `./icons/Icon.jsx`, so the matching line contains `home/SchoolHome.jsx` — a `home/icons` filter misses every one of them and leaves six hits that look like failures.

**Step 3: Move the directory**

```bash
mkdir -p frontend/src/modules/Piano/ui
git mv frontend/src/modules/Piano/PianoKiosk/icons frontend/src/modules/Piano/ui/icons
```

**Step 4: Rewrite the import specifiers**

Four distinct relative forms exist. Apply each to its own set of files:

```bash
cd frontend/src

# Kiosk root (PianoTile, PianoChrome, SoundPanel, OperatorDrawer + their tests):
#   './icons/Icon.jsx' -> '../ui/icons/Icon.jsx'
grep -rl "'\./icons/Icon.jsx'" modules/Piano/PianoKiosk --include=*.jsx --include=*.js \
  | xargs sed -i '' "s|'\./icons/Icon\.jsx'|'../ui/icons/Icon.jsx'|g"

# One level down (transport/, modes/*/ at depth 1):
#   '../icons/Icon.jsx' -> '../../ui/icons/Icon.jsx'
grep -rl "'\.\./icons/Icon.jsx'" modules/Piano/PianoKiosk --include=*.jsx --include=*.js \
  | xargs sed -i '' "s|'\.\./icons/Icon\.jsx'|'../../ui/icons/Icon.jsx'|g"

# Two levels down (modes/Studio/, modes/Music/, modes/Videos/, modes/SheetMusic/, modes/Karaoke/):
#   '../../icons/Icon.jsx' -> '../../../ui/icons/Icon.jsx'
grep -rl "'\.\./\.\./icons/Icon.jsx'" modules/Piano/PianoKiosk --include=*.jsx --include=*.js \
  | xargs sed -i '' "s|'\.\./\.\./icons/Icon\.jsx'|'../../../ui/icons/Icon.jsx'|g"

cd ../..
```

Then the two cross-module importers by hand:

- `frontend/src/modules/Piano/PianoHeroGame/PianoHeroGame.jsx`: `'../PianoKiosk/icons/Icon.jsx'` → `'../ui/icons/Icon.jsx'`
- `frontend/src/Apps/PianoApp.jsx`: `'../modules/Piano/PianoKiosk/icons/Icon.jsx'` → `'../modules/Piano/ui/icons/Icon.jsx'`
- `frontend/src/Apps/PianoConnectGate.test.jsx`: same rewrite inside its `vi.mock(...)` first argument.

**Step 5: Verify nothing still points at the old path**

```bash
grep -rn "PianoKiosk/icons\|'\./icons/Icon\|'\.\./icons/Icon\|'\.\./\.\./icons/Icon" frontend/src \
  | grep -v "modules/School"
```

Expected: **no output.** Any hit is a missed importer — `vi.mock` calls inside test files are easy to miss because they use the specifier as a string argument, not an `import`.

**Step 6: Run the full piano + apps suite**

```bash
npx vitest run frontend/src/modules/Piano frontend/src/Apps 2>&1 | tail -8
```

Expected: identical counts to Step 1. `Icon.jsx` uses `import.meta.glob('./svg/*.svg')`, which resolves relative to the file — moving the directory keeps the SVGs alongside it, so the glob still works.

**Step 7: Verify the production build still resolves**

```bash
npm run build --prefix frontend 2>&1 | tail -15
```

Expected: build succeeds. Vitest mocks can mask a broken specifier that Vite would reject; this catches it.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor(piano): hoist icon set from PianoKiosk to modules/Piano/ui

The icon set was already being reached into from outside the kiosk by
PianoApp and PianoHeroGame. The note launcher needs it too, and
game-platform importing from PianoKiosk is the wrong direction.

Pure move + specifier rewrite; no behavior change."
```

---

## Task 2: Move the combo predicate into the input layer

`isActivationComboHeld` lives in `PianoSpaceInvaders/spaceInvadersEngine.js:73` and is imported *out of a game* by `useGameActivation.js`. The launcher needs it. A shared predicate should not live inside Space Invaders.

**Files:**
- Create: `frontend/src/modules/Piano/game-platform/input/combo.js`
- Create: `frontend/src/modules/Piano/game-platform/input/combo.test.js`
- Modify: `frontend/src/modules/Piano/PianoSpaceInvaders/spaceInvadersEngine.js` (delete the function)
- Modify: `frontend/src/modules/Piano/useGameActivation.js` (repoint import — this file is deleted in Task 6, but must stay green until then)

**Step 1: Write the failing test**

Create `frontend/src/modules/Piano/game-platform/input/combo.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isComboHeld } from './combo.js';

const notes = (entries) => new Map(entries.map(([n, t]) => [n, { velocity: 100, timestamp: t }]));

describe('isComboHeld', () => {
  it('is true when every combo note is down within the window', () => {
    expect(isComboHeld(notes([[21, 1000], [108, 1120]]), [21, 108], 300)).toBe(true);
  });

  it('is false when a combo note is missing', () => {
    expect(isComboHeld(notes([[21, 1000]]), [21, 108], 300)).toBe(false);
  });

  it('is false when the notes are down but too far apart in time', () => {
    expect(isComboHeld(notes([[21, 1000], [108, 1400]]), [21, 108], 300)).toBe(false);
  });

  it('ignores unrelated notes that are also down', () => {
    expect(isComboHeld(notes([[21, 1000], [60, 1050], [108, 1100]]), [21, 108], 300)).toBe(true);
  });

  it('is false for an empty or missing combo', () => {
    expect(isComboHeld(notes([[21, 1000]]), [], 300)).toBe(false);
    expect(isComboHeld(notes([[21, 1000]]), null, 300)).toBe(false);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run frontend/src/modules/Piano/game-platform/input/combo.test.js
```

Expected: FAIL — `Failed to resolve import "./combo.js"`.

**Step 3: Create the module**

`frontend/src/modules/Piano/game-platform/input/combo.js`:

```js
/**
 * True when every note in `comboNotes` is currently down AND they were struck
 * within `windowMs` of each other — i.e. played as a deliberate chord rather
 * than arrived at by chance while playing.
 *
 * Lived in PianoSpaceInvaders/spaceInvadersEngine.js until the note launcher
 * needed it too; a shared input predicate does not belong inside one game.
 *
 * @param {Map<number, {velocity: number, timestamp: number}>} activeNotes
 * @param {number[]} comboNotes - MIDI note numbers that must all be held
 * @param {number} windowMs - max spread between the first and last strike
 */
export function isComboHeld(activeNotes, comboNotes, windowMs) {
  if (!comboNotes || comboNotes.length === 0) return false;

  const timestamps = [];
  for (const note of comboNotes) {
    const active = activeNotes.get(note);
    if (!active) return false;
    timestamps.push(active.timestamp);
  }

  const span = Math.max(...timestamps) - Math.min(...timestamps);
  return span <= windowMs;
}
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run frontend/src/modules/Piano/game-platform/input/combo.test.js
```

Expected: PASS, 5 tests.

**Step 5: Delete the old copy and repoint its callers**

Remove the `isActivationComboHeld` function (and its doc comment) from `frontend/src/modules/Piano/PianoSpaceInvaders/spaceInvadersEngine.js`. Find every caller:

```bash
grep -rn "isActivationComboHeld" frontend/src
```

Repoint each to `isComboHeld` from `game-platform/input/combo.js`. Expect hits in `useGameActivation.js` and possibly `spaceInvadersEngine`'s own test file — if a test covers it there, delete those cases (they now live in `combo.test.js`) rather than duplicating coverage.

**Step 6: Verify**

```bash
npx vitest run frontend/src/modules/Piano 2>&1 | tail -8
grep -rn "isActivationComboHeld" frontend/src
```

Expected: suite green, grep silent.

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor(piano): move combo predicate into game-platform/input

isActivationComboHeld lived inside Space Invaders and was imported out of
it by the shared activation hook. Renamed to isComboHeld and given a home
in the input layer, with direct unit coverage."
```

---

## Task 3: The pure note map

No React. This is where the note sequence, the released-only filter, the registry ordering, and the black-key math live.

**Files:**
- Create: `frontend/src/modules/Piano/game-platform/launcher/launcherNotes.js`
- Create: `frontend/src/modules/Piano/game-platform/launcher/launcherNotes.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { LAUNCHER_NOTES, buildLauncherSlots, slotForNote } from './launcherNotes.js';

const game = (id, status = 'released') => ({ id, label: id.toUpperCase(), icon: `game-${id}`, status });

describe('LAUNCHER_NOTES', () => {
  it('is the nine white keys from middle C to D5', () => {
    expect(LAUNCHER_NOTES).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74]);
  });
});

describe('buildLauncherSlots', () => {
  it('binds released games to notes in registry order, starting at middle C', () => {
    const { slots } = buildLauncherSlots([game('a'), game('b'), game('c')]);
    expect(slots.map(s => s.gameId)).toEqual(['a', 'b', 'c']);
    expect(slots.map(s => s.note)).toEqual([60, 62, 64]);
    expect(slots.map(s => s.noteName)).toEqual(['C4', 'D4', 'E4']);
  });

  it('omits games that are not released, and does not leave a gap in the notes', () => {
    const { slots } = buildLauncherSlots([game('a'), game('b', 'preview'), game('c')]);
    expect(slots.map(s => s.gameId)).toEqual(['a', 'c']);
    expect(slots.map(s => s.note)).toEqual([60, 62]);
  });

  it('carries the label and icon through for rendering', () => {
    const { slots } = buildLauncherSlots([game('tetris')]);
    expect(slots[0]).toMatchObject({ label: 'TETRIS', icon: 'game-tetris' });
  });

  it('marks which keys have a black key after them, from the note math', () => {
    const { slots } = buildLauncherSlots(Array.from({ length: 9 }, (_, i) => game(`g${i}`)));
    // C D E F G A B C D -> sharps after C, D, F, G, A, C. None after E or B.
    expect(slots.map(s => s.sharpAfter))
      .toEqual([true, true, false, true, true, true, false, true, false]);
  });

  it('drops games past the ninth and reports them rather than truncating silently', () => {
    const { slots, dropped } = buildLauncherSlots(
      Array.from({ length: 11 }, (_, i) => game(`g${i}`))
    );
    expect(slots).toHaveLength(9);
    expect(dropped).toEqual(['g9', 'g10']);
  });

  it('handles an empty registry without throwing', () => {
    expect(buildLauncherSlots([])).toEqual({ slots: [], dropped: [] });
    expect(buildLauncherSlots(null)).toEqual({ slots: [], dropped: [] });
  });
});

describe('slotForNote', () => {
  const { slots } = buildLauncherSlots([game('a'), game('b')]);

  it('finds the slot bound to a note', () => {
    expect(slotForNote(slots, 62)?.gameId).toBe('b');
  });

  it('returns null for a note no slot is bound to', () => {
    expect(slotForNote(slots, 61)).toBeNull();  // C#4 — a black key
    expect(slotForNote(slots, 64)).toBeNull();  // E4 — in range, but only 2 slots exist
    expect(slotForNote(slots, 21)).toBeNull();  // a combo key
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run frontend/src/modules/Piano/game-platform/launcher/launcherNotes.test.js
```

Expected: FAIL — cannot resolve `./launcherNotes.js`.

**Step 3: Write the implementation**

```js
/**
 * The note map behind the office-screen game launcher.
 *
 * One combo opens the launcher; one white key picks a game. The nine keys are
 * middle C up to D5 — the span a hand finds without looking, and enough for
 * every released game in the registry.
 */

/** The nine white keys, C4 through D5. */
export const LAUNCHER_NOTES = Object.freeze([60, 62, 64, 65, 67, 69, 71, 72, 74]);

const NOTE_NAMES = Object.freeze(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5']);

/**
 * Pair each released game with a launcher key, in registry order.
 *
 * Unreleased games are omitted rather than greyed: a key that does nothing is
 * worse than a key that isn't there, because the player has no way to tell a
 * dead tile from a missed note.
 *
 * Games past the ninth are dropped and returned in `dropped` so the caller can
 * log it. Silent truncation would read as "everything is here" when it isn't —
 * that list is the signal to widen LAUNCHER_NOTES.
 *
 * @param {Array<{id: string, label?: string, icon?: string, status?: string}>} games
 * @returns {{slots: Array<Object>, dropped: string[]}}
 */
export function buildLauncherSlots(games) {
  if (!Array.isArray(games)) return { slots: [], dropped: [] };

  const released = games.filter((g) => g?.status === 'released');
  const dropped = released.slice(LAUNCHER_NOTES.length).map((g) => g.id);

  const slots = released.slice(0, LAUNCHER_NOTES.length).map((g, i) => ({
    gameId: g.id,
    label: g.label ?? g.id,
    icon: g.icon ?? 'game',
    note: LAUNCHER_NOTES[i],
    noteName: NOTE_NAMES[i],
    // Whether a black key sits between this white key and the next. Derived
    // from the interval, not hardcoded: a whole step has a sharp between, a
    // half step (E-F, B-C) does not. The last key has no "next".
    sharpAfter: i < LAUNCHER_NOTES.length - 1 && LAUNCHER_NOTES[i + 1] - LAUNCHER_NOTES[i] === 2,
  }));

  return { slots, dropped };
}

/** The slot bound to `note`, or null. Notes outside the map are ignorable noise. */
export function slotForNote(slots, note) {
  return slots?.find((s) => s.note === note) ?? null;
}
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run frontend/src/modules/Piano/game-platform/launcher/launcherNotes.test.js
```

Expected: PASS, 9 tests.

Note on the `sharpAfter` expectation: the ninth slot is D5, the last entry, so `sharpAfter` is `false` there by the `i < length - 1` guard even though a D#5 exists on a real keyboard. That is correct — there is no tenth key to put it between.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/game-platform/launcher/
git commit -m "feat(piano): add the launcher note map

Nine white keys C4-D5 bound to released registry games in order.
Pure, no React. Overflow past nine is reported, not silently dropped."
```

---

## Task 4: The launcher state machine

**Files:**
- Create: `frontend/src/modules/Piano/game-platform/launcher/useNoteLauncher.js`
- Create: `frontend/src/modules/Piano/game-platform/launcher/useNoteLauncher.test.js`

### The state machine, precisely

Three states, tracked as two pieces of React state (`isOpen`, `activeGameId`):

| From | Trigger | To |
|---|---|---|
| any | combo pressed (both notes, within window), launcher closed | launcher open |
| launcher open | combo pressed again | launcher closed, `activeGameId` **unchanged** |
| any | combo held continuously ≥ 2000ms | launcher closed, `activeGameId` = null |
| launcher open | note-on matching a slot | launcher closed, `activeGameId` = that game |
| launcher open | 30000ms since open | launcher closed, `activeGameId` **unchanged** |
| launcher open | `dismiss()` called (escape) | launcher closed, `activeGameId` **unchanged** |

Two rules that are easy to get wrong:

- **One combo press = one toggle.** The effect re-runs on every `activeNotes` change, and `isComboHeld` stays true for as long as the keys are down, so the toggle must latch until **both** combo notes are released. Track this in a ref.
- **Only newly-struck notes select.** If a slot note was already down when the launcher opened, it must not immediately select that game. Diff the current note set against the previous one and act only on additions.

**Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNoteLauncher } from './useNoteLauncher.js';
import { buildLauncherSlots } from './launcherNotes.js';

vi.mock('../../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

const { slots } = buildLauncherSlots([
  { id: 'invaders', label: 'Invaders', icon: 'i', status: 'released' },
  { id: 'tetris', label: 'Tetris', icon: 't', status: 'released' },
]);

/** Build an activeNotes Map. All notes share a timestamp so combos read as held. */
const notes = (...nums) => new Map(nums.map(n => [n, { velocity: 100, timestamp: Date.now() }]));

function setup() {
  return renderHook(
    ({ activeNotes }) => useNoteLauncher({ activeNotes, slots }),
    { initialProps: { activeNotes: new Map() } }
  );
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('useNoteLauncher', () => {
  it('starts closed with no game', () => {
    const { result } = setup();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeGameId).toBeNull();
  });

  it('opens when the lowest and highest keys are struck together', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    expect(result.current.isOpen).toBe(true);
  });

  it('does not re-toggle while the combo keys stay down', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: notes(21, 108, 64) });   // still held, extra note
    expect(result.current.isOpen).toBe(true);
  });

  it('closes when the combo is released and pressed again', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });
    expect(result.current.isOpen).toBe(false);
  });

  it('launches the game bound to a struck key', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(62) });            // D4 -> tetris
    expect(result.current.activeGameId).toBe('tetris');
    expect(result.current.isOpen).toBe(false);
  });

  it('ignores notes no key is bound to, so you can noodle over the menu', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(61) });            // C#4 - unbound
    rerender({ activeNotes: notes(64) });            // E4  - in range, but only 2 slots
    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeGameId).toBeNull();
  });

  it('picks the lowest note when several are struck at once', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(62, 60) });
    expect(result.current.activeGameId).toBe('invaders');   // C4 wins
  });

  it('does not select a slot note that was already down when it opened', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(60) });                   // C4 held first
    rerender({ activeNotes: notes(60, 21, 108) });          // then the combo
    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeGameId).toBeNull();
  });

  it('closes on the 30s timeout and leaves the running game alone', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(60) });                   // start invaders
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });              // reopen over the game
    rerender({ activeNotes: new Map() });
    expect(result.current.isOpen).toBe(true);

    act(() => { vi.advanceTimersByTime(30000); });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeGameId).toBe('invaders');   // game survives
  });

  it('does not reset the timeout when you play unbound notes', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });

    act(() => { vi.advanceTimersByTime(20000); });
    rerender({ activeNotes: notes(61) });                   // noodle
    rerender({ activeNotes: new Map() });
    act(() => { vi.advanceTimersByTime(10000); });

    expect(result.current.isOpen).toBe(false);
  });

  it('holding the combo for 2s quits to free-play', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(60) });                   // start invaders
    expect(result.current.activeGameId).toBe('invaders');

    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });              // press and hold
    expect(result.current.isHolding).toBe(true);

    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.activeGameId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it('a released combo is a tap, not a hold', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    act(() => { vi.advanceTimersByTime(500); });
    rerender({ activeNotes: new Map() });
    expect(result.current.isHolding).toBe(false);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.isOpen).toBe(true);               // still open, not quit
  });

  it('dismiss() closes without disturbing the running game', () => {
    const { result, rerender } = setup();
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(60) });
    rerender({ activeNotes: new Map() });
    rerender({ activeNotes: notes(21, 108) });
    rerender({ activeNotes: new Map() });

    act(() => { result.current.dismiss('escape'); });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.activeGameId).toBe('invaders');
  });

  it('honours an initialGame for URL deep-links', () => {
    const { result } = renderHook(() =>
      useNoteLauncher({ activeNotes: new Map(), slots, initialGame: 'tetris' })
    );
    expect(result.current.activeGameId).toBe('tetris');
    expect(result.current.isOpen).toBe(false);
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run frontend/src/modules/Piano/game-platform/launcher/useNoteLauncher.test.js
```

Expected: FAIL — cannot resolve `./useNoteLauncher.js`.

**Step 3: Write the implementation**

```js
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { isComboHeld } from '../input/combo.js';
import { slotForNote } from './launcherNotes.js';

/** Lowest and highest keys of an 88-key board. Override via options for a short board. */
export const DEFAULT_COMBO_NOTES = Object.freeze([21, 108]);

const DEFAULTS = {
  comboNotes: DEFAULT_COMBO_NOTES,
  comboWindowMs: 300,
  timeoutMs: 30000,
  holdExitMs: 2000,
};

/**
 * The office-screen game launcher: one combo in, one white key out.
 *
 * Replaces the per-game activation combos that used to live in
 * useGameActivation.js. Nine two-note combos were more than anyone could hold
 * in their head, and every new game needed another one.
 *
 * Dismissing the launcher restores whatever was running — an accidental combo
 * mid-game must not cost you the game. Only holding the combo quits.
 */
export function useNoteLauncher({ activeNotes, slots, initialGame = null, options = {} }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-launcher' }), []);
  const { comboNotes, comboWindowMs, timeoutMs, holdExitMs } = { ...DEFAULTS, ...options };

  const [isOpen, setIsOpen] = useState(false);
  const [activeGameId, setActiveGameId] = useState(initialGame);
  const [isHolding, setIsHolding] = useState(false);

  // Latches on combo press, clears when BOTH combo keys are up. Without it the
  // effect re-toggles on every activeNotes change for as long as they're held.
  const comboLatchedRef = useRef(false);
  const holdTimerRef = useRef(null);
  const timeoutTimerRef = useRef(null);
  // Notes already down are not "struck" — diffing against this is what stops a
  // held key from selecting a game the instant the launcher opens.
  const prevNotesRef = useRef(new Set());

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, []);

  const close = useCallback((reason) => {
    setIsOpen((open) => {
      if (open) logger.info('launcher.dismissed', { reason });
      return false;
    });
  }, [logger]);

  const dismiss = useCallback((reason = 'escape') => close(reason), [close]);

  // ─── Auto-close timer: absolute from open, deliberately not reset by play ──
  useEffect(() => {
    if (!isOpen) return undefined;
    timeoutTimerRef.current = setTimeout(() => close('timeout'), timeoutMs);
    return () => {
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    };
  }, [isOpen, timeoutMs, close]);

  // ─── Combo: tap toggles the launcher, hold quits to free-play ──────────────
  useEffect(() => {
    const held = isComboHeld(activeNotes, comboNotes, comboWindowMs);

    if (held && !comboLatchedRef.current) {
      comboLatchedRef.current = true;
      setIsHolding(true);
      setIsOpen((open) => {
        logger.info(open ? 'launcher.dismissed' : 'launcher.opened', open ? { reason: 'combo' } : {});
        return !open;
      });
      holdTimerRef.current = setTimeout(() => {
        logger.info('launcher.exit-to-free-play', {});
        setIsOpen(false);
        setActiveGameId(null);
        setIsHolding(false);
      }, holdExitMs);
      return;
    }

    if (!held && comboLatchedRef.current) {
      const anyComboKeyDown = comboNotes.some((n) => activeNotes.has(n));
      if (!anyComboKeyDown) {
        comboLatchedRef.current = false;
        clearHoldTimer();
        setIsHolding(false);
      }
    }
  }, [activeNotes, comboNotes, comboWindowMs, holdExitMs, logger, clearHoldTimer]);

  // ─── Selection: only NEWLY struck notes count ──────────────────────────────
  useEffect(() => {
    const current = new Set(activeNotes.keys());
    const struck = [...current].filter((n) => !prevNotesRef.current.has(n)).sort((a, b) => a - b);
    prevNotesRef.current = current;

    if (!isOpen || struck.length === 0) return;

    for (const note of struck) {                    // lowest first
      const slot = slotForNote(slots, note);
      if (!slot) continue;
      logger.info('launcher.game-selected', { gameId: slot.gameId, note });
      setActiveGameId(slot.gameId);
      setIsOpen(false);
      return;
    }
  }, [activeNotes, isOpen, slots, logger]);

  useEffect(() => clearHoldTimer, [clearHoldTimer]);

  return { isOpen, activeGameId, isHolding, dismiss, timeoutMs };
}
```

**Step 4: Run it and watch it pass**

```bash
npx vitest run frontend/src/modules/Piano/game-platform/launcher/useNoteLauncher.test.js
```

Expected: PASS, 14 tests.

If "does not select a slot note that was already down" fails, the selection effect ran before `prevNotesRef` was seeded. Both effects run on the same render; the selection effect must record `prevNotesRef` on **every** run including the ones where `isOpen` is false — check that the `prevNotesRef.current = current` assignment happens **before** the `if (!isOpen)` guard.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/game-platform/launcher/
git commit -m "feat(piano): add the note-launcher state machine

One combo toggles the launcher; a white key picks a game; holding the
combo for 2s quits to free-play. Dismissing restores whatever was
running, so an accidental combo mid-game doesn't cost you the game."
```

---

## Task 5: The launcher overlay

The menu *is* a keyboard — nine tall keys, black-key slivers in the gaps, note name engraved on each key face. One row of N, never wrapped: wrapping would sever the 1:1 mapping to the physical keys, which is the whole reason the interaction needs no instructions.

**Files:**
- Create: `frontend/src/modules/Piano/game-platform/launcher/NoteLauncher.jsx`
- Create: `frontend/src/modules/Piano/game-platform/launcher/NoteLauncher.scss`
- Create: `frontend/src/modules/Piano/game-platform/launcher/NoteLauncher.test.jsx`

**Step 1: Write the failing test**

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import NoteLauncher from './NoteLauncher.jsx';
import { buildLauncherSlots } from './launcherNotes.js';

const build = (n) => buildLauncherSlots(
  Array.from({ length: n }, (_, i) => ({
    id: `g${i}`, label: `Game ${i}`, icon: `game-${i}`, status: 'released',
  }))
).slots;

describe('NoteLauncher', () => {
  it('renders one key per slot', () => {
    const { container } = render(<NoteLauncher slots={build(9)} />);
    expect(container.querySelectorAll('.nl-key')).toHaveLength(9);
  });

  it('engraves the note name on each key face, in order', () => {
    const { container } = render(<NoteLauncher slots={build(9)} />);
    const names = [...container.querySelectorAll('.nl-key__note')].map(n => n.textContent);
    expect(names).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5']);
  });

  it('shows each game label', () => {
    const { getByText } = render(<NoteLauncher slots={build(3)} />);
    expect(getByText('Game 0')).toBeTruthy();
    expect(getByText('Game 2')).toBeTruthy();
  });

  it('puts a black key only where a black key belongs', () => {
    const { container } = render(<NoteLauncher slots={build(9)} />);
    const sharps = [...container.querySelectorAll('.nl-key')].map(k => k.classList.contains('has-sharp'));
    expect(sharps).toEqual([true, true, false, true, true, true, false, true, false]);
  });

  it('tells the layout how many keys to divide the row into', () => {
    const { container } = render(<NoteLauncher slots={build(6)} />);
    expect(container.querySelector('.note-launcher__keys').style.getPropertyValue('--key-count')).toBe('6');
  });

  it('marks the hold-to-quit state so the ring can animate', () => {
    const { container, rerender } = render(<NoteLauncher slots={build(3)} isHolding={false} />);
    expect(container.querySelector('.note-launcher__hold')).toBeNull();
    rerender(<NoteLauncher slots={build(3)} isHolding />);
    expect(container.querySelector('.note-launcher__hold')).toBeTruthy();
  });

  it('is announced as a dialog', () => {
    const { getByRole } = render(<NoteLauncher slots={build(3)} />);
    expect(getByRole('dialog')).toBeTruthy();
  });
});
```

**Step 2: Run it and watch it fail**

```bash
npx vitest run frontend/src/modules/Piano/game-platform/launcher/NoteLauncher.test.jsx
```

Expected: FAIL — cannot resolve `./NoteLauncher.jsx`.

**Step 3: Write the component**

```jsx
import Icon from '../../ui/icons/Icon.jsx';
import './NoteLauncher.scss';

/**
 * The office-screen game launcher, drawn as the thing it is: a keyboard.
 *
 * Each game is a white key with its note engraved on the face, in the place
 * your eye already looks for it. Nothing explains the interaction because
 * nothing needs to — you see the key, you play the key.
 *
 * One row always, never wrapped. Wrapping to a 5+4 grid would break the 1:1
 * correspondence with the keys under the player's hands, which is the only
 * reason this reads without instructions.
 */
export default function NoteLauncher({ slots = [], isHolding = false, timeoutMs = 30000 }) {
  return (
    <div className="note-launcher" role="dialog" aria-label="Pick a game">
      <div className="note-launcher__head">
        <span className="note-launcher__title">Pick a game · play its key</span>
        <div className="note-launcher__timer" aria-hidden="true">
          <i style={{ animationDuration: `${timeoutMs}ms` }} />
        </div>
      </div>

      <ul className="note-launcher__keys" style={{ '--key-count': slots.length }}>
        {slots.map((slot, i) => (
          <li
            key={slot.gameId}
            className={`nl-key${slot.sharpAfter ? ' has-sharp' : ''}`}
            style={{ '--key-index': i }}
          >
            <Icon name={slot.icon} className="nl-key__icon" />
            <span className="nl-key__label">{slot.label}</span>
            <span className="nl-key__note">{slot.noteName}</span>
          </li>
        ))}
      </ul>

      {isHolding && <div className="note-launcher__hold" aria-hidden="true" />}
    </div>
  );
}
```

**Step 4: Write the stylesheet**

Palette derived from the instrument's own materials, and reachable from the app's existing `#d9d0c1` by driving value down rather than flipping hue — a scrim, not a jarring theme swap. The app's teal (`#2a7a73`) is deliberately absent: this is a takeover surface, not a panel.

```scss
// The launcher is a keyboard at monumental scale. Colours come from the
// instrument: walnut case, ivory key faces, ebony sharps, damper-felt crimson,
// brass hardware. The visualiser under it is #d9d0c1 — the same warm hue this
// ground is, driven down in value, so the overlay reads as a dimming rather
// than a different app.
.note-launcher {
  --case:   #241E18;
  --ivory:  #EFE7D8;
  --ebony:  #17120E;
  --felt:   #8E2A2C;
  --brass:  #C08B3E;

  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: var(--case);
  font-family: 'Roboto Condensed', sans-serif;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
    padding: 1.75rem 2.5rem 0;
  }

  &__title {
    color: var(--ivory);
    opacity: 0.62;
    font-size: 1.1rem;
    font-weight: 400;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  // Time left, as a draining brass hairline. No number — the bar says it.
  &__timer {
    flex: 1;
    max-width: 22rem;
    height: 2px;
    background: rgba(192, 139, 62, 0.22);
    overflow: hidden;

    i {
      display: block;
      height: 100%;
      background: var(--brass);
      transform-origin: left center;
      animation: nl-drain linear forwards;
    }
  }

  &__keys {
    display: flex;
    align-items: stretch;
    gap: 0;
    margin: 0;
    padding: 0 2.5rem 2.5rem;
    list-style: none;
    height: 62%;
  }

  // Hold-to-quit: a brass ring closing over the 2s hold window.
  &__hold {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 7rem;
    height: 7rem;
    margin: -3.5rem 0 0 -3.5rem;
    border-radius: 50%;
    border: 3px solid rgba(192, 139, 62, 0.25);
    background: conic-gradient(var(--brass) 0turn, transparent 0turn);
    animation: nl-hold 2000ms linear forwards;
  }
}

.nl-key {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.9rem;
  padding: 2rem 0.6rem 1.4rem;
  background: linear-gradient(180deg, #F6F0E4 0%, var(--ivory) 62%, #DDD2BE 100%);
  color: var(--ebony);
  border-radius: 0 0 10px 10px;
  box-shadow: inset -1px 0 0 rgba(35, 27, 20, 0.18), 0 10px 26px rgba(0, 0, 0, 0.45);
  // Keys rise from the bottom edge in a left-to-right glissando on open.
  animation: nl-rise 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
  animation-delay: calc(var(--key-index) * 28ms);

  &:last-child { box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45); }

  // The black key between this white key and the next, hanging from the top
  // into the gap. Only rendered where the note math says one belongs.
  &.has-sharp::after {
    content: '';
    position: absolute;
    top: 0;
    right: calc(-1 * var(--sharp-w) / 2);
    width: var(--sharp-w);
    height: 46%;
    background: linear-gradient(180deg, #2C241D 0%, var(--ebony) 100%);
    border-radius: 0 0 4px 4px;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.55);
    z-index: 2;
    --sharp-w: 1.9rem;
  }

  &__icon {
    font-size: clamp(2rem, 3.4vw, 3.4rem);
    line-height: 1;
    color: var(--felt);
  }

  &__label {
    font-size: clamp(0.85rem, 1.15vw, 1.3rem);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: center;
    line-height: 1.15;
    // Long labels wrap rather than shove the key wider — every key is 1fr.
    overflow-wrap: anywhere;
  }

  // Engraved on the key face, where the eye already looks for it.
  &__note {
    margin-top: auto;
    font-size: clamp(1rem, 1.5vw, 1.6rem);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.08em;
    color: var(--brass);
  }
}

@keyframes nl-rise {
  from { transform: translateY(14%); opacity: 0; }
  to   { transform: none; opacity: 1; }
}

@keyframes nl-drain {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

@keyframes nl-hold {
  from { background: conic-gradient(var(--brass) 0turn, transparent 0turn); }
  to   { background: conic-gradient(var(--brass) 1turn, transparent 1turn); }
}

@media (prefers-reduced-motion: reduce) {
  .nl-key { animation: none; }
  .note-launcher__timer i,
  .note-launcher__hold { animation-duration: 0.01ms; }
}
```

**Step 5: Run the tests**

```bash
npx vitest run frontend/src/modules/Piano/game-platform/launcher/NoteLauncher.test.jsx
```

Expected: PASS, 7 tests. The icon test relies on the real `Icon.jsx` returning `null` for unknown names (`game-0` etc. don't exist) — that's fine, the assertions are on the key structure, not the SVG.

**Step 6: Commit**

```bash
git add frontend/src/modules/Piano/game-platform/launcher/
git commit -m "feat(piano): add the NoteLauncher overlay

The menu is a keyboard: one white key per game, note engraved on the
face, black keys only where the note math puts them. One row always —
wrapping would break the mapping to the keys under the player's hands."
```

---

## Task 6: Wire it into PianoVisualizer and retire the combos

**Files:**
- Modify: `frontend/src/modules/Piano/PianoVisualizer.jsx`
- Modify: `frontend/src/modules/Piano/PianoVisualizer.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoVisualizer.scss` (add `position: relative` if absent — the overlay is absolutely positioned; it is already set at line 2, so verify rather than add)
- Delete: `frontend/src/modules/Piano/useGameActivation.js`

**Step 1: Write the failing tests**

Add to `PianoVisualizer.test.jsx`. First replace the `useGameActivation` mock with a launcher mock — the old one refers to a file that will no longer exist:

```jsx
// replaces the useGameActivation mock
let launcherState = { isOpen: false, activeGameId: null, isHolding: false, dismiss: vi.fn(), timeoutMs: 30000 };
vi.mock('./game-platform/launcher/useNoteLauncher.js', () => ({
  useNoteLauncher: () => launcherState,
}));
```

Then add these cases:

```jsx
describe('PianoVisualizer game launcher', () => {
  it('shows no launcher while the player is just playing', () => {
    launcherState = { ...launcherState, isOpen: false, activeGameId: null };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.note-launcher')).toBeNull();
    expect(container.querySelector('.waterfall-container')).toBeTruthy();
  });

  it('renders the launcher over the free-play view when it opens', () => {
    launcherState = { ...launcherState, isOpen: true, activeGameId: null };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.note-launcher')).toBeTruthy();
  });

  it('builds one key per released registry game, and omits unreleased ones', () => {
    launcherState = { ...launcherState, isOpen: true, activeGameId: null };
    const { container } = render(<PianoVisualizer />);
    const keys = container.querySelectorAll('.nl-key');
    // Eight of the nine registered games are released; card-game is preview.
    expect(keys).toHaveLength(8);
    expect(container.textContent).not.toContain('Battle Stadium');
  });

  it('hides the waterfall and keyboard once a game is running', () => {
    launcherState = { ...launcherState, isOpen: false, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.waterfall-container')).toBeNull();
    expect(container.querySelector('.keyboard-container')).toBeNull();
  });
});
```

**Step 2: Run and watch them fail**

```bash
npx vitest run frontend/src/modules/Piano/PianoVisualizer.test.jsx
```

Expected: FAIL — cannot resolve `./game-platform/launcher/useNoteLauncher.js` is already satisfied by Task 4, so the real failures are the missing `.note-launcher` element.

**Step 3: Rewrite the activation section of PianoVisualizer.jsx**

Replace the imports:

```jsx
// remove:
import { useGameActivation } from './useGameActivation.js';
// add:
import { useNoteLauncher } from './game-platform/launcher/useNoteLauncher.js';
import { buildLauncherSlots } from './game-platform/launcher/launcherNotes.js';
import NoteLauncher from './game-platform/launcher/NoteLauncher.jsx';
import GameBoundary from './game-platform/host/GameBoundary.jsx';
```

Replace the activation block (currently lines 27-34):

```jsx
  // Launcher slots come from the REGISTRY, not the games config: config only
  // ever listed the five games that had activation combos, which is why chess,
  // connect-four and checkers were unreachable here. They take no config
  // (chess defaults gameConfig to null; the other two never read it).
  const { slots, dropped } = useMemo(
    () => buildLauncherSlots(getGameIds().map((id) => ({ id, ...getGameEntry(id) }))),
    []
  );

  const launcher = useNoteLauncher({ activeNotes, slots, initialGame });
  const { isOpen: launcherOpen, activeGameId } = launcher;

  const activeGameEntry = activeGameId ? getGameEntry(activeGameId) : null;
  const isFullscreenGame = activeGameEntry?.layout === 'replace';
```

Add the overflow warning next to the existing logger configuration effect:

```jsx
  useEffect(() => {
    if (dropped.length === 0) return;
    getChildLogger({ component: 'piano-launcher' })
      .warn('launcher.slots-overflow', { dropped });
  }, [dropped]);
```

(`getChildLogger` is already imported by sibling modules from `'../../lib/logging/singleton.js'`; add the import if `PianoVisualizer.jsx` doesn't have it.)

Update the inactivity timer so an open launcher counts as activity:

```jsx
  const { inactivityState, countdownProgress } =
    useInactivityTimer(activeNotes, noteHistory, isFullscreenGame || launcherOpen, onClose);
```

Update the escape interceptor so escape closes the launcher rather than the whole overlay:

```jsx
  useEffect(() => {
    if (!isFullscreenGame && !launcherOpen) return undefined;
    registerEscapeInterceptor(() => {
      if (launcherOpen) { launcher.dismiss('escape'); return true; }
      return true;   // a running game still swallows escape
    });
    return () => unregisterEscapeInterceptor();
  }, [isFullscreenGame, launcherOpen, launcher, registerEscapeInterceptor, unregisterEscapeInterceptor]);
```

Update the game mount to add `GameBoundary` — `PianoVisualizer` has never had one, so any throw inside a game currently blanks the whole office screen:

```jsx
      {isFullscreenGame && activeGameEntry?.LazyComponent && (
        <div className="tetris-fullscreen">
          <GameBoundary
            resetKey={activeGameId}
            label={activeGameEntry.label ?? 'This game'}
            onExit={() => launcher.dismiss('crash')}
          >
            <Suspense fallback={null}>
              <activeGameEntry.LazyComponent
                activeNotes={activeNotes}
                noteHistory={noteHistory}
                gameConfig={gamesConfig?.[activeGameId] ?? null}
                onDeactivate={() => launcher.dismiss('game-exit')}
              />
            </Suspense>
          </GameBoundary>
        </div>
      )}
```

Note: `onDeactivate` and the boundary's `onExit` both need to clear `activeGameId`, not just close the launcher. Extend the hook's return with an `exitGame()` callback (`setActiveGameId(null); setIsOpen(false);`) and use it here — add a test for it in `useNoteLauncher.test.js` alongside the `dismiss()` case.

Mount the launcher itself, just before the game block:

```jsx
      {launcherOpen && (
        <NoteLauncher slots={slots} isHolding={launcher.isHolding} timeoutMs={launcher.timeoutMs} />
      )}
```

Add the registry import if absent: `import { getGameEntry, getGameIds } from './gameRegistry.js';`

**Step 4: Run and watch them pass**

```bash
npx vitest run frontend/src/modules/Piano/PianoVisualizer.test.jsx
```

Expected: PASS. If the 8-key count fails, check `gameRegistry.js` — the count is "entries with `status: 'released'`", which is 8 today (`card-game` is `preview`).

**Step 5: Delete the dead hook**

```bash
git rm frontend/src/modules/Piano/useGameActivation.js
grep -rn "useGameActivation" frontend/src
```

Expected: grep silent. The localhost backtick dev shortcut lived there; it is not being reintroduced — the launcher is reachable in dev by sending the combo through the MIDI mock, and a shortcut that cycles games bypasses the very thing under test.

**Step 6: Run the whole piano suite plus a build**

```bash
npx vitest run frontend/src/modules/Piano frontend/src/screen-framework frontend/src/Apps 2>&1 | tail -8
npm run build --prefix frontend 2>&1 | tail -5
```

Expected: all green, build succeeds.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat(piano): one combo opens a note launcher, retiring per-game combos

Nine two-note combos were more than anyone could hold in their head. The
lowest and highest keys now open a launcher; a white key from C4 up picks
a game; holding the combo quits to free-play.

Slots come from the registry rather than config, so chess, connect-four
and checkers are reachable on the office screen for the first time. Games
also get a GameBoundary here, which PianoVisualizer never had — a throw
inside a game used to blank the whole screen."
```

---

## Task 7: Retire the dead config and update the docs

**Files:**
- Modify: `docs/reference/piano/piano-games.md` (lines ~122, ~184-208, ~216)
- Modify: `data/household/piano/config.yml` — **outside the repo**, in the Dropbox data tree

**Step 1: Update the docs**

In `docs/reference/piano/piano-games.md`:

- Line ~122: "A shared activation layer detects combo keypresses to launch games" → describe the single combo + note launcher.
- Replace the activation mechanism table (~184-191) with the launcher's rules: single combo `[21, 108]` / 300ms window, tap toggles, hold 2s quits, note C4–D5 selects, 30s absolute timeout, dismiss restores the running game.
- Replace the `activation:` YAML sample (~193-208) — it now documents config that nothing reads. Note explicitly that launcher slots come from `gameRegistry.js` (released only, registry order), **not** from the `games:` config map.
- Line ~216: the `PianoVisualizer` hook list mentions "game activation" — update to `useNoteLauncher`.

Check the other hit too:

```bash
grep -n "activation" docs/reference/piano/performance-assessment.md
```

If it refers to game-launch activation, update it; if it means note-onset activation in the assessment sense, leave it.

**Step 2: Verify no doc still describes per-game combos**

```bash
grep -rn "F#1\|G#1\|window_ms\|activation.notes" docs/reference/piano/
```

Expected: no hits describing launch combos.

**Step 3: Commit the docs**

```bash
git add docs/
git commit -m "docs(piano): describe the note launcher, retire the per-game combos"
```

**Step 4: Strip the dead config (data tree, not the repo)**

The five `activation:` blocks in `data/household/piano/config.yml` are now read by nothing. They are harmless but misleading — anyone reading that file would reasonably believe F#1+F#7 still launches Space Invaders.

This edits the user's live Dropbox data tree, so back it up first and **confirm with KC before running it**:

```bash
D="$DAYLIGHT_BASE_PATH/data/household/piano"
cp "$D/config.yml" "$D/config.yml.bak-$(date +%Y%m%d)"
grep -n -A2 "activation:" "$D/config.yml"     # 5 blocks, 3 lines each
```

Delete each `activation:` block and its two following lines. Verify the file still parses:

```bash
node -e "const y=require('js-yaml');const f=require('fs');y.load(f.readFileSync(process.env.DAYLIGHT_BASE_PATH+'/data/household/piano/config.yml','utf8'));console.log('parses OK')"
```

Config is cached in memory at startup (see `CLAUDE.md` § Config System) — the dev server needs a restart before the change is visible, though nothing reads these keys any more so there is nothing to observe.

---

## Verification before calling this done

**Automated:**

```bash
npx vitest run frontend/src/modules/Piano frontend/src/screen-framework frontend/src/Apps 2>&1 | tail -8
npm run build --prefix frontend 2>&1 | tail -5
npm run audit:layers
```

All three must pass. Paste the actual output — do not claim green without it.

**Compare test *names*, not counts.** `PianoKiosk/transport/noUnicodeGlyphs.test.js` discovers its cases by walking a directory with `readdirSync` and emitting one per `.jsx`, so moving a file in or out of that tree changes the case count with no failure — a coverage loss that reports as green. Task 1 hit exactly this. Any task that moves files under `modules/Piano/` must diff the test-name sets, not the totals.

**On the real office screen** (this is a MIDI-gesture feature; unit tests cannot confirm the gesture works on hardware):

1. Play anything → free-play visualizer appears as before, no launcher.
2. Strike the lowest and highest keys together → launcher opens, eight keys, note names C4–D5, glissando stagger left to right.
3. Play D4 → Tetris starts. Verify the game actually receives notes.
4. Strike the combo → launcher opens over Tetris. Wait 30s → launcher closes, **Tetris is still running**.
5. Strike the combo, keep holding → brass ring fills, at 2s you land back in free-play with no game.
6. Strike the combo, play a black key and some notes outside C4–D5 → nothing launches, launcher stays up, and it still times out on schedule (playing does not extend it).
7. Confirm chess, connect-four, and checkers launch and play — they have never run on this surface before, and they get `gameConfig: null`.

Step 7 is the one most likely to surface a real defect. Do not skip it.

---

## What this plan deliberately does not do

- **The kiosk keeps its touch picker.** `modes/Games/Games.jsx` is untouched. The launcher is an office-screen surface.
- **Video and content modes stay kiosk-only.** They assume touch, and inventing a no-touch vocabulary for them is a separate piece of work.
- **`PianoTile.jsx` and `tileGridLayout.js` stay in `PianoKiosk/`.** The original design hoisted them alongside the icons, but a launcher key is not a tile — it has its own component — and the launcher deliberately does not use `balancedColumns`. Moving them would churn kiosk call sites for nothing.
