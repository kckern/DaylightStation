# Piano Kiosk Settings Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rip-and-replace the piano kiosk settings surface with a player-first Sound Panel (tap the chip) and a hidden Operator Drawer (long-press), backed by a single `applyBundle()` re-assert path and per-user sound presets.

**Architecture:** A player-facing Sound Panel (voice funnel + tone + save) opens on chip tap; an Operator Drawer (connect, MIDI monitor, test outputs, screen-off, ranked recovery, feedback) opens on chip long-press. Every sound change routes through one `applyBundle(bundle)` that re-asserts the full state (voice + reverb + chorus + volume) via the EXISTING working MIDI senders. Presets persist per-user in `preset.yml`; selecting a user auto-applies their default.

**Tech Stack:** React (frontend `.jsx`), Node/Express backend (`.mjs`), YAML persistence, vitest. Grounded in `docs/_wip/plans/2026-07-11-piano-kiosk-settings-rebuild-design.md` and its audit.

## Global Constraints

- **Reuse the existing transport — do NOT invent a new one.** Reverb/chorus/volume/voice already work via the existing senders. `applyBundle` re-invokes them; it must not add SysEx, a bridge path, or new MIDI plumbing.
  - Voice: `usePianoSound().selectVoice(voice)` → `usePianoMidi().sendVoice(pc, bank)` (PC + Bank Select).
  - Reverb/Chorus: `usePianoSound().setEffect(name, patch)` → `sendControlChange(typeCC, levelCC)` (device profile `suzukiMdg400.js EFFECTS`: reverb 80/91, chorus 81/93).
  - Volume: `PianoMixContext` `setPianoLevel(v)` → `sendControlChange(7, cc)` (CC7).
- **Player Panel is 100% player-safe.** Nothing destructive (Panic, Local, Reload, raw MIDI, test outputs) is reachable from it. Operator tools live ONLY behind the long-press drawer.
- **Single onboard engine.** The rendered voice-bridge (`usePianoVoiceBridge`) is removed from the surface / stubbed. Its only consumers are `PianoSoundContext.jsx` and the `bridgeLink` badge in `PianoSettingsSheet.jsx` (being replaced).
- **Per-user persistence pattern:** clone `YamlPianoStudioDatastore.getPreferences/savePreferences` → `getPreset/savePreset` (`preset.yml`); clone the `/users/:userId/preferences` GET/PUT routes in `piano.mjs` → `/users/:userId/preset`. NO `api.mjs` routeMap change (piano router already mounted). Frontend hook mirrors `usePianoPreferences.js`, keyed off `usePianoUser().currentUser`.
- **Config:** add a `shortlist:` block mirroring the existing `karaoke:` merge in `PianoConfig.jsx` (`PIANO_CONFIG_DEFAULTS` + `resolvePianoConfig`). Runtime loads `config/piano.yml` (cached at startup — needs reload to take effect).
- **Node ESM `.mjs`** backend, **`.jsx`** frontend, co-located `*.test.*`, vitest run per-file (`npx vitest run <path>`). Frontend build: `cd frontend && npm run build`.
- **Bundle shape (canonical):**
  ```
  Bundle = { voice: {pc:number, bank:number, name:string},
             reverb: {type:number, level:number, on:boolean},
             chorus: {type:number, level:number, on:boolean},
             volume: number }
  ```

## Data Shapes

```
Bundle       = see Global Constraints
PresetFile   = { default: Bundle|null, favorites: Bundle[] }   // users/{id}/apps/piano/preset.yml
VoiceEntry   = { no:number, name:string, pc:number, bank:number }   // from suzukiMdg400.js
VoiceGroup   = { group:string, voices: VoiceEntry[] }
```

## File Structure

