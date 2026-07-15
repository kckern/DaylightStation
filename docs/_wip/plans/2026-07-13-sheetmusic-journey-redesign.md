# Sheet Music Journey Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Sheet Music mode's four-mode experience (Listen/Learn/Polish/Perform) around the practice journey — hear it, learn it, get it to tempo, perform it — instead of the current pile of disconnected controls.

**Architecture:** All work is frontend, inside `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` and `frontend/src/modules/MusicNotation/renderers/`. The existing two-plane transport, follow tracker, evaluator, and OSMD renderer are kept; what changes is the *wiring between them* (count-in, roles→audio, range persistence, completion paths) and the *chrome* (transport bar redesigned around per-mode task flows). New pure modules get co-located vitest tests; UI changes get RTL tests following the existing co-located `.test.jsx` patterns.

**Tech Stack:** React 18, vitest + @testing-library/react (co-located tests), OSMD (via `osmdRender.js`), WebAudio (via `click.js`/`clickScheduler.js`), Web MIDI via `PianoMidiContext`.

**Source audit:** `docs/_wip/audits/2026-07-13-sheetmusic-mode-audit.md` (findings H0–H5, M1–M8, J1–J7 referenced throughout).

**Branch/worktree:** Create a worktree off current `main` (after `git fetch origin`): branch `feature/sheetmusic-journey`. Do NOT build on `feature/ir-blaster`. Per-task commits on the feature branch are authorized (feedback_commit_policy_feature_branches). If running Playwright from the worktree, see memory `reference_worktree_playwright_port_trap` — unit tests (vitest) need nothing special.

---

# Part A — Design Brief (read this before any task)

## A1. Users and scenarios

The kiosk is a wall tablet (aging Samsung SM-T590, touch only) mounted at the family piano; the piano itself is the input device (BLE MIDI via Jamcorder). Users are household members of mixed ages and skill: kids mid-lessons, adults who play casually. Sessions are walk-up, 5–30 minutes, often unsupervised. Every control must therefore be:

- **Self-describing** — no icon-only mystery buttons. A 9-year-old who has never seen the bar must guess right.
- **Fat-finger safe** — big targets, no hidden two-tap state machines without on-screen guidance.
- **Stateless-tolerant** — a user who walks away mid-thing and comes back tomorrow should find their piece the way they left it.

Three scenarios cover ~100% of usage:

- **A. "Play it for me."** Hear the piece (demo for a kid, reference for a learner). Possibly noodle along.
- **B. "I'm learning this piece."** A multi-day arc: hear it → notes hands-separate, self-paced → hands together → trouble spots on loop → up to tempo → graded runs → performance. **This arc is the product.** Everything else supports it.
- **C. "I'm performing."** Score up, pedals turn pages, UI gets out of the way.

## A2. The ladder — per-mode journey contracts

Each mode has ONE job, an entry state, a success moment, and a designed exit toward the next rung. This table is the spec; tasks below implement it.

| | **Listen** | **Learn** | **Polish** | **Perform** |
|---|---|---|---|---|
| **Job** | Hear the piece; optionally play your part along with the kiosk | Acquire the notes at your own pace | Prove it at tempo, graded | Play it, zero assists |
| **Entry** | Default mode on open (J2). Big ▶. | From Listen or from a Polish "drill" handoff | From Learn ("Polish it →") carrying the practice range (J3) | Chosen deliberately |
| **Beat** | Kiosk's own performance IS the beat; count-in when user plays a part | None — self-paced by definition (click removed, J1) | Click audible during run, count-in measure first, tempo 50–150% (J1) | User's own |
| **Feedback** | Correct strikes light up (always-on; no toggle) | Cursor waits; wrong flashes; key reveal after miss | Per-measure R/Y/G wash; RunSummary ALWAYS (completion or silent-stop, H1) | Page indicator only |
| **Success moment** | Piece ends cleanly (tail silence flushed) | **Completion card**: "Every note played — Polish it →" (J6/M5) | RunSummary with **"Drill worst section"** → back to Learn with range set (J6) | — |
| **Chrome beyond tabs** | ▶/⏸ · My part: None/RH/LH/Both · Tempo · Key · View ⋯ | Hands: Both/RH/LH · Practice ▾ · View ⋯ | ▶ (count-in) · ↺ · Tempo · Click · Hands · Practice ▾ · View ⋯ | page x/y (pedals turn) |

## A3. Design pillars

1. **The beat must be audible before it is graded.** No timing grade without a click the user can hear and a count-in that tells them when to start. (Today Polish grades timing with no click, no tempo control, no count-in — audit J1.)
2. **Selections are promises.** If the user picks a practice range, hands, or tempo, it survives mode switches within the practice pair (Learn↔Polish) and survives leaving the score (localStorage per score). Wiping user selections is a bug, not hygiene.
3. **One mental model for parts.** A staff chip/control always answers "who plays this staff — you, the kiosk, or nobody." Never two semantics for one widget (audit J4). For the grand-staff 95% case, that question is asked as a single **Hands / My part** segmented control, not per-staff chips.
4. **Two clusters, never one soup.** Practice controls (hands, range, tempo, click) sit apart from view controls (layout, size, keyboard, info). View controls collapse into one ⋯ menu.
5. **The score area is the primary surface.** Guided flows (measure selection) put their instructions ON the score as a banner + live brackets, not in the bar.

## A4. Control inventory — verdict on every current control

