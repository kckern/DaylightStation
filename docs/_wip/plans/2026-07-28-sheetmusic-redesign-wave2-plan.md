# Sheet Music Redesign — Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the sheet-music chrome redesign (header mode selector + thumbnail, key-name transpose, ♩BPM tempo chip with 3×3 picker, direct-manipulation loop toggle, label-less hands, View sheet, subtle note highlight, real titles) plus video-chrome convergence onto the shared transport primitives, the score tab YAML/file reorg, and one big-bang deploy.

**Architecture:** Everything renders through the wave-1 `transport/` primitives (`TransportButton`, `TransportSheet`, `StepGrid`) and the shared icon set — no new button families. `ScoreTransportBar` keeps its memo shell; the mode tabs LEAVE the bar for a header crumb + ModeSheet. `ScorePlayer` keeps all state lifted; new state is exactly two booleans (`modeSheetOpen`, `loopOn`).

**Tech Stack:** React 18 + vitest (run from repo root: `npx vitest run <path>`; worktree has node_modules symlinks). Data edits via `sudo docker exec daylight-station` (adm-zip is in the container's node_modules for .mxl rewriting).

**Spec:** `docs/_wip/plans/2026-07-28-sheetmusic-redesign-wave2-spec.md`

## Global Constraints

- Work in `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-tabs` (branch `worktree-sheetmusic-tabs`). Already on it: score tabs, hand toggles, all needed icons (`mode-listen|mode-learn|mode-polish|mode-perform`, `layout-down`, `layout-across`, `hand-left/right`, `metronome`, `repeat`, `chevron-down`, `quarter-note` all exist in `icons/svg/`).
- ≥3rem touch targets; inline SVG only — never Unicode symbol characters as button faces (`noUnicodeGlyphs.test.js` enforces; `›` in the chrome separator span is pre-existing chrome text, not a button face).
- `ScoreTransportBar`'s four `React.memo` clusters and gate-in-place discipline stay; the `onBodyRender` memo-count assertions in `ScoreTransportBar.test.jsx` must pass unchanged.
- All controls via `transport/` primitives; no raw `console.*`; commit per task (`feat(piano)`/`fix(piano)`/`refactor(piano)` style).
- Do not touch producer/, modes/Studio/, modes/Composer/, `FullscreenTransportOverlay.jsx`.
- Full kiosk suite (`npx vitest run frontend/src/modules/Piano/PianoKiosk/`) green before the final task (2183+ tests at branch base; teardown-flake exit-code noise with all tests passing is known and acceptable — grade on pass/fail counts).

---

### Task 1: Subtle note-highlight ink

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx:1304` (and the `accent={cursorColor}` site at ≈1383)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx` (one new assertion block)

**Interfaces:**
- Produces: `NOTE_INK` export from `ScorePlayer.jsx` (value `'#23262b'`) — the fixed lit-notehead ink; `cursorColor` keeps driving only the cursor band (`--cursor-color`).

- [ ] **Step 1: Write the failing test** — in `ScorePlayer.test.jsx`, add (near the other Listen-mode tests, using the existing `renderPlayer()` helper — read the file's helpers first):

```jsx
it('lit noteheads use the fixed near-black ink, not the mode accent (wave-2 A)', async () => {
  renderPlayer(); // opens in Listen
  await act(async () => {});
  // The engraved fake notes carry `el`s (see the harness); the highlight layer
  // stamps --nh-color on the current step's elements.
  const litEl = document.querySelector('.piano-note-lit');
  expect(litEl).not.toBeNull();
  expect(litEl.style.getPropertyValue('--nh-color')).toBe('#23262b');
});
```

If the harness doesn't light a step until playback starts, mirror whatever an adjacent test does to reach a lit state (e.g. press Play + advance timers) — the assertion is the point: `--nh-color` is `#23262b`, not `#e8a33d`/`#2ec46f`.

- [ ] **Step 2: Run** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx` — new test FAILS (color is the mode accent).

- [ ] **Step 3: Implement** — in `ScorePlayer.jsx`:

```jsx
// Line ~1304 — the band keeps its mode colour; lit NOTEHEADS get a fixed
// near-black ink (wave-2 A): visibly "current", nothing louder.
export const NOTE_INK = '#23262b';
const cursorColor = mode === 'learn' ? '#2ec46f' : mode === 'listen' ? '#e8a33d' : '#6cf';
```

and at the `NoteHighlightLayer` mount (~1383): `accent={NOTE_INK}` (leave `'--cursor-color': cursorColor` as is). Note `export const` must sit at module scope — put `NOTE_INK` at the top of the file with the other constants, not inside the component.

- [ ] **Step 4: Run** the file's suite — PASS. Also confirm the green HIT glow still asserts wherever existing tests check `.piano-note-hit` (they key on class, not color — no change expected).

- [ ] **Step 5: Commit** `feat(piano): lit noteheads use a fixed near-black ink instead of the mode accent`

---

### Task 2: Real titles — shared prettifier + fallback

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTitle.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreGrid.jsx` (import from scoreTitle.js, delete local copy)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx:86`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreTitle.test.js`

**Interfaces:**
- Produces: `prettyTitle(raw) => string` and `titleFromScoreId(id) => string` (basename of a content id, prettified; `'files:docs/sheet-music/video-games/super-mario-theme.mxl'` → `'Super Mario Theme'`).

- [ ] **Step 1: Failing test**

```js
// scoreTitle.test.js
import { prettyTitle, titleFromScoreId } from './scoreTitle.js';

describe('scoreTitle', () => {
  it('prettifies filename-derived titles', () => {
    expect(prettyTitle('fur-elise-super_easy.mxl')).toBe('Fur Elise Super Easy');
    expect(prettyTitle('')).toBe('Score');
  });
  it('derives a title from a full content id', () => {
    expect(titleFromScoreId('files:docs/sheet-music/video-games/super-mario-theme.mxl')).toBe('Super Mario Theme');
    expect(titleFromScoreId('')).toBe('Score');
  });
});
```

- [ ] **Step 2: RED** — module missing.

- [ ] **Step 3: Implement** — move `prettyTitle` verbatim from `ScoreGrid.jsx:9-17` into `scoreTitle.js` and add:

```js
/** Title from a content id's basename: "files:a/b/super-mario-theme.mxl" → "Super Mario Theme". */
export function titleFromScoreId(id) {
  const base = String(id || '').split('/').pop() || '';
  return prettyTitle(base.replace(/^[a-z]+:/i, ''));
}
```

`ScoreGrid.jsx` imports `{ prettyTitle }` from `'./scoreTitle.js'` (delete its local copy). `ScorePlayer.jsx:86` becomes:

```jsx
title: scoreMeta.title || parsed?.title || titleFromScoreId(scoreMeta.id),
```

(with `import { titleFromScoreId } from './scoreTitle.js';`).

- [ ] **Step 4: Run** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` — PASS (a `ScorePlayer.test.jsx` fixture with no title may now assert a prettified name instead of "Score"; update such assertions — that's the feature).

- [ ] **Step 5: Commit** `feat(piano): score titles fall back to the prettified filename, never "Score"`

---

### Task 3: Chrome crumbs — icon, image, clickable current

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoChrome.jsx` (trail assembly + render, ≈lines 38-72)
- Modify: `frontend/src/Apps/PianoApp.scss` (crumb thumb/icon styles)
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoChrome.test.jsx` (extend)

**Interfaces:**
- Consumes: crumbs published via `usePianoBreadcrumb` — now `{ label, onClick?, icon?, image? }`.
- Produces: chrome renders `image` as a small square thumb before the label, `icon` as a shared `<Icon>` before the label, and a LAST crumb with `onClick` as a button (class `piano-chrome__crumb piano-chrome__crumb--current`).

- [ ] **Step 1: Failing tests** — extend `PianoChrome.test.jsx` (read its provider/mock harness first and reuse it):

```jsx
it('renders crumb thumbnails and icons, and a clickable current crumb', () => {
  // publish crumbs via the harness's breadcrumb provider:
  // [{ label: 'Super Mario Theme', image: '/img/mario.jpg' },
  //  { label: 'Listen', icon: 'mode-listen', onClick: spy }]
  // …render chrome…
  const img = document.querySelector('.piano-chrome__crumb-thumb');
  expect(img).not.toBeNull();
  expect(img).toHaveAttribute('src', '/img/mario.jpg');
  const modeCrumb = screen.getByRole('button', { name: /listen/i });
  expect(modeCrumb.querySelector('.piano-icon')).not.toBeNull();
  fireEvent.click(modeCrumb);
  expect(spy).toHaveBeenCalled();
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement** — in `PianoChrome.jsx`: thread the extra fields in trail assembly (`trail.push({ label: c.label, onClick: c.onClick, icon: c.icon, image: c.image })`), extract a small crumb-body helper, and change the render so a crumb with `onClick` is ALWAYS a button (last or not; the `--current` class still marks the last):

```jsx
const crumbBody = (c) => (
  <>
    {c.image && <img className="piano-chrome__crumb-thumb" src={c.image} alt="" />}
    {c.icon && <Icon name={c.icon} />}
    {c.label}
  </>
);
// in trail.map: cls = `piano-chrome__crumb${isLast ? ' piano-chrome__crumb--current' : ''}`
// c.onClick ? <button type="button" className={cls} onClick={c.onClick}>{crumbBody(c)}</button>
//           : <span className={cls}>{crumbBody(c)}</span>
```

SCSS (`PianoApp.scss`, next to the existing `.piano-chrome__crumb` rules):

```scss
.piano-chrome__crumb-thumb {
  width: 1.6em;
  height: 1.6em;
  object-fit: cover;
  border-radius: 0.3em;
  margin-right: 0.35em;
  vertical-align: middle;
}
```

- [ ] **Step 4: Run** `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoChrome.test.jsx` — PASS.

- [ ] **Step 5: Commit** `feat(piano): breadcrumbs carry thumbnails and icons; current crumb can act`

---

### Task 4: ModeSheet + header mode crumb; tabs leave the bar

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ModeSheet.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ModeSheet.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (crumbs at :94, ModeSheet mount)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (delete `ScoreModeTabs`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx`, `ScorePlayer.test.jsx` (mode switching now via header)

**Interfaces:**
- Consumes: `TransportSheet`, `TransportButton`, `Icon`; `usePianoBreadcrumb` crumb fields from Task 3; `titleFromScoreId` fallback already in meta.
- Produces: `ModeSheet({ open, onClose, mode, onPick })` — dialog "Mode", four rows; `onPick('listen'|'learn'|'polish'|'perform')` then closes. `MODES` export `[{ id, label, icon }]` with icons `mode-listen|mode-learn|mode-polish|mode-perform`. `ScoreTransportBar` loses `onMode`; its `mode` prop remains (gating).

- [ ] **Step 1: Failing test**

```jsx
// ModeSheet.test.jsx
import { render, fireEvent, screen } from '@testing-library/react';
import ModeSheet, { MODES } from './ModeSheet.jsx';

describe('ModeSheet', () => {
  it('offers the four modes with icons, current one lit, and picks', () => {
    const onPick = vi.fn(); const onClose = vi.fn();
    render(<ModeSheet open mode="listen" onPick={onPick} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Mode' })).toBeInTheDocument();
    expect(MODES.map((m) => m.id)).toEqual(['listen', 'learn', 'polish', 'perform']);
    const listen = screen.getByRole('button', { name: 'Listen' });
    expect(listen).toHaveAttribute('aria-pressed', 'true');
    expect(listen.querySelector('.piano-icon')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Polish' }));
    expect(onPick).toHaveBeenCalledWith('polish');
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement**

```jsx
// ModeSheet.jsx
import TransportSheet from '../../transport/TransportSheet.jsx';
import TransportButton from '../../transport/TransportButton.jsx';

// The practice ladder, selected from the header's mode crumb (wave-2 B).
export const MODES = [
  { id: 'listen', label: 'Listen', icon: 'mode-listen' },
  { id: 'learn', label: 'Learn', icon: 'mode-learn' },
  { id: 'polish', label: 'Polish', icon: 'mode-polish' },
  { id: 'perform', label: 'Perform', icon: 'mode-perform' },
];

/** Centered mode picker: four icon rows; picking switches and closes. */
export default function ModeSheet({ open, onClose, mode, onPick }) {
  return (
    <TransportSheet open={open} title="Mode" onClose={onClose}>
      <div className="piano-modesheet" role="group" aria-label="Score mode">
        {MODES.map((m) => (
          <TransportButton
            key={m.id}
            icon={m.icon}
            label={m.label}
            on={mode === m.id}
            aria-pressed={mode === m.id}
            className="piano-modesheet__opt"
            onPress={() => { onPick(m.id); onClose(); }}
          />
        ))}
      </div>
    </TransportSheet>
  );
}
```

`Transport.scss` append:

```scss
.piano-modesheet {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  .piano-tbtn { justify-content: flex-start; font-size: 1.1rem; }
}
```

In `ScorePlayer.jsx`: add `const [modeSheetOpen, setModeSheetOpen] = useState(false);`; find the existing mode-change handler passed to the bar as `onMode` (it calls `setMode`/`logMode` — reuse it as `onPick`). Replace the crumb publication (:94):

```jsx
const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
const openModeSheet = useCallback(() => setModeSheetOpen(true), []);
usePianoBreadcrumb(useMemo(() => [
  { label: meta.title, image: scoreMeta.splashImage || null },
  { label: modeMeta.label, icon: modeMeta.icon, onClick: openModeSheet },
], [meta.title, scoreMeta.splashImage, modeMeta, openModeSheet]));
```

Mount `<ModeSheet open={modeSheetOpen} onClose={() => setModeSheetOpen(false)} mode={mode} onPick={<existing onMode handler>} />` next to the bar. NOTE: `usePianoBreadcrumb` re-publishes when the label-join changes — mode label changes satisfy that; `image` is per-score-stable so its staleness caveat never bites.

In `ScoreTransportBar.jsx`: delete the `ScoreModeTabs` component and its render + the `MODES`/`onMode` plumbing (the `mode` prop stays for gating; Perform still renders only the page indicator — now with no tabs beside it).

- [ ] **Step 4: Fix test fallout** — `ScoreTransportBar.test.jsx`: remove/adjust tab-strip assertions (`role="tab"`, `Listen`/`Learn` tab queries); the memo-count assertions must remain byte-identical. `ScorePlayer.test.jsx`: `screen.getByText('Listen').click()` / `enterLearn()`-style helpers now go through the header: open the mode crumb (`screen.getByRole('button', { name: 'Listen' })` in the chrome — the test harness must render the breadcrumb consumer; if the harness doesn't mount PianoChrome, drive the mode via `ModeSheet` by opening it through the published crumb's `onClick`… read the harness first; the cleanest mechanical port is a test helper that clicks the mode crumb then the target mode button in the dialog). Run `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` until green.

- [ ] **Step 5: Commit** `feat(piano): score mode moves to the header — thumbnail crumb + ModeSheet; tabs leave the bar`

---

### Task 5: Key sheet speaks key names; transpose in all practice modes

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (`keyEnabled`)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx`

**Interfaces:**
- `KeySheet` props unchanged. Cell rendering changes: with known `keyFifths`, label = `soundingKeyLabel(keyFifths, keyMode, n)` and sub = offset string; without, label = offset (today's shape). Footer unchanged.
- `ScoreTransportBar`: `keyEnabled = mode !== 'perform'` (was `mode === 'listen'`); the `is-dimmed` wrapper logic keys off the same flag, so Learn/Polish get a live Key chip.

- [ ] **Step 1: Failing tests** — in `KeySheet.test.jsx` add:

```jsx
it('labels cells with sounding key names when the written key is known', () => {
  render(<KeySheet open onClose={() => {}} value={0} onPick={() => {}} keyFifths={0} keyMode="major" />);
  const plus2 = screen.getByRole('button', { name: /D major/ });
  expect(plus2.textContent).toContain('+2');
  expect(screen.getByRole('button', { name: /C major/ })).toHaveAttribute('aria-pressed', 'true');
});
it('falls back to offset labels when the key is unknown', () => {
  render(<KeySheet open onClose={() => {}} value={2} onPick={() => {}} />);
  expect(screen.getByRole('button', { name: '+2' })).toHaveAttribute('aria-pressed', 'true');
});
```

In `ScoreTransportBar.test.jsx` add: Learn renders the Key chip enabled (`expect(screen.getByRole('button', { name: 'Key' })).toBeEnabled()` with `mode="learn"`), and remove/flip any assertion that Key is disabled outside Listen.

- [ ] **Step 2: RED** (name queries miss; Learn Key currently disabled).

- [ ] **Step 3: Implement** — `KeySheet.jsx` row builder:

```jsx
const cell = (n) => {
  const name = soundingKeyLabel(keyFifths, keyMode, n);
  return name ? { label: name, sub: label(n) } : { label: label(n) };
};
const row = (values) => (
  <StepGrid
    steps={values.map(cell)}
    activeIndex={values.indexOf(v)}
    onPick={(i) => onPick(values[i])}
    ariaLabel={values[0] < 0 ? 'Transpose down' : values[0] === 0 ? 'No transpose' : 'Transpose up'}
  />
);
```

(Existing `label(n)` offset formatter stays; the footer can stay as-is — it reads as a summary line.) `ScoreTransportBar.jsx`: `const keyEnabled = mode !== 'perform';` — update the comment ("Key transpose acts in every practice mode; the engrave re-pitches and the evaluator follows the engraved steps").

- [ ] **Step 4: Run** `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/ frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/` — PASS. Watch for `ScorePlayer.test.jsx` tests that asserted transpose-only-in-Listen (the resume-gating tests around the transposed engrave must still pass — they key on engrave completion, not the chip's enablement).

- [ ] **Step 5: Commit** `feat(piano): key picker shows sounding key names; transpose opens to Learn and Polish`

---

### Task 6: Tempo — ♩BPM chip face, 3×3 ladder, icon-only metronome

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.jsx` (9-step ladder, 3 rows)
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (chip face; metronome face)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx`

**Interfaces:**
- `TEMPO_STEPS` becomes nine `{label, value}`: `50%…150%` at values `[0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5]`. `nearestStep` unchanged. `TempoSheet` renders three `StepGrid` rows of three (indices 0-2 / 3-5 / 6-8), each cell sub-labeled `♩ round(baseBpm × value)` via the `quarter-note` icon (exactly today's sub shape).
- Bar chip: `aria-label "Tempo"` stays; face becomes `<Icon name="quarter-note" />` + `{Math.round(baseBpm * tempoMult)}` + chevron (no "Tempo NNN%" text). Metronome button: icon-only `<Icon name="metronome" />`, aria-label "Metronome" unchanged, no bpm span.

- [ ] **Step 1: Failing tests** — `TempoSheet.test.jsx`: update the ladder assertion to the nine values; add `expect(screen.getAllByRole('group')).toHaveLength(3)` (three rows) and keep the pick/lit assertions (`125%` cell lit for value 1.25; picking `50%` emits 0.5). `ScoreTransportBar.test.jsx`: the Tempo chip shows the effective BPM (`baseBpm=90`, `tempoMult=1.25` → `expect(screen.getByRole('button', { name: 'Tempo' })).toHaveTextContent('113')`); the Metronome button no longer renders a BPM readout (`expect(screen.getByRole('button', { name: 'Metronome' }).textContent).toBe('')`).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement** — `TempoSheet.jsx`:

```jsx
export const TEMPO_STEPS = [
  { label: '50%', value: 0.5 }, { label: '60%', value: 0.6 }, { label: '70%', value: 0.7 },
  { label: '80%', value: 0.8 }, { label: '90%', value: 0.9 }, { label: '100%', value: 1 },
  { label: '110%', value: 1.1 }, { label: '125%', value: 1.25 }, { label: '150%', value: 1.5 },
];
// render: three rows over [0,3), [3,6), [6,9); each row a StepGrid whose
// activeIndex maps the GLOBAL nearestStep index into the row (or -1):
const idx = nearestStep(TEMPO_STEPS, value);
const row = (start) => (
  <StepGrid
    steps={TEMPO_STEPS.slice(start, start + 3).map((s) => ({
      label: s.label,
      sub: (<><Icon name="quarter-note" /> {Math.round(baseBpm * s.value)}</>),
    }))}
    activeIndex={idx >= start && idx < start + 3 ? idx - start : -1}
    onPick={(i) => onPick(TEMPO_STEPS[start + i].value)}
    ariaLabel={`Tempo ${start / 3 + 1}`}
  />
);
return (
  <TransportSheet open={open} title="Tempo" onClose={onClose}>
    {row(0)}{row(3)}{row(6)}
  </TransportSheet>
);
```

Bar (`ScoreTransportBar.jsx`, tempo chip): `label` prop drops; face built from children isn't supported by TransportButton's `label` string — so pass `label={String(Math.round(baseBpm * tempoMult))}` and `icon="quarter-note"` (chevron stays as a second icon? TransportButton renders one icon + label; add the chevron by keeping `icon="quarter-note"` and appending the chevron via the existing pattern used before wave 2 — if the current chip passes `icon="chevron-down"`, swap to `icon="quarter-note"` and drop the chevron; the sheet affordance is the chip itself). Metronome: remove `<span className="tabular-nums">{bpm}</span>` and swap `<Icon name="quarter-note" />` for `<Icon name="metronome" />`.

- [ ] **Step 4: Run** both test files + the SheetMusic dir — PASS.

- [ ] **Step 5: Commit** `feat(piano): tempo chip reads ♩BPM and opens a 3×3 picker; metronome goes icon-only`

---

### Task 7: Loop — repeat toggle + on/off without losing the range

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LoopControl.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LoopControl.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (`loopOn` state; `rangeSpan` gate at :190; pass-through props)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (thread two new props into `ScorePracticeCluster` → `LoopControl`)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx` (loop behavior tests)

**Interfaces:**
- `LoopControl` props: existing `{ active, scopeLabel, sections, onPickSection, onStartSelect, onClearFocus, onNudge }` PLUS `{ enabled = true, onToggleEnabled }`. `active` still means "a range exists"; `enabled` means "looping is on".
- Behavior: main button = `repeat` icon toggle, aria-label "Loop": no range → `onStartSelect()` (starts the on-score two-tap flow); range → `onToggleEnabled()`. Lit (`on`) when `active && enabled`. Label shows `scopeLabel` when active. Quiet `chevron-down` button (aria-label "Loop options") opens the LoopSheet. The one-tap clear button stays.
- `ScorePlayer`: `const [loopOn, setLoopOn] = useState(true);` — `setFocus` sites that SET a new range also `setLoopOn(true)` (section pick :952, custom select :896, nudge keeps current); `rangeSpan` memo (:190) becomes `focus && loopOn && mode !== 'perform' && layout.measures ? … : null`. `onClearFocus` unchanged (clearing kills the range). Pass `loopEnabled={loopOn}` and `onToggleLoop={() => setLoopOn(v => !v)}` down through the bar.

- [ ] **Step 1: Failing tests**

```jsx
// LoopControl.test.jsx — replace/extend the existing suite to the new contract:
it('with no range, the loop toggle starts on-score selection', () => {
  const onStartSelect = vi.fn();
  render(<LoopControl active={false} onStartSelect={onStartSelect} onToggleEnabled={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
  expect(onStartSelect).toHaveBeenCalled();
});
it('with a range, the toggle flips looping without clearing', () => {
  const onToggleEnabled = vi.fn(); const onClearFocus = vi.fn();
  render(<LoopControl active enabled scopeLabel="m9–m16" onToggleEnabled={onToggleEnabled} onClearFocus={onClearFocus} />);
  const btn = screen.getByRole('button', { name: 'Loop' });
  expect(btn).toHaveAttribute('aria-pressed', 'true');
  expect(btn.textContent).toContain('m9–m16');
  fireEvent.click(btn);
  expect(onToggleEnabled).toHaveBeenCalled();
  expect(onClearFocus).not.toHaveBeenCalled();
});
it('disabled-but-set range shows unlit toggle', () => {
  render(<LoopControl active enabled={false} scopeLabel="m9–m16" onToggleEnabled={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'false');
});
it('the chevron opens the loop sheet', () => {
  render(<LoopControl active sections={[{ label: 'A' }]} onToggleEnabled={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Loop options' }));
  expect(screen.getByRole('dialog', { name: 'Loop' })).toBeInTheDocument();
});
```

ScorePlayer behavior test (in `ScorePlayer.test.jsx`, using the existing loop-selection test as the template — the one that taps the scroll twice): after selecting a range, toggling Loop off keeps the range label visible but the cursor no longer wraps at the range end (assert via the position readout advancing past the range boundary where the wrap test asserts it wraps).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement** — `LoopControl.jsx`:

```jsx
const LoopControl = memo(function LoopControl({
  active = false, enabled = true, scopeLabel = '', sections = [],
  onPickSection, onStartSelect, onClearFocus, onNudge, onToggleEnabled,
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="piano-score-loop-wrap">
      <TransportButton
        icon="repeat"
        label={active ? scopeLabel : undefined}
        ariaLabel="Loop"
        on={active && enabled}
        aria-pressed={active && enabled}
        className="piano-score-loop-trigger"
        onPress={() => (active ? onToggleEnabled?.() : onStartSelect?.())}
      />
      <TransportButton icon="chevron-down" ariaLabel="Loop options" emphasis="quiet" onPress={() => setOpen(true)} />
      {active && (
        <TransportButton icon="close" ariaLabel="Clear loop" emphasis="quiet" onPress={() => onClearFocus?.()} />
      )}
      <LoopSheet
        open={open}
        onClose={() => setOpen(false)}
        active={active}
        sections={sections}
        onPickSection={onPickSection}
        onStartSelect={onStartSelect}
        onClearFocus={onClearFocus}
        onNudge={onNudge}
      />
    </div>
  );
});
```

`ScorePlayer.jsx`: add the state + gate + set-true sites exactly as the Interfaces block specifies; thread `loopEnabled`/`onToggleLoop` through `ScoreTransportBar` → `ScorePracticeCluster` → `LoopControl` (`enabled={loopEnabled}` `onToggleEnabled={onToggleLoop}`) — both are step-independent, memo discipline holds.

- [ ] **Step 4: Run** the SheetMusic dir — PASS (update any test that expected tapping Loop to open the old sheet directly: that's now the chevron).

- [ ] **Step 5: Commit** `feat(piano): loop is a direct toggle — select on the score, flip on/off without re-picking`

---

### Task 8: Label-less hands + divider; View becomes a sheet

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/HandsControl.jsx` (drop text label)
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ViewSheet.jsx` (from ViewMenu)
- Delete: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ViewMenu.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (View trigger opens the sheet; popover backdrop machinery removed; divider before hands)
- Modify: `frontend/src/Apps/PianoApp.scss` (`.piano-score-divider`; remove dead `.piano-score-view-menu`/`.piano-score-view-about` blocks)
- Tests: `HandsControl.test.jsx`, new `ViewSheet.test.jsx` (port from any ViewMenu coverage), `ScoreTransportBar.test.jsx`

**Interfaces:**
- `HandsControl`: unchanged props; renders the two toggles inside the `role="group"` (aria-label "Hands"/"My part" KEPT for accessibility) but NO visible `<span>` label.
- `ViewSheet({ open, onClose, flow, onToggleFlow, scale, onScale, keyboardVisible, onToggleKeyboard })` — TransportSheet "View": Layout row = `TransportButton icon="layout-down" label="Down the page"` / `icon="layout-across" label="Across"` (same `on`/guard logic as ViewMenu); Size row = the existing 5-step `StepGrid`; Keyboard toggle row. NO `meta` prop, NO metadata `<dl>`.
- Bar: `openPopover` state collapses to a boolean per sheet pattern (`viewOpen`); the shared backdrop block is deleted (no popovers remain).

- [ ] **Step 1: Failing tests** — `HandsControl.test.jsx`: `expect(screen.queryByText('Hands')).toBeNull()` (visible label gone) while `getByRole('group', { name: /hands/i })` still resolves. `ViewSheet.test.jsx`: dialog "View" renders; Layout buttons carry `.piano-icon` (no text-only faces… they have labels too — assert icon presence); `expect(screen.queryByText('Title')).toBeNull()` (metadata gone); size pick emits value; keyboard toggle fires. `ScoreTransportBar.test.jsx`: clicking View opens dialog "View" (was popover).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement** — `HandsControl.jsx`: delete the `<span className="piano-score-hands__label">` line, keep the group aria-label. `ViewSheet.jsx`: port ViewMenu's rows onto `TransportSheet`, layout buttons gain `icon="layout-down"`/`icon="layout-across"`, delete the `<dl>` and the `meta` prop. Bar: replace the ViewMenu mount + `openPopover === 'view'` logic with `viewOpen` boolean + `<ViewSheet open={viewOpen} …/>`; delete the backdrop `<button className="piano-score-popover-backdrop">` block and the now-unused `openPopover` machinery IF Key/Tempo already use their own booleans (they do since wave 1 used `openPopover` — collapse all three to independent booleans: `keyOpen`, `tempoOpen`, `viewOpen`; sheets self-dismiss via scrim so single-open discipline is inherent — two sheets can't stack because each opens from a tap that the open scrim would swallow). Divider: render `<span className="piano-score-divider" aria-hidden />` before the hands/parts cluster in `ScoreViewControls`; SCSS: `.piano-score-divider { width: 1px; align-self: stretch; background: rgba(255,255,255,0.18); margin: 0 0.35rem; }`. Remove dead `.piano-score-view-menu` / `.piano-score-view-about` / `.piano-score-popover-backdrop` SCSS blocks (verify each has no remaining consumer first: `grep -rn "<class>" frontend/src/`).

- [ ] **Step 4: Run** the SheetMusic + transport dirs — PASS.

- [ ] **Step 5: Commit** `feat(piano): hands lose their label for a divider; View becomes a centered sheet`

---

### Task 9: Video chrome on the shared primitives

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx` (rows → TransportButton)
- Modify: `frontend/src/Apps/PianoApp.scss` (sweep superseded `.piano-video-chrome__btn` FACE styles; keep row/bar/spacer/time layout rules)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx` (selector updates only — behavior identical)

**Interfaces:**
- Every `<button className="piano-video-chrome__btn …">` becomes `TransportButton` with: same icon names, same aria-labels, same disabled conditions (`gateOpen`, `forwardDisabled`, sequential hiding), `className="piano-video-chrome__btn"` kept as the LAYOUT hook. Play: `emphasis="primary"` + `icon={isPlaying ? 'pause' : 'play'}`. Rate chip: `label={`${rate}x`}` (ASCII `x` — the old face used `×` U+00D7 which is allowed typography, but keep it: `×` is not in the banned set; keep the existing face text verbatim). Loop group: mark-A `className` gains `is-arming` state via TransportButton's `on={loop?.a != null && loop?.b == null}`? NO — `is-arming` is a distinct visual state: keep the group's existing conditional classes by passing them through `className` (`className={`piano-video-chrome__btn${armingA ? ' is-arming' : ''}`}`), `on` only for the loop-active toggle. Fullscreen/restart/skips: plain conversions.
- The seek bar, marks, time readout, and `VolumeControl` mount are untouched.

- [ ] **Step 1:** Read the current file + its test; convert row buttons mechanically per the Interfaces block.
- [ ] **Step 2: Run** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/` — fix selector fallout only (aria-labels unchanged, so role/name queries survive; class-face assertions may need `.piano-tbtn`).
- [ ] **Step 3:** SCSS sweep: in `PianoApp.scss`, the `.piano-video-chrome__btn` rule block (≈:1714) — remove FACE properties (background/border/radius/color/min-sizes) superseded by `.piano-tbtn`, keep it only if layout-specific rules remain (flex order/margins); verify with `grep -n "piano-video-chrome__btn" frontend/src/Apps/PianoApp.scss` that what stays is layout-only. Full kiosk suite run.
- [ ] **Step 4: Commit** `refactor(piano): course-video chrome renders through the shared transport primitives`

---

### Task 10: Data — tab YAML, file reorg, .mxl title sweep

All container/data work; **no repo code**. Use `sudo docker exec daylight-station sh -c '…'` from the host. The media volume is writable only via the container (host mount is read-only for this user). REMINDER: files were listed at `media/docs/sheet-music/` earlier — verify paths before moving.

- [ ] **Step 1: Reorganize score files**

```bash
sudo docker exec daylight-station sh -c '
cd media/docs/sheet-music &&
mkdir -p video-games tv-shows &&
rm -f ._* &&
mv the-adventures-of-tintin-theme.* tv-shows/ &&
mv *.mxl *.jpg video-games/ 2>/dev/null;
ls -R .'
```

Expected: `video-games/` holds the 9 game pieces + sidecars, `tv-shows/` holds Tintin, no `._*` junk, nothing loose. (The trailing `mv` errors when nothing is left — the `2>/dev/null` swallows that; verify with the `ls -R`.)

- [ ] **Step 2: Title sweep** — write `/tmp/mxl-titles.mjs` INTO the container via base64 (the claude sudoers matches `docker exec daylight-station` without `-i`, so pipe via an embedded base64 string as done for piano.yml earlier) and run it with the container's node:

```js
// mxl-titles.mjs — idempotent: writes <work-title>/<movement-title> into each .mxl
// (they are ZIPs; adm-zip is in /usr/src/app/node_modules). Title = curated map
// else prettified filename.
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
const ROOT = 'media/docs/sheet-music';
const CURATED = {
  'super-mario-theme': 'Super Mario Theme',
  'mario-circut-from-super-mario-kart': 'Mario Circuit (Super Mario Kart)',
  'overworld-theme-super-mario-world': 'Overworld Theme (Super Mario World)',
  'super-mario-land-2-six-golden-coins-overworld-theme': 'Overworld Theme (Super Mario Land 2)',
  'super-mario-land-world-1-solo-piano': 'World 1 (Super Mario Land)',
  'creature-red-blue-and-yellow-trainer-battle-music': 'Trainer Battle (Creature Red/Blue/Yellow)',
  'creature-red-blue-gbc-road-to-viridian-city': 'Road to Viridian City (Creature Red/Blue)',
  'green-hill-zone-sonic-the-hedgehog': 'Green Hill Zone (Sonic the Hedgehog)',
  'the-adventures-of-tintin-theme': 'The Adventures of Tintin Theme',
};
const pretty = (s) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.mxl') ? [path.join(d, e.name)] : []);
for (const file of walk(ROOT)) {
  const base = path.basename(file, '.mxl');
  const title = CURATED[base] || pretty(base);
  const zip = new AdmZip(file);
  const entry = zip.getEntries().find((e) => /\.(musicxml|xml)$/i.test(e.entryName) && !e.entryName.startsWith('META-INF'));
  if (!entry) { console.log(`SKIP (no xml): ${file}`); continue; }
  let xml = zip.readAsText(entry);
  if (/<work-title>\s*\S[^<]*<\/work-title>/.test(xml)) { console.log(`OK (titled): ${file}`); continue; }
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (/<work>/.test(xml)) xml = xml.replace(/<work>/, `<work><work-title>${esc}</work-title>`);
  else xml = xml.replace(/(<score-partwise[^>]*>)/, `$1<work><work-title>${esc}</work-title></work>`);
  if (!/<movement-title>/.test(xml)) xml = xml.replace(/(<work>[\s\S]*?<\/work>)/, `$1<movement-title>${esc}</movement-title>`);
  zip.updateFile(entry.entryName, Buffer.from(xml));
  zip.writeZip(file);
  console.log(`TITLED: ${file} -> ${title}`);
}
```

Verify afterwards: stream one score through the API and grep `<work-title>` (the streamed text should now contain it).

- [ ] **Step 3: piano.yml** — pull the live file (`sudo docker exec daylight-station sh -c 'cat data/household/config/piano.yml'` → scratchpad), replace the `sheetmusic:` section's `collection: files:docs/sheet-music` with:

```yaml
sheetmusic:
  collections:
    - label: Video Games
      ref: files:docs/sheet-music/video-games
    - label: TV Shows
      ref: files:docs/sheet-music/tv-shows
```

(keep any sibling keys like `defaultMode`/`scoring` untouched), write back via base64 (the established pattern), then `curl -s -X POST "http://localhost:3111/api/v1/system/reload?app=piano"` → expect `{"ok":true,"reloaded":["piano"]}`.

- [ ] **Step 4:** No commit (data volume, not the repo). Record results in the task report.

---

### Task 11: Suite, reference docs, merge, build, deploy, verify

- [ ] **Step 1:** `npx vitest run frontend/src/modules/Piano/PianoKiosk/` — all tests pass (capture counts honestly; known teardown-flake exit-code noise acceptable when pass count is total).
- [ ] **Step 2:** Update `docs/reference/piano/sheet-music-player.md` (present-tense endstate: header thumbnail + mode selector, key-name transpose in all practice modes, ♩BPM tempo chip + 3×3 picker, loop toggle semantics, View sheet, label-less hands, subtle highlight ink, score tabs) and `docs/reference/piano/README.md` (tab model + one-element-bank note covering the video chrome). No class names, no history, no instance values. Commit `docs(piano): sheet-music redesign + score tabs in the reference docs`.
- [ ] **Step 3 (controller):** merge to main (`git pull origin main` FIRST — Watchtower/stale-hub lesson), run the merged suite, push.
- [ ] **Step 4 (controller):** `./scripts/build-daylight.sh`; deploy gates (video/fitness checks per CLAUDE.local.md) as their own step; `sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight`.
- [ ] **Step 5 (controller):** reload the piano tablet (FKB `10.0.0.245:2323` loadStartURL via container node + URLSearchParams); verify: `/build.txt` commit, tablet re-registration in logs, headless Playwright screenshots of `/piano/sheetmusic` (tabs visible) and a score (new bar), and the video player chrome.

---

## Self-review notes (applied)

- Spec §A→T1, §B→T3+T4, §C→T2+T10, §D→T5, §E→T6, §F→T7, §G+§H→T8, §J→T9, §I→T10+T11. Icons pre-committed (3ca278473).
- Prop-name consistency: `loopEnabled`/`onToggleLoop` (ScorePlayer→bar) map to LoopControl's `enabled`/`onToggleEnabled`; `MODES` exported from ModeSheet only; `TEMPO_STEPS` still has exactly one home.
- The `×` in the rate chip and `›` separator are typography in text/labels, not icon substitutes; the glyph-scan test's banned set excludes them deliberately.