```
frontend/src/modules/Piano/PianoKiosk/
  applyBundle.js               T1  pure bundle→ordered-ops planner (+ test)
  usePianoSoundBundle.js       T4  wires planner to live senders + current-bundle read
  useLongPress.js              T2  shared long-press hook (+ test)
  usePianoPreset.js            T5  per-user preset GET/PUT hook + auto-apply (+ test)
  voiceFunnel.js               T6  favorites→shortlist→grouped dedup (pure, + test)
  SoundPanel.jsx               T7  player sound panel (funnel + tone + save)
  OperatorDrawer.jsx           T8  long-press drawer (connect/monitor/test/screen-off/recovery/feedback)
  PianoChrome.jsx              T9  chip: tap→panel, long-press→drawer, reconnect-inline
  PianoSoundContext.jsx        T3  stub rendered-voice bridge; expose device bundle + applyBundle hook point
  PianoConfig.jsx              T5  add shortlist default+merge
backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs   T5  getPreset/savePreset
backend/src/4_api/v1/routers/piano.mjs                       T5  /users/:userId/preset GET/PUT
(removed) PianoSettingsSheet.jsx, PianoKeyboardPanel.jsx     T9  deleted/superseded
```

---

### Task 1: `applyBundle` planner (pure)

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/applyBundle.js` + `applyBundle.test.js`

**Interfaces:**
- Produces: `planBundleOps(bundle) → Op[]` where `Op = {kind:'voice'|'reverb'|'chorus'|'volume', ...}` in the canonical order (voice → reverb → chorus → volume). Pure — no MIDI. A later task binds ops to senders.

- [ ] **Step 1: failing test**
```javascript
// applyBundle.test.js
import { describe, it, expect } from 'vitest';
import { planBundleOps } from './applyBundle.js';

const bundle = {
  voice: { pc: 16, bank: 0, name: 'Upright' },
  reverb: { type: 3, level: 72, on: true },
  chorus: { type: 0, level: 0, on: false },
  volume: 100,
};
describe('planBundleOps', () => {
  it('emits voice → reverb → chorus → volume in order', () => {
    expect(planBundleOps(bundle)).toEqual([
      { kind: 'voice', pc: 16, bank: 0 },
      { kind: 'reverb', type: 3, level: 72, on: true },
      { kind: 'chorus', type: 0, level: 0, on: false },
      { kind: 'volume', value: 100 },
    ]);
  });
  it('skips legs missing from a partial bundle but keeps order', () => {
    expect(planBundleOps({ voice: { pc: 1, bank: 0 }, volume: 90 }))
      .toEqual([{ kind: 'voice', pc: 1, bank: 0 }, { kind: 'volume', value: 90 }]);
  });
  it('returns [] for a null/empty bundle', () => {
    expect(planBundleOps(null)).toEqual([]);
    expect(planBundleOps({})).toEqual([]);
  });
});
```
- [ ] **Step 2: run, expect FAIL** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/applyBundle.test.js`
- [ ] **Step 3: implement**
```javascript
// applyBundle.js
// Pure planner: turn a sound Bundle into the ordered list of re-assert ops.
// Order matters — voice (PC/bank) first, then reverb, chorus, volume — so a
// full re-assert always lands the same way regardless of what triggered it.
export function planBundleOps(bundle) {
  if (!bundle || typeof bundle !== 'object') return [];
  const ops = [];
  if (bundle.voice && bundle.voice.pc != null) {
    ops.push({ kind: 'voice', pc: bundle.voice.pc, bank: bundle.voice.bank || 0 });
  }
  if (bundle.reverb && bundle.reverb.type != null) {
    ops.push({ kind: 'reverb', type: bundle.reverb.type, level: bundle.reverb.level || 0, on: !!bundle.reverb.on });
  }
  if (bundle.chorus && bundle.chorus.type != null) {
    ops.push({ kind: 'chorus', type: bundle.chorus.type, level: bundle.chorus.level || 0, on: !!bundle.chorus.on });
  }
  if (bundle.volume != null) {
    ops.push({ kind: 'volume', value: bundle.volume });
  }
  return ops;
}
```
- [ ] **Step 4: run, expect PASS**
- [ ] **Step 5: commit** — `git add frontend/src/modules/Piano/PianoKiosk/applyBundle.js frontend/src/modules/Piano/PianoKiosk/applyBundle.test.js && git commit -m "feat(piano): applyBundle ordered-ops planner"`