| Current control | Where | Verdict | Why / replacement |
|---|---|---|---|
| Mode tabs `Listen·Learn·Polish·Perform` | left | **Keep** | Correct vocabulary and order; becomes true ladder once J2/J3/J6 land |
| `⟲` reset (icon-only) | center | **Redesign** | Label it `↺ Restart`; only rendered when a run exists to restart (paused mid-run or grades present) |
| `▶`/`❚❚` | center | **Redesign** | Gains states: `Preparing…` (disabled, pre-geometry, H0), `▶ Play` (with count-in in Polish/Listen-with-part), beat readout during count-in, `⏸` |
| `37 / 214` step readout | center | **Kill** | Note-step counts mean nothing to a musician → `m 12 / 32` (measures) |
| Part chips `✓ RH` (Learn/Polish) | right | **Kill** | → **Hands: Both·RH·LH** segmented control (per-staff chips only for >2 staves) |
| Part chips `RH: Play→You→Mute` (Listen) | right | **Kill** | Dead UI — audio ignores roles entirely (H5). → **My part: None·RH·LH·Both**; kiosk plays the complement, count-in when ≠ None. `Mute` role dropped (muting everything = Learn; YAGNI) |
| Section chips `A B C…` inline | right | **Kill** | → inside **Practice ▾** popover |
| `Loop` (two hidden taps) | right | **Kill** | → **Practice ▾ → "Select measures…"** guided flow with on-score banner + live brackets (M3) |
| `Clear` + range readout | right | **Kill** | → Practice ▾ shows current scope as its own label (`Practice: m9–16 ▾`); "Whole piece" inside clears |
| `♩` click toggle (Learn+Listen) | right | **Move** | Meaningless in Learn (self-paced), redundant in Listen (kiosk performance is the beat). Click lives ONLY in Polish, default ON (J1) |
| `Scoring` toggle (Polish) | right | **Kill** | Polish without scoring is a silent cursor — pointless. Polish always grades |
| `Play-along` toggle (Listen) | right | **Kill** | Always-on: correct strikes always light in Listen. One less toggle |
| Key `− 0 +` transpose (Listen) | right | **Keep** | Works; stays Listen-only |
| `Tempo %` popover (Listen) | right | **Extend** | Also in Polish (J1); same steps 50–150% |
| `⌨` keyboard toggle | right | **Move** | Auto per mode (Learn/Polish: on; Listen: on iff My part ≠ None; Perform: off) with per-mode manual override remembered (M2); manual toggle lives in View ⋯ |
| `≡`/`→` flow toggle | right | **Move** | → View ⋯ as labeled "Layout: Down the page / Across" |
| `Size %` popover | right | **Move** | → View ⋯ |
| `ⓘ` info popover | right | **Move** | → View ⋯ ("About this piece") |
| (popovers generally) | right | **Redesign** | Single-open manager + tap-outside dismiss (M4) |

## A5. Target transport bar per mode

```
LISTEN   [Listen|Learn|Polish|Perform] │ [▶ Play]  m 1/32 │ My part: [None|RH|LH|Both]  [Key − 0 +]  [Tempo 100% ▾]  [⋯]
LEARN    [Listen|Learn|Polish|Perform] │           m 4/32 │ Hands: [Both|RH|LH]   [Practice: Whole piece ▾]          [⋯]
POLISH   [Listen|Learn|Polish|Perform] │ [↺] [▶ Play]  m 4/32 │ Hands: [Both|RH|LH]  [Practice: m9–16 ▾]  [Tempo 70% ▾]  [♩ Click ✓]  [⋯]
PERFORM  [Listen|Learn|Polish|Perform] │        page 2/6  │                                                            [⋯]
```

Count-in overlay (Polish always; Listen when My part ≠ None): large centered beat count over the score (`1 · 2 · 3 · 4` for 4/4) at the run tempo; any tap cancels.

Guided measure selection (from Practice ▾ → "Select measures…"): banner pinned over the score top — *"Tap the FIRST measure of your practice range — Cancel"* → tap → bracket appears on that measure, banner: *"Now tap the LAST measure"* → tap → range set, brackets + tint persist (FocusRangeLayer) in Learn AND Polish.

## A6. Data model additions

- `myStaves: Set<number>` (Listen) — staves the user plays; kiosk performs the complement. Derives `roles` for `buildPlayTimeline`/`youMidisAt` (staff ∈ myStaves → `'you'`, else `'play'`). Replaces the dead `roles` state.
- `selecting: null | { stage: 'first' } | { stage: 'last', inMeasure }` — guided range selection; replaces `loopArm`/`loopInRef`.
- Per-score persistence, localStorage key `daylight.piano.sm.<scoreId>` → `{ v: 1, mode, activeParts, myStaves, tempoMult, focus }`. Restored on open; `defaultMode` config is the fallback for `mode`.
- `sheetMusicConfig.js` default `defaultMode` changes `'learn'` → `'listen'`.

---

# Part B — Implementation Tasks

Conventions for every task: run tests with `npx vitest run <file>` from repo root. Commit after each green task with the message given. All paths relative to repo root. Base dir `SM/` = `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`, `MN/` = `frontend/src/modules/MusicNotation/`.

## Phase 0 — Honest loading (H0)

### Task 0.1: Hide OSMD's cursor during geometry extraction

**Files:**
- Modify: `MN/renderers/osmdRender.js` (both `extractEvents` and `extractLayoutSliced`)
- Test: `MN/renderers/osmdRender.sliced.test.js` (extend — it already builds a fake OSMD with a cursor)

**Step 1: Write the failing test.** In the existing fake-cursor setup, give `cursor.cursorElement` a real `style` object (`{ style: {} }` if the fake lacks one). Add:

```js
it('keeps the visible cursor hidden from the user during the walk and restores after', async () => {
  const osmd = makeFakeOsmd(/* existing helper, N steps */);
  const el = osmd.cursor.cursorElement;
  let seenDuringWalk;
  // capture visibility mid-walk via the per-step hook the fake exposes (or wrap cursor.next)
  const origNext = osmd.cursor.next;
  osmd.cursor.next = () => { seenDuringWalk = el.style.visibility; origNext(); };
  await extractLayoutSliced(osmd, { yieldFn: (cb) => cb() });
  expect(seenDuringWalk).toBe('hidden');   // user never sees the sweep
  expect(el.style.visibility).toBe('');     // restored for real playback use
});
```

Mirror the same assertion synchronously for `extractEvents` in `osmdRender.test.js`.

**Step 2:** `npx vitest run frontend/src/modules/MusicNotation/renderers/osmdRender.sliced.test.js` → FAIL (visibility never set).

**Step 3: Implement.** In BOTH walks, immediately after `cursor.show()`:

```js
const cursorEl = cursor.cursorElement;
if (cursorEl?.style) cursorEl.style.visibility = 'hidden'; // OSMD needs show() for geometry; the user doesn't need the sweep (audit H0)
```

and in each `finally`, before `cursor.hide()`:

```js
if (cursorEl?.style) cursorEl.style.visibility = '';
```

(OSMD's `cursor.update()` writes position/size, not `visibility`, so the hide survives every step.)

**Step 4:** Run both test files → PASS.
**Step 5:** `git commit -m "fix(sheetmusic): hide OSMD cursor during geometry extraction walk (H0)"`

### Task 0.2: Staff skeleton replaces the "Engraving…" text veil

**Files:**
- Create: `MN/renderers/StaffSkeleton.jsx` + `MN/renderers/StaffSkeleton.test.jsx`
- Modify: `MN/renderers/MusicXmlRenderer.jsx:181` (the `__busy` veil)
- Modify: `frontend/src/Apps/PianoApp.scss` (after `.musicxml-renderer__busy` block, ~line 2460)

**Step 1: Failing test:**

```jsx
import { render } from '@testing-library/react';
import StaffSkeleton from './StaffSkeleton.jsx';

it('renders shimmer stave bands, aria-hidden', () => {
  const { container } = render(<StaffSkeleton systems={3} />);
  const root = container.querySelector('.staff-skeleton');
  expect(root).toBeTruthy();
  expect(root.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelectorAll('.staff-skeleton__system')).toHaveLength(3);
  // each system draws 5 staff lines
  expect(container.querySelectorAll('.staff-skeleton__system:first-child .staff-skeleton__line')).toHaveLength(5);
});
```

**Step 2:** Run → FAIL (module missing).

**Step 3: Implement.**

```jsx
/** StaffSkeleton — engrave-phase placeholder: shimmering 5-line stave systems. */
export default function StaffSkeleton({ systems = 4 }) {
  return (
    <div className="staff-skeleton" aria-hidden="true">
      {Array.from({ length: systems }, (_, s) => (
        <div key={s} className="staff-skeleton__system">
          {Array.from({ length: 5 }, (_, l) => <div key={l} className="staff-skeleton__line" />)}
        </div>
      ))}
    </div>
  );
}
```

In `MusicXmlRenderer.jsx`, replace the busy veil's text:

```jsx
{!showPlaceholder && rendering && <div className="musicxml-renderer__busy"><StaffSkeleton /></div>}
```

(drop the `dims.width > 0` condition — the skeleton must show BEFORE first paint; keep the veil absolutely positioned but give it a min-height via CSS). SCSS: systems as horizontal bands (~14% height gaps), lines 1px `#c9c2b4`, shimmer via the existing `is-shimmer` keyframes pattern (copy the gradient animation used by `.piano-skeleton`, respecting `prefers-reduced-motion`).

**Step 4:** Run StaffSkeleton + `MusicXmlRenderer.test.jsx` (guard against regressions) → PASS.
**Step 5:** `git commit -m "feat(sheetmusic): staff skeleton for the engrave phase (H0)"`

### Task 0.3: Transport shows "Preparing…" until geometry is ready

**Files:**
- Modify: `SM/ScorePlayer.jsx` (pass `ready`), `SM/ScoreTransportBar.jsx` (`ScoreTransportButtons`)
- Test: `SM/ScoreTransportBar.test.jsx`

**Step 1: Failing test:**

```jsx
it('disables Play with a Preparing label until geometry is ready', () => {
  render(<ScoreTransportBar mode="polish" ready={false} running={false} onToggleRun={vi.fn()} onMode={vi.fn()} onReset={vi.fn()} step={0} total={0} />);
  const play = screen.getByRole('button', { name: /preparing/i });
  expect(play).toBeDisabled();
});
it('enables Play once ready', () => {
  render(<ScoreTransportBar mode="polish" ready running={false} onToggleRun={vi.fn()} onMode={vi.fn()} onReset={vi.fn()} step={0} total={10} />);
  expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
});
```

**Step 2:** Run → FAIL. **Step 3:** Thread `ready` through the bar into `ScoreTransportButtons` (memo props stay step-independent — `ready` flips once per document/re-engrave): `disabled={!ready}`, `aria-label={!ready ? 'Preparing' : running ? 'Pause' : 'Play'}`. In `ScorePlayer.jsx` pass `ready={events.length > 0 && layoutFresh}`. **Step 4:** PASS. **Step 5:** `git commit -m "feat(sheetmusic): transport disabled with Preparing state until layout ready (H0)"`

## Phase 1 — Make play-along and timing real (H5, J1, H1)

### Task 1.1: Listen roles actually route audio (fix the dead chips)

**Files:**
- Modify: `SM/ScorePlayer.jsx:182-187`
- Test: `SM/playParts.test.js` already covers `buildPlayTimeline` role filtering; add a ScorePlayer-level test in `SM/ScorePlayer.test.jsx` (follow its existing mock harness)

**Step 1: Failing test** (ScorePlayer.test.jsx — the harness already fakes MIDI + layout; assert on what gets scheduled):

```jsx
it('listen mode does NOT perform staves the user marked as their own', async () => {
  // render in listen mode, cycle staff 0 chip to "You" (fire click once),
  // start playback, run timers past the first onset
  // expect(sendNoteAt).not.toHaveBeenCalledWith(<staff-0 midi>, expect.anything(), expect.anything())
  // expect(sendNoteAt).toHaveBeenCalledWith(<staff-1 midi>, expect.anything(), expect.anything())
});
```

(Flesh out with the file's existing helpers for layout fixtures; staff 0/1 fixture notes already exist there.)

**Step 2:** Run → FAIL — today every staff is sent (`allPlayRoles`).

**Step 3: Implement.** Delete the `listenRoles = allPlayRoles(parts)` memo. Build the timeline from the user's roles:

```jsx
const playTimeline = useMemo(
  () => (mode === 'listen'
    ? scaleTimeline(buildPlayTimeline(events, layout.notes, tempoMap, roles), 1 / tempoMult)
    : scaleTimeline(stepTimeline, 1 / tempoMult)),
  [mode, events, layout.notes, tempoMap, roles, stepTimeline, tempoMult],
);
```

Drop the `'mute'` role from the cycle for now by editing `CYCLE` in `playParts.js` to `{ play: 'you', you: 'play' }` (Phase 3 replaces the chip UI wholesale; Listen role choices are You/Kiosk only — audit A4). Update `ScorePlayer`'s docstring (line ~50) so it stops lying, and fix `playParts.test.js` cycle expectations. Keep `allPlayRoles` export only if other tests use it; otherwise delete it and its test.

**Step 4:** Run `SM/ScorePlayer.test.jsx` + `SM/playParts.test.js` → PASS.
**Step 5:** `git commit -m "fix(sheetmusic): Listen performs only non-user staves — role chips now route audio (H5)"`

### Task 1.2: Count-in engine (pure plan + hook)

**Files:**
- Create: `SM/countIn.js`, `SM/countIn.test.js`, `SM/useCountIn.js`, `SM/useCountIn.test.js`

**Step 1: Failing tests:**

```js
// countIn.test.js
import { countInPlan } from './countIn.js';
it('one measure of beats at the scaled tempo', () => {
  expect(countInPlan({ beats: 4, bpm: 120, tempoMult: 1 })).toEqual({ beats: 4, periodMs: 500, totalMs: 2000 });
  expect(countInPlan({ beats: 3, bpm: 90, tempoMult: 0.5 })).toEqual({ beats: 3, periodMs: 60000 / 45, totalMs: 3 * (60000 / 45) });
});
it('degenerate meter falls back to 4 beats', () => {
  expect(countInPlan({ beats: 0, bpm: 120, tempoMult: 1 }).beats).toBe(4);
});
```

```js
// useCountIn.test.js — fake timers + injected blip fn (pattern: useMetronomeClick.test.js)
it('ticks beat numbers, schedules one blip per beat, fires onGo at the end', () => {
  vi.useFakeTimers();
  const blips = []; const onGo = vi.fn();
  const { result } = renderHook(() => useCountIn({ onGo, scheduleBlip: (t) => blips.push(t) }));
  act(() => result.current.start({ beats: 4, periodMs: 500 }));
  expect(result.current.active).toBe(true);
  expect(result.current.beat).toBe(1);
  act(() => vi.advanceTimersByTime(500)); expect(result.current.beat).toBe(2);
  act(() => vi.advanceTimersByTime(1500));
  expect(onGo).toHaveBeenCalledTimes(1);
  expect(result.current.active).toBe(false);
  expect(blips).toHaveLength(4);
});
it('cancel stops everything and never fires onGo', () => { /* start, advance 600ms, cancel(), advance 5s, expect no onGo, active false */ });
```

**Step 2:** Run → FAIL.

**Step 3: Implement.** `countIn.js`:

```js
export function countInPlan({ beats, bpm, tempoMult = 1 }) {
  const b = Number.isFinite(beats) && beats >= 2 && beats <= 12 ? beats : 4;
  const effBpm = (bpm > 0 ? bpm : 90) * (tempoMult > 0 ? tempoMult : 1);
  const periodMs = 60000 / effBpm;
  return { beats: b, periodMs, totalMs: b * periodMs };
}
```

`useCountIn.js`: state `{ active, beat }`; `start({beats, periodMs})` schedules audio blips at exact AudioContext times (default `scheduleBlip` = `(offsetS) => { const ac = audioContext(); if (ac) scheduleBlipAt(ac, ac.currentTime + offsetS); }` from `./click.js`, injectable for tests) and a `setInterval(periodMs)` for the visual beat counter; after `beats` periods, clears and calls `onGo` (kept in a ref). `cancel()` clears timers, `active=false`. Cleanup on unmount. Callbacks via refs (house pattern — see `useScoreTransport`).

**Step 4:** Run both → PASS.
**Step 5:** `git commit -m "feat(sheetmusic): count-in engine (pure plan + hook)"`

### Task 1.3: Wire count-in into Polish runs + beat overlay

**Files:**
- Modify: `SM/ScorePlayer.jsx` (`toggleRun`), `frontend/src/Apps/PianoApp.scss`
- Create: `SM/CountInOverlay.jsx` + test
- Test: extend `SM/ScorePlayer.test.jsx`

**Step 1: Failing tests.** `CountInOverlay` renders the beat big and centered (`<div className="piano-score-countin" aria-live="polite">3</div>`; null when `!active`). ScorePlayer test: in polish mode with fake timers, tapping Play does NOT call `transport.play` immediately; after `totalMs` the transport starts; a tap during count-in cancels (transport never starts, overlay gone).

**Step 2:** FAIL.

**Step 3: Implement.** In `ScorePlayer`:

```jsx
const countIn = useCountIn({ onGo: () => { transportRef.current?.seek((stepTimeline[stepRef.current]?.t ?? 0) / tempoMult); transportRef.current?.play(); } });
```

`toggleRun` start-branch: if `mode === 'polish'` (Listen joins in Task 4.1) → `countIn.start(countInPlan({ beats: parsed?.timeSig?.beats, bpm: tempoMap[0]?.bpm, tempoMult }))` and log `score.countin.start`; else play immediately as today. Pause-branch and `onMode`/`reset`/unmount also `countIn.cancel()`. `onScoreClick`: if `countIn.active` → `countIn.cancel()` and return (tap = abort). Render `<CountInOverlay active={countIn.active} beat={countIn.beat} />` inside the scroll container. `running` for the bar becomes `transport.playing || countIn.active` (Play button shows ⏸/cancel during count-in).

**Step 4:** PASS all touched files. **Step 5:** `git commit -m "feat(sheetmusic): one-measure count-in before Polish runs (J1)"`

### Task 1.4: Click lives in Polish (during runs), leaves Learn/Listen

**Files:**
- Modify: `SM/ScorePlayer.jsx` (`useMetronomeClick` wiring, `clickOn` default), `SM/ScoreTransportBar.jsx` (`hasClick`), tests in both `.test.jsx`

**Step 1: Failing tests.** Bar: `♩ Click` button renders in polish, NOT in learn/listen. ScorePlayer: with polish running (after count-in), the click scheduler is active at `bpm × tempoMult`; in learn it never activates even with the old toggle state true.

**Step 2:** FAIL. **Step 3:** `ScoreTransportBar`: `const hasClick = mode === 'polish'`; label the button `♩ Click`. `ScorePlayer`: `const [clickOn, setClickOn] = useState(true);` and

```jsx
useMetronomeClick({ enabled: clickOn && mode === 'polish' && running, bpm: (tempoMap[0]?.bpm || 90) * tempoMult });
```

(count-in already provides its own blips; `running` excludes count-in time — the metronome starts when the transport does; acceptable seam since both derive from the same AudioContext clock. If a beat gap is audible at the seam on-device, follow-up: start the metronome scheduler at `onGo` time.) Update stale tests that asserted click in learn/listen.

**Step 4:** PASS. **Step 5:** `git commit -m "feat(sheetmusic): metronome click is Polish-only, on by default during runs (J1)"`

### Task 1.5: Polish gets the tempo stepper

**Files:**
- Modify: `SM/ScoreTransportBar.jsx` (gating), test `SM/ScoreTransportBar.test.jsx`

**Step 1: Failing test:** tempo button renders in polish mode; picking `75%` calls `onTempo(0.75)`; transpose/My-part extras still absent in polish.
**Step 2:** FAIL. **Step 3:** Split `hasListenExtras` into `hasTempo = mode === 'listen' || mode === 'polish'` and `hasListenOnly = mode === 'listen'` (key transpose, play-along until 3.x kills it). The transport timeline is already tempo-scaled for polish (`ScorePlayer.jsx:186`) — zero player changes.
**Step 4:** PASS. **Step 5:** `git commit -m "feat(sheetmusic): tempo control in Polish (J1) — practice below tempo"`

### Task 1.6: RunSummary on completion + final measure graded (H1)

**Files:**
- Modify: `SM/useScoreEvaluator.js` (return `finalize`), `SM/ScorePlayer.jsx` (`onDone`)
- Test: `SM/useScoreEvaluator.test.js`, `SM/ScorePlayer.test.jsx`

**Step 1: Failing tests.** Evaluator: after hits buffered in measure 3 with no advance, `finalize()` grades measure 3 (calls `onMeasureGrade` with `measure: 3`) exactly once and is a no-op when disabled/empty. ScorePlayer: polish run driven to `onDone` → summary panel opens, last measure has a grade, `score.polish.summary` logged.

**Step 2:** FAIL. **Step 3:** `useScoreEvaluator` returns `{ finalize }`:

```js
const currentMeasureRef = useRef(currentMeasure); currentMeasureRef.current = currentMeasure;
const finalize = useCallback(() => {
  if (!enabledRef.current || finalizedRef.current) return;   // enabledRef mirrors `enabled`
  finalizedRef.current = true;                                // reset with the other refs on disable
  const m = currentMeasureRef.current;
  const g = gradeMeasure({ expected: expectedForMeasureRef.current?.(m) || [], hits: hitsRef.current }, cfgRef.current || {});
  if (g.silent && hitsRef.current.length === 0 && (expectedForMeasureRef.current?.(m) || []).length === 0) return;
  onMeasureGradeRef.current?.({ measure: m, ...g });
  hitsRef.current = [];
}, []);
```

ScorePlayer `onDone`: when `mode === 'polish' && scoringOn` → `evaluator.finalize(); setSummaryOpen(true);` and emit the same `logRunSummary` tally as `onSilentStop` — extract the shared tally into `SM/gradeTally.js` (`tallyGrades(grades) → {green,yellow,red,overall}`) with its own micro-test, and use it from `onSilentStop`, `onDone`, AND `RunSummary.jsx` (kills the L6 duplication).

**Step 4:** PASS evaluator + player + RunSummary tests. **Step 5:** `git commit -m "fix(sheetmusic): grade final measure and show RunSummary when a Polish run completes (H1)"`

## Phase 2 — Connect the ladder (J2, J3, J6, M5) + persistence

### Task 2.1: Open in Listen — wire `defaultMode`

**Files:**
- Modify: `SM/sheetMusicConfig.js` (default → `'listen'`), `SM/ScorePlayer.jsx` (init state from config; hoist `smCfg` above the `useState`)
- Test: `SM/sheetMusicConfig.test.js`, `SM/ScorePlayer.test.jsx`

**Steps:** failing config test (`SHEET_MUSIC_DEFAULTS.defaultMode === 'listen'`) + player test (renders with Listen tab active given no config); implement by moving `const smCfg = useMemo(...)` above state and `useState(() => smCfg.defaultMode)` with a validity guard (`['listen','learn','polish','perform']`). Run → PASS. `git commit -m "feat(sheetmusic): scores open in Listen; sheetmusic.defaultMode wired (J2/M1)"`

### Task 2.2: Practice range survives Learn↔Polish

**Files:** `SM/ScorePlayer.jsx` (`onMode`), test `SM/ScorePlayer.test.jsx`

**Steps:** failing test — set a focus in learn (drive `onPickSection`), switch to polish: focus label still rendered / range still applied; switch to listen: cleared. Implement in `onMode`:

```jsx
const PRACTICE_PAIR = new Set(['learn', 'polish']);
if (!(PRACTICE_PAIR.has(mode) && PRACTICE_PAIR.has(id))) { setFocus(null); setSelecting(null); }
```

Run → PASS. `git commit -m "feat(sheetmusic): practice range carries across Learn↔Polish (J3)"`

### Task 2.3: "Drill worst section" from the RunSummary

**Files:**
- Create: `SM/worstSpan.js` + `SM/worstSpan.test.js`
- Modify: `SM/RunSummary.jsx` (button), `SM/ScorePlayer.jsx` (handler)

**Step 1: Failing tests:**

```js
import { worstSpan } from './worstSpan.js';
const g = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { grade: v }]));
it('null when everything is green or ungraded', () => {
  expect(worstSpan(g({ 0: 'green', 1: 'green' }))).toBeNull();
  expect(worstSpan({})).toBeNull();
});
it('picks the heaviest contiguous non-green run (red=2, yellow=1)', () => {
  expect(worstSpan(g({ 0: 'green', 1: 'yellow', 2: 'red', 3: 'red', 4: 'green', 5: 'yellow' })))
    .toEqual({ inMeasure: 1, outMeasure: 3 });
});
it('a lone red beats two scattered yellows', () => {
  expect(worstSpan(g({ 0: 'yellow', 1: 'green', 2: 'red', 3: 'green', 4: 'yellow' })))
    .toEqual({ inMeasure: 2, outMeasure: 2 });
});
```

**Step 3:** Implement (scan sorted measure indices; contiguous runs where grade ≠ green AND indices adjacent; weight red 2 / yellow 1; max weight, tie → earlier). RunSummary gains `onDrill` → `Drill worst section` button rendered only when `worstSpan(grades)` ≠ null (compute in the parent, pass `drillable`). ScorePlayer `onDrillWorst`: `const span = worstSpan(gradesRef.current); if (span) { setFocus({ kind: 'custom', ...span }); onMode('learn'); }` — NOTE: call `onMode('learn')` BEFORE `setFocus` would be wiped; with Task 2.2 the learn↔polish switch preserves focus, so order `onMode('learn'); setFocus(...)` is safest. Log `score.drill.worst`.

**Step 4:** PASS. **Step 5:** `git commit -m "feat(sheetmusic): Drill worst section — RunSummary hands off to Learn with range set (J6)"`

### Task 2.4: Learn completion moment

**Files:**
- Modify: `SM/useFollowTracker.js` (add `onComplete`), `SM/ScorePlayer.jsx`
- Create: `SM/LearnComplete.jsx` + test
- Test: `SM/useFollowTracker.test.js`

**Step 1: Failing tests.** Tracker: with no range, satisfying the LAST step fires `onComplete` once and NOT `onStep`; with a range it wraps as today (no complete). LearnComplete: renders headline + `Practice again` + `Polish it` buttons; null when closed.

**Step 3:** In the satisfied-branch of `useFollowTracker`:

```js
const atEnd = !r && stepRef.current >= (stepsRef.current?.length || 1) - 1;
if (atEnd) { onCompleteRef.current?.(); struckRef.current = new Set(); return; }
```

ScorePlayer: `const [learnDone, setLearnDone] = useState(false);` — `onComplete` → `setLearnDone(true)`, `flushFollowNow()`, log `score.learn.complete`. Reset `learnDone` on step seek, mode change, new doc. `LearnComplete` card (styled like RunSummary): "You played every note 🎉" / buttons → `Practice again` (`setStep(0)`, clear struck, close) and `Polish it` (`onMode('polish')`, close — range carries per 2.2).

**Step 4:** PASS. **Step 5:** `git commit -m "feat(sheetmusic): Learn completion card with Polish handoff (M5/J6)"`

### Task 2.5: Per-score persistence

**Files:**
- Create: `SM/scoreSettings.js` + `SM/scoreSettings.test.js`
- Modify: `SM/ScorePlayer.jsx` (restore on open; save on change)

**Step 1: Failing tests** (localStorage stubbed per vitest defaults):

```js
import { loadScoreSettings, saveScoreSettings } from './scoreSettings.js';
it('round-trips a settings patch per score id', () => {
  saveScoreSettings('files:a.musicxml', { mode: 'polish', tempoMult: 0.75 });
  saveScoreSettings('files:a.musicxml', { focus: { kind: 'custom', inMeasure: 2, outMeasure: 5 } });
  expect(loadScoreSettings('files:a.musicxml')).toMatchObject({ mode: 'polish', tempoMult: 0.75, focus: { inMeasure: 2, outMeasure: 5 } });
});
it('isolated per score; tolerates corrupt JSON and missing storage', () => { /* different id → {}; localStorage.setItem(key,'{oops') → {} */ });
```

**Step 3:** Implement with `try/catch` everywhere, key `daylight.piano.sm.<id>`, envelope `{ v: 1, ...fields }`, merge-on-save. In ScorePlayer: initial state uses `loadScoreSettings(scoreMeta.id)` (mode → validity-guarded, else `smCfg.defaultMode`; `tempoMult` clamped; `focus` shape-checked against measure count once layout arrives — drop it if out of range). Save via one effect: `useEffect(() => { saveScoreSettings(scoreMeta.id, { mode, tempoMult, focus, activeParts, myStaves: [...(myStaves ?? [])] }); }, [mode, tempoMult, focus, activeParts, myStaves])` (cheap; writes are tiny). `myStaves` lands in Task 3.1 — persist once it exists; until then omit the field.

**Step 4:** PASS. **Step 5:** `git commit -m "feat(sheetmusic): per-score practice settings persist (mode/tempo/range/hands)"`

## Phase 3 — Legible chrome (J4, J5, M2, M3, M4)

> These tasks rework `ScoreTransportBar` and its SCSS. Keep the memoization contract (step-independent props; no fresh object/array defaults in the shell) — it's load-bearing for per-step render cost and covered by existing render-count tests.

### Task 3.1: Hands + My-part segmented controls (grand-staff fast path)

**Files:**
- Create: `SM/HandsControl.jsx` + `SM/HandsControl.test.jsx`
- Modify: `SM/ScoreTransportBar.jsx` (replace chip row for 2-staff scores), `SM/ScorePlayer.jsx` (introduce `myStaves`, map to roles; hands handler)

**Step 1: Failing tests.** HandsControl (pure, two variants):

```jsx
// variant="hands" (Learn/Polish): value 'both'|'rh'|'lh'
it('renders Both/RH/LH and reports selection', () => {
  const onChange = vi.fn();
  render(<HandsControl variant="hands" value="both" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'LH' }));
  expect(onChange).toHaveBeenCalledWith('lh');
});
// variant="mypart" (Listen): value 'none'|'rh'|'lh'|'both'
it('mypart variant includes None and labels the group "My part"', () => { /* ... */ });
```

ScoreTransportBar: with `parts` of exactly staves `[0,1]` renders HandsControl; with 3 staves falls back to per-staff chips (existing behavior).

**Step 3:** Implement HandsControl as a labeled segmented group (`role="radiogroup"`, buttons `aria-checked`): label `Hands` / `My part`. ScorePlayer mappings:

```jsx
// hands (learn/polish): activeParts {0,1} <-> 'both'|'rh'|'lh'  (staff 0 = RH, 1 = LH — activeParts.js convention)
const handsValue = activeParts[0] && activeParts[1] ? 'both' : activeParts[0] ? 'rh' : 'lh';
const onHands = useCallback((v) => setActiveParts({ 0: v !== 'lh', 1: v !== 'rh' }), []);
// mypart (listen): myStaves Set <-> 'none'|'rh'|'lh'|'both'; roles derived:
const roles = useMemo(() => Object.fromEntries(parts.map((p) => [p.staff, myStaves.has(p.staff) ? 'you' : 'play'])), [parts, myStaves]);
```

`myStaves` becomes state (`useState(() => new Set(restored.myStaves || []))`), replacing the `roles` useState from Task 1.1's interim wiring; `onCyclePart` stays only for the >2-staff chip fallback (toggles membership / active). Changing My part mid-run: keep the existing pause+silence behavior from `onCyclePart`. Persist `myStaves` (Task 2.5 field).

**Step 4:** PASS HandsControl + bar + player tests. **Step 5:** `git commit -m "feat(sheetmusic): Hands / My-part segmented controls replace ambiguous chips (J4)"`

### Task 3.2: Practice ▾ popover + guided measure selection + visible range brackets

**Files:**
- Create: `SM/PracticeScope.jsx` + test; `SM/FocusRangeLayer.jsx` + test; `SM/SelectBanner.jsx` (tiny, test inside PracticeScope.test)
- Modify: `SM/ScorePlayer.jsx` (replace `loopArm`/`loopInRef` with `selecting`; generalize `stepBoxes`), `SM/ScoreTransportBar.jsx` (mount PracticeScope; remove section chips/Loop/Clear/readout), `frontend/src/Apps/PianoApp.scss`

**Step 1: Failing tests.**
- PracticeScope: button label reflects scope (`Practice: Whole piece` / section label / `m9–16`); popover lists sections from props + `Select measures…` + `Whole piece`; choosing fires `onPickSection/onStartSelect/onClearFocus`.
- FocusRangeLayer: given `measures`, `stepBoxes`, `range {inMeasure,outMeasure}` renders a tint spanning the range's steps and two bracket edges; given `pending m` renders a single-measure bracket. (Geometry math mirrors `MeasureGradeLayer` — same offset space.)
- ScorePlayer: `onStartSelect` → banner text "Tap the FIRST measure"; first score tap does NOT seek but sets pending bracket + banner "Now tap the LAST measure"; second tap sets focus and exits selection; `Cancel` exits with no focus change.

**Step 3:** Implement. `selecting` state machine per A6; `onScoreClick` handles `selecting` before seek logic (replacing today's `loopArm` branch); `stepBoxes` memo now computes whenever `mode === 'learn' || mode === 'polish'` (grade layer AND focus layer share it). SelectBanner: fixed strip over the score top, `aria-live="polite"`, Cancel button. FocusRangeLayer mounts beside MeasureGradeLayer (below cursor z-order). PracticeScope replaces the whole `piano-score-focus` group in the bar (Learn+Polish only). Log events unchanged (`score.focus.arm/set/clear`).

**Step 4:** PASS all touched suites. **Step 5:** `git commit -m "feat(sheetmusic): Practice scope popover, guided measure selection, visible range brackets (J5/M3)"`

### Task 3.3: View ⋯ menu + single-open popover discipline

**Files:**
- Create: `SM/ViewMenu.jsx` + test
- Modify: `SM/ScoreTransportBar.jsx` (one `openPopover` state: `'view'|'tempo'|'practice'|null`; backdrop dismiss; remove standalone ⌨/flow/Size/ⓘ buttons)

**Step 1: Failing tests.** ViewMenu: ⋯ button opens a panel with labeled rows — `Layout: Down the page / Across` (segmented), `Size` steps, `Keyboard: Shown/Hidden` toggle, `About this piece` (meta dl). Bar: opening Tempo closes View (single-open); clicking the backdrop closes any open popover.

**Step 3:** Implement: lift the three popover booleans into one `openPopover` string state in `ScoreViewControls`; render `<button className="piano-score-popover-backdrop" aria-label="Close" onClick={close} />` behind any open popover (full-viewport, transparent; SCSS `position: fixed; inset: 0;` under the popover z-index). ViewMenu takes the meta + flow/scale/keyboard props and their handlers. Keyboard row shows the effective state and sets the per-mode override (Task 3.4).

**Step 4:** PASS. **Step 5:** `git commit -m "feat(sheetmusic): View menu consolidates layout/size/keyboard/info; popovers single-open with tap-out dismiss (M4)"`

### Task 3.4: Bar layout final pass — labels, measure readout, scoring toggle removed, keyboard auto+override

**Files:**
- Modify: `SM/ScoreTransportBar.jsx`, `SM/ScorePlayer.jsx`, SCSS; tests in both

**Step 1: Failing tests.**
- Readout shows `m 3 / 24` (bar receives `measure`/`measureTotal`; step/total props dropped from display) — perform keeps `page x / y`.
- Reset button reads `↺ Restart` and renders only when `canRestart` (running, paused mid-run (`step > 0`), or grades exist).
- No `Scoring` button in any mode; polish still shows grades (player: `scoringOn` state deleted, `showGrades = mode === 'polish'`).
- Keyboard: entering listen with My part none → keyboard hidden; set My part RH → shown; hide it via View menu, leave to learn and back to listen → still hidden in listen (override remembered), learn unaffected.

**Step 3:** Implement. ScorePlayer keyboard policy:

```jsx
const AUTO_KB = { learn: true, polish: true, perform: false }; // listen computed from myStaves
const kbOverrideRef = useRef({});           // mode -> explicit user choice
const autoKb = mode === 'listen' ? myStaves.size > 0 : AUTO_KB[mode];
const keyboardVisible = kbOverrideRef.current[mode] ?? autoKb;
const onToggleKeyboard = useCallback(() => { kbOverrideRef.current[mode] = !keyboardVisible; forceRender(); }, [mode, keyboardVisible]);
```

(`forceRender` = `useState` tick; or keep `keyboardVisible` as state recomputed in `onMode`/myStaves effects — implementer's choice, test the behavior not the mechanism.) Delete `scoringOn`, its toggle, and the `Play-along` toggle (Listen light-up becomes unconditional: the play-along subscription effect drops its `playAlong` gate). Measure readout: `measure = (layout.steps?.[step]?.measure ?? 0) + 1`, `measureTotal = layout.measures?.length ?? 0` — memo-safe (numbers). Kill the step `position` string.

**Step 4:** PASS bar + player + render-count memo tests (update fixtures). **Step 5:** `git commit -m "feat(sheetmusic): transport bar redesign — labeled controls, measure readout, auto keyboard with per-mode override (J5/M2)"`

## Phase 4 — Listen finish + lifecycle & data-path cleanup

### Task 4.1: Count-in in Listen when the user has a part

**Files:** `SM/ScorePlayer.jsx`; test `SM/ScorePlayer.test.jsx`

Failing test: listen + My part RH → Play starts count-in (transport delayed); My part None → Play starts immediately. Implement: `toggleRun` count-in condition becomes `mode === 'polish' || (mode === 'listen' && myStaves.size > 0)`. PASS → `git commit -m "feat(sheetmusic): count-in when playing along in Listen (J7)"`

### Task 4.2: View changes mid-run pause the transport (H2)

**Files:** `SM/ScorePlayer.jsx` (`onTranspose`, `onScale` wrapper, `onToggleFlow`); test `SM/ScorePlayer.test.jsx`

Failing test: during a listen run, transpose → transport paused + silenced (no stale-key playback); same for size/flow change. Implement a shared guard:

```jsx
const pauseForViewChange = useCallback(() => {
  if (!transportRef.current?.playing) return;
  transportRef.current.pause(); silenceScheduled(); flushPlaybackNow();
  logger.info('score.viewchange.pause', {});
}, [silenceScheduled, flushPlaybackNow, logger]);
```

called at the top of `onTranspose` / new `onScaleStep` (wraps `setScale`) / `onToggleFlow`. PASS → `git commit -m "fix(sheetmusic): zoom/flow/transpose mid-run pauses playback — no stale-layout desync (H2)"`

### Task 4.3: Image-score viewer — own metadata, retry, lazy pages (H3/M6/M7)

**Files:** `SM/ScoreViewer.jsx`, `SM/SheetMusic.jsx` (retry in `NotationScore` too); tests `SheetMusic.test.jsx` + new `ScoreViewer.test.jsx`

Failing tests: (a) ScoreViewer with only an id fetches `api/v1/info/plex/{id}` for `title`+`image` — breadcrumb shows the real title; single-image score with no children renders that image, not "no viewable pages"; (b) failure state renders a `Try again` button that refetches; (c) page `<img>`s carry `loading="lazy" decoding="async"`. Implement: parallel `DaylightAPI(info)` + `DaylightAPI(list)` with the existing cancellation pattern; `retryKey` state bumps the effect; same retry treatment in `NotationScore` (`PianoEmpty` gains an optional action button — check `PianoEmpty.jsx` props first, extend if needed). PASS → `git commit -m "fix(sheetmusic): image scores self-resolve title/cover, load-failure retry, lazy pages (H3/M6/M7)"`

### Task 4.4: `.mxl` honesty + minor-key label (H4/L1)

**Files:** `SM/SheetMusic.jsx` (NOTATION_RE), `MN/parseMusicXml.js` (mode), `SM/ScorePlayer.jsx` (meta.key); tests co-located

Failing tests: (a) `collectionListPath`/route: `.mxl` id no longer matches NOTATION_RE (falls to ScoreViewer path — which for a files-source image-less item shows the honest "no viewable pages" rather than a fake engrave failure). Leave a `// TODO(mxl): unzip via container.xml if .mxl scores ever land in the collection` note; (b) parseMusicXml surfaces `key.mode` (`<mode>minor</mode>`); (c) `meta.key` renders `A minor` for fifths 0 + mode minor (relative-minor name table: minor tonic = fifths name shifted — add `MINOR_NAMES` map alongside `KEY_NAMES`). PASS → `git commit -m "fix(sheetmusic): stop advertising unsupported .mxl; honest minor-key labels (H4/L1)"`

---

# Part C — Verification & rollout

1. **Per-task:** the TDD steps above; keep the whole SheetMusic suite green after each phase: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic frontend/src/modules/MusicNotation`.
2. **Memo contract:** re-run the bar render-count tests (`ScoreTransportBar.test.jsx`, `ScorePlayer.test.jsx` step-advance cases) after every Phase 3 task — the redesign must not regress per-step render cost on the tablet.
3. **Live verify (REQUIRED before merge; use the `verify` skill):** `npm run dev` on this machine, open the piano kiosk route → Sheet Music, and walk scenario B end-to-end with a MusicXML score: open (staff skeleton, no cursor sweep, Preparing→Play) → Listen (My part RH: kiosk plays LH only; count-in; correct strikes light) → Learn (Hands LH; Practice → Select measures guided flow; complete → card → Polish it) → Polish (count-in + click at 70%; finish → summary with final measure graded → Drill worst section lands in Learn with brackets) → reload the score (settings restored) → Perform (pedal CCs page-turn; keyboard hidden). MIDI can be simulated via the existing test/bridge tooling if the physical piano isn't reachable from the dev box.
4. **On-kiosk check after deploy:** the SM-T590 is the perf target — confirm count-in audio isn't clipped by the tablet's audio policy (see memory `reference_piano_tablet_audio_guard`: STREAM_MUSIC volume clamps) and that the extraction-phase UI feels right on real hardware.
5. **Docs:** update `docs/_wip/audits/2026-07-13-sheetmusic-mode-audit.md` statuses as findings are fixed; when the redesign ships, move the relevant sections to `docs/reference/piano/` per the docs policy.

## Out of scope (explicit, so nobody "helpfully" adds them)

- `.mxl` unzip support (removed from the regex instead; revisit if real `.mxl` files appear).
- Multi-user profiles / per-user progress (persistence is per-score, device-local).
- Tempo auto-ramp ("pass at 70% → offer 85%") — natural Phase 5, only after the base loop proves itself.
- Any backend changes; `sheetmusic.collection` config and content APIs are untouched except read-only info fetch in 4.3.