---

### Task 2: `useLongPress` hook

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/useLongPress.js` + `useLongPress.test.js`

**Interfaces:** Produces `useLongPress(onLongPress, { holdMs=550, moveCancelPx=10, onTap } = {}) → handlers` where `handlers = {onPointerDown, onPointerUp, onPointerMove, onPointerLeave, onPointerCancel}`. Extract the pattern inlined in `producer/LibraryBrowser.jsx` (pointerdown starts a `holdMs` timer; move past `moveCancelPx` cancels; up before fire → `onTap`, after fire → suppressed). Timers via fake timers in tests.

- [ ] **Step 1: failing test**
```javascript
// useLongPress.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLongPress } from './useLongPress.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function down(h, x = 0, y = 0) { h.onPointerDown({ clientX: x, clientY: y }); }

describe('useLongPress', () => {
  it('fires onLongPress after holdMs and suppresses the tap', () => {
    const onLong = vi.fn(); const onTap = vi.fn();
    const { result } = renderHook(() => useLongPress(onLong, { holdMs: 500, onTap }));
    down(result.current); vi.advanceTimersByTime(500);
    result.current.onPointerUp({});
    expect(onLong).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });
  it('fires onTap on a quick release (before holdMs)', () => {
    const onLong = vi.fn(); const onTap = vi.fn();
    const { result } = renderHook(() => useLongPress(onLong, { holdMs: 500, onTap }));
    down(result.current); vi.advanceTimersByTime(200); result.current.onPointerUp({});
    expect(onLong).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledTimes(1);
  });
  it('cancels the long-press when the pointer drifts past moveCancelPx', () => {
    const onLong = vi.fn();
    const { result } = renderHook(() => useLongPress(onLong, { holdMs: 500, moveCancelPx: 8 }));
    down(result.current, 0, 0);
    result.current.onPointerMove({ clientX: 20, clientY: 0 });
    vi.advanceTimersByTime(500);
    expect(onLong).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2: run, expect FAIL**
- [ ] **Step 3: implement**
```javascript
// useLongPress.js
import { useCallback, useRef } from 'react';

// Shared press-and-hold: hold ≥ holdMs → onLongPress (and suppress the tap);
// quick release → onTap; drift past moveCancelPx → cancel. Mirrors the inlined
// pattern in producer/LibraryBrowser.jsx, extracted for the settings chip seam.
export function useLongPress(onLongPress, { holdMs = 550, moveCancelPx = 10, onTap } = {}) {
  const timer = useRef(null);
  const start = useRef(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const onPointerDown = useCallback((e) => {
    fired.current = false;
    start.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    clear();
    timer.current = setTimeout(() => { fired.current = true; onLongPress?.(); }, holdMs);
  }, [clear, holdMs, onLongPress]);

  const onPointerMove = useCallback((e) => {
    if (!start.current || timer.current === null) return;
    const dx = (e.clientX ?? 0) - start.current.x;
    const dy = (e.clientY ?? 0) - start.current.y;
    if (Math.hypot(dx, dy) > moveCancelPx) clear();
  }, [clear, moveCancelPx]);

  const onPointerUp = useCallback(() => {
    const wasArmed = timer.current !== null;
    clear();
    if (!fired.current && wasArmed) onTap?.();
  }, [clear, onTap]);

  const onPointerLeave = clear;
  const onPointerCancel = clear;
  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onPointerCancel };
}
```
- [ ] **Step 4: run, expect PASS**
- [ ] **Step 5: commit** — `feat(piano): useLongPress hook (chip tap vs long-press seam)`

---

### Task 3: Stub the rendered-voice bridge in `PianoSoundContext`

**Files:** Modify `frontend/src/modules/Piano/PianoKiosk/PianoSoundContext.jsx`. Test: extend/keep `PianoSoundContext.test.jsx` green.

**Interfaces:**
- Consumes: existing device path (`device`, `deviceVoice`, `selectVoice`, `effects`, `setEffect`, `resync`).
- Produces: the context value keeps `device/deviceVoice/selectVoice/effects/setEffect/resync`; the rendered-voice members (`sources`, `active`, `activeId`, `activeName`, `select`, `gainDb`, `reverbMix`, `setGain`, `setReverb`, `hasInstruments`, `bridgeLink`) are removed or hard-stubbed to inert defaults. `usePianoVoiceBridge` is no longer instantiated.

- [ ] **Step 1:** Read `PianoSoundContext.jsx`. Remove the `usePianoVoiceBridge` import + instantiation and the `instruments`/`sources`/rendered branches of `select()`/`resync()`. Keep the device (MDG-400) path intact: `selectVoice`, `setEffect`, and `resync()` (voice + reverb + chorus). Leave `bridgeLink` exported as a constant `null` if any remaining consumer reads it (it will be deleted in T9).
- [ ] **Step 2:** Run `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoSoundContext.test.jsx PianoSoundContext.jsx`-adjacent tests; update assertions that referenced rendered-voice members to the stubbed shape. Do not weaken device-path assertions.
- [ ] **Step 3:** Run the piano test dir to catch consumers: `npx vitest run frontend/src/modules/Piano/PianoKiosk/`. Fix only compile/reference breakage caused by the stub (e.g. a test importing `hasInstruments`).
- [ ] **Step 4: commit** — `refactor(piano): single onboard engine — stub rendered-voice bridge in PianoSoundContext`

---

### Task 4: `usePianoSoundBundle` — bind planner to live senders

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/usePianoSoundBundle.js` + `usePianoSoundBundle.test.js`

**Interfaces:**
- Consumes: `planBundleOps` (T1); `usePianoSound()` (`selectVoice`, `setEffect`, `deviceVoice`, `effects`); `usePianoMix()` (`setPianoLevel`, current level) from `PianoMixContext`.
- Produces: `usePianoSoundBundle() → { currentBundle, applyBundle(bundle) }`. `applyBundle` runs `planBundleOps(bundle)` and dispatches each op to the existing sender: `voice→selectVoice({pc,bank})`, `reverb→setEffect('reverb',{type,level,on})`, `chorus→setEffect('chorus',{type,level,on})`, `volume→setPianoLevel(value)`. `currentBundle` reads the live device voice + effects + mix level into a `Bundle`.

- [ ] **Step 1: failing test** (inject fake sound/mix via the module's deps — mock `usePianoSound`/`usePianoMix`)
```javascript
// usePianoSoundBundle.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const selectVoice = vi.fn(), setEffect = vi.fn(), setPianoLevel = vi.fn();
vi.mock('./PianoSoundContext.jsx', () => ({
  usePianoSound: () => ({
    selectVoice, setEffect,
    deviceVoice: { pc: 4, bank: 0, name: 'EP' },
    effects: { reverb: { type: 2, level: 40, on: true }, chorus: { type: 1, level: 10, on: true } },
  }),
}));
vi.mock('./PianoMixContext.jsx', () => ({
  usePianoMix: () => ({ setPianoLevel, level: 88 }),
}));
import { usePianoSoundBundle } from './usePianoSoundBundle.js';

describe('usePianoSoundBundle', () => {
  it('applyBundle dispatches voice, reverb, chorus, volume to the live senders in order', () => {
    const { result } = renderHook(() => usePianoSoundBundle());
    result.current.applyBundle({
      voice: { pc: 16, bank: 0 }, reverb: { type: 3, level: 72, on: true },
      chorus: { type: 0, level: 0, on: false }, volume: 100,
    });
    expect(selectVoice).toHaveBeenCalledWith({ pc: 16, bank: 0 });
    expect(setEffect).toHaveBeenNthCalledWith(1, 'reverb', { type: 3, level: 72, on: true });
    expect(setEffect).toHaveBeenNthCalledWith(2, 'chorus', { type: 0, level: 0, on: false });
    expect(setPianoLevel).toHaveBeenCalledWith(100);
  });
  it('currentBundle reflects the live device voice + effects + mix level', () => {
    const { result } = renderHook(() => usePianoSoundBundle());
    expect(result.current.currentBundle).toEqual({
      voice: { pc: 4, bank: 0, name: 'EP' },
      reverb: { type: 2, level: 40, on: true },
      chorus: { type: 1, level: 10, on: true },
      volume: 88,
    });
  });
});
```
- [ ] **Step 2: run, expect FAIL**
- [ ] **Step 3: implement** `usePianoSoundBundle.js` — read the two contexts, build `currentBundle` from `deviceVoice`/`effects`/`level`, and `applyBundle` maps `planBundleOps` ops to `selectVoice`/`setEffect`/`setPianoLevel`. (Confirm the exact `selectVoice` arg shape from `PianoSoundContext.jsx` and match it; the design/exploration show `selectVoice(voice)` where voice carries `pc`/`bank`.)
- [ ] **Step 4: run, expect PASS**
- [ ] **Step 5: commit** — `feat(piano): usePianoSoundBundle — one applyBundle over existing senders`

---

### Task 5: Per-user preset persistence (backend + config + frontend hook)

**Files:**
- Modify `backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs` (add `getPreset`/`savePreset`)
- Modify `backend/src/4_api/v1/routers/piano.mjs` (add `/users/:userId/preset` GET/PUT)
- Modify `frontend/src/modules/Piano/PianoKiosk/PianoConfig.jsx` (add `shortlist` default+merge)
- Create `frontend/src/modules/Piano/PianoKiosk/usePianoPreset.js` + `usePianoPreset.test.js`
- Test: `backend` datastore/route tests alongside existing piano router tests.

**Interfaces:**
- Backend: `getPreset(userId) → PresetFile|null` (null on unknown user), `savePreset(userId, data) → bool`. Routes: `GET /users/:userId/preset` → PresetFile (400 invalid user); `PUT /users/:userId/preset` shallow-merges body → saved PresetFile.
- Frontend: `usePianoPreset() → { preset, saveDefault(bundle), addFavorite(bundle) }`, keyed off `usePianoUser().currentUser`; auto-applies `preset.default` via `usePianoSoundBundle().applyBundle` in a `useEffect` on `currentUser` change (graceful: if no `default`, do NOT reset — leave current sound). Config: `usePianoKioskConfig().config.shortlist` available (default `{ presetIds: [] }`... see design §4a — actually a list of voice bundles; use `{ voices: [] }`).

- [ ] **Step 1:** Backend — add `getPreset`/`savePreset` cloned from `getPreferences`/`savePreferences` (path `preset`), and the two routes cloned from the `/preferences` routes. Add a datastore test asserting round-trip + unknown-user null, and a route test (supertest-style, matching existing piano router tests) for GET/PUT + 400. Run those tests → PASS.
- [ ] **Step 2:** Config — add `shortlist: { voices: [] }` to `PIANO_CONFIG_DEFAULTS` and the mirror merge line in `resolvePianoConfig` (exactly like `karaoke:`). Extend `PianoConfig.test.js` with a shortlist default+override case. Run → PASS.
- [ ] **Step 3:** Frontend hook — write `usePianoPreset.js` (GET on mount/user-change via `DaylightAPI('api/v1/piano/users/'+userId+'/preset')`; `saveDefault`/`addFavorite` PUT; auto-apply default on user change through `usePianoSoundBundle`). Write `usePianoPreset.test.js` mocking `DaylightAPI` + `usePianoUser` + `usePianoSoundBundle`, asserting: loads on user change, auto-applies default, no-reset when default absent, saveDefault/addFavorite PUT the right body (favorites dedup by voice+tone). Run → PASS.
- [ ] **Step 4: commit** — `feat(piano): per-user sound presets (preset.yml store + routes + hook) and shortlist config`

---

### Task 6: Voice funnel (pure)

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/voiceFunnel.js` + `voiceFunnel.test.js`

**Interfaces:** Produces `buildFunnel({ favorites, shortlistVoices, allGroups }) → { favorites: Bundle[], shortlist: VoiceEntry[], groups: VoiceGroup[] }` where shortlist is deduped against favorites (by voice pc+bank) and groups is the full `VOICE_GROUPS`. `bundleKey(bundle) → string` (pc:bank) for dedup.

- [ ] **Step 1: failing test** — favorites top-N passthrough; shortlist minus favorites (dedup by pc:bank); groups untouched; empty inputs safe.
```javascript
// voiceFunnel.test.js
import { describe, it, expect } from 'vitest';
import { buildFunnel, bundleKey } from './voiceFunnel.js';
const fav = [{ voice: { pc: 16, bank: 0 } }];
const shortlist = [{ pc: 16, bank: 0, name: 'Upright' }, { pc: 0, bank: 0, name: 'Grand' }];
const groups = [{ group: 'Piano', voices: [{ pc: 0, bank: 0, name: 'Grand' }] }];
describe('buildFunnel', () => {
  it('dedups shortlist against favorites by pc:bank', () => {
    const out = buildFunnel({ favorites: fav, shortlistVoices: shortlist, allGroups: groups });
    expect(out.favorites).toEqual(fav);
    expect(out.shortlist).toEqual([{ pc: 0, bank: 0, name: 'Grand' }]);
    expect(out.groups).toEqual(groups);
  });
  it('handles empty inputs', () => {
    expect(buildFunnel({})).toEqual({ favorites: [], shortlist: [], groups: [] });
  });
});
describe('bundleKey', () => {
  it('keys by pc:bank', () => { expect(bundleKey({ voice: { pc: 5, bank: 1 } })).toBe('5:1'); });
});
```
- [ ] **Step 2: run, expect FAIL**
- [ ] **Step 3: implement** `voiceFunnel.js` (pure).
- [ ] **Step 4: run, expect PASS**
- [ ] **Step 5: commit** — `feat(piano): voice funnel (favorites → shortlist → grouped, deduped)`

---

### Task 7: Player Sound Panel

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/SoundPanel.jsx`. Add styles to `frontend/src/Apps/PianoApp.scss`. Test: `SoundPanel.test.jsx`.

**Interfaces:** `<SoundPanel open onClose />`. Composes `usePianoSoundBundle`, `usePianoPreset`, `usePianoKioskConfig().config.shortlist`, `buildFunnel`, device `VOICE_GROUPS`. Regions: (4a) funnel — Favorites tiles → house shortlist → "Browse all" grouped; selecting a voice → `applyBundle(currentBundle with new voice)`. (4b) tone — reverb (type+level), chorus (type+level), volume; each change → `applyBundle`. (4c) save — "Save as my default" → `saveDefault(currentBundle)`, "Add to favorites" → `addFavorite(currentBundle)`. NO destructive/operator controls.

- [ ] **Step 1: failing test** — render with mocked hooks: shows favorites + shortlist (deduped) + a browse-all toggle; tapping a voice calls `applyBundle`; tone control calls `applyBundle`; Save default/favorite call the preset hook. Assert NO "Panic"/"Reload app"/"MIDI monitor" text is present (player-safe).
- [ ] **Step 2: run, expect FAIL**
- [ ] **Step 3: implement** `SoundPanel.jsx` + `.piano-sound-panel` styles. Reuse `usePianoBreadcrumb`? No — it's an overlay sheet, keep it self-contained (open/onClose), matching the existing sheet's overlay mechanics.
- [ ] **Step 4: run, expect PASS**; then `cd frontend && npm run build` must succeed.
- [ ] **Step 5: commit** — `feat(piano): Player Sound Panel (funnel + tone + save)`

---

### Task 8: Operator Drawer

**Files:** Create `frontend/src/modules/Piano/PianoKiosk/OperatorDrawer.jsx`. Styles in `PianoApp.scss`. Test: `OperatorDrawer.test.jsx`.

**Interfaces:** `<OperatorDrawer open onClose />`. Sections (moved verbatim from the old sheet, wiring unchanged): Hardware (status + Connect via `usePianoSound().connect`/`usePianoMidi`, Bluetooth via `launchAndroidTarget(config.bluetooth)`), Diagnostics (`<PianoMidiMonitor/>` — includes its test outputs PC/Local/Panic), Display (2-tap `useArmedAction` screen-off via `useScreenControl().turnOffScreen` — the plain variant), Recovery **ranked**: "Restart audio & MIDI" first (reconnect + `applyBundle(currentBundle)`), then a de-emphasized "Reload app". Feedback: "Record feedback" → `<FeedbackOverlay app="piano" context={{pianoId, surface:'operator-drawer'}}/>`.

- [ ] **Step 1: failing test** — renders the sections; recovery order is Restart-audio then Reload; "Restart audio & MIDI" triggers reconnect + `applyBundle`; screen-off is 2-tap armed; Feedback opens the overlay. (Mock the hooks/child components.)
- [ ] **Step 2: run, expect FAIL**
- [ ] **Step 3: implement** `OperatorDrawer.jsx` (reuse `PianoMidiMonitor`, `FeedbackOverlay`, `useArmedAction`, `useScreenControl`) + styles.
- [ ] **Step 4: run, expect PASS**; `cd frontend && npm run build` must succeed.
- [ ] **Step 5: commit** — `feat(piano): Operator Drawer (connect/monitor/test/screen-off/ranked-recovery/feedback)`

---

### Task 9: Chrome/chip rewire + delete old sheet

**Files:** Modify `frontend/src/modules/Piano/PianoKiosk/PianoChrome.jsx`. Delete `PianoSettingsSheet.jsx` + `PianoKeyboardPanel.jsx` (superseded) and their tests. Modify styles as needed. Test: `PianoChrome.test.jsx`.

**Interfaces:** The sound chip (dot + active voice name at rest, story D1): **tap → `<SoundPanel>`**, **long-press → `<OperatorDrawer>`** (via `useLongPress`). When the connection dot is **off**, the chip surfaces an inline **Reconnect** affordance (calls the existing connect path) — resolving audit T2. Remove the old `PianoSettingsSheet` import/state/render. Keep `PianoUserChip` as the separate who's-playing chip (its own screen-off stays).

- [ ] **Step 1: failing test** — chip renders dot+voice name; tap opens SoundPanel (long-press opens OperatorDrawer) via the `useLongPress` handlers; dot off → inline Reconnect visible and calls connect; dot on → Reconnect hidden. Mock SoundPanel/OperatorDrawer as sentinels.
- [ ] **Step 2: run, expect FAIL**
- [ ] **Step 3: implement** — rewire `PianoChrome.jsx`; delete `PianoSettingsSheet.jsx`/`PianoKeyboardPanel.jsx` (+ tests). Grep for any other importers of the deleted files and update them (there should be none outside the sheet).
- [ ] **Step 4: run, expect PASS**; then the whole piano suite + build: `npx vitest run frontend/src/modules/Piano/PianoKiosk/` and `cd frontend && npm run build`.
- [ ] **Step 5: commit** — `feat(piano): chip tap→Sound Panel, long-press→Operator Drawer, reconnect-on-disconnect; remove old settings sheet`

---

## Post-Plan verification (controller, after all tasks)
- Full piano suite green + `cd frontend && npm run build` clean.
- Manual (on deploy): tap chip → Sound Panel (no operator controls); long-press → Operator Drawer; pick a voice → sound changes; select a user → their default auto-applies; reload → chosen voice persists (preset.yml); dot-off → Reconnect on the chip.

## Self-Review Notes
- Spec coverage: applyBundle+order (T1/T4), long-press seam (T2/T9), single engine/stub bridge (T3), per-user presets+persistence+auto-apply+no-reset (T5), shortlist config (T5), funnel dedup (T6), Player Panel player-safe (T7), Operator Drawer ranked recovery + rehomed feedback/screen-off (T8), chip tap/long-press + reconnect-inline (T9), old sheet removed (T9). Audit tensions T1–T8 map to T3/T7/T8/T9.
- Transport REUSE only (no SysEx/bridge) — per user's correction and design §2.7.
- Deferred: rendered voices (stubbed), per-piano-keyed presets, feedback-for-non-operators (design §11).
