# Piano Mix Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the piano kiosk two independent, persisted software volumes — the onboard Suzuki voice (MIDI CC7) and BT media audio (media-element volume) — adjustable live in the Music and Video now-playing chrome, so the player can balance piano against track without touching the single physical slider.

**Architecture:** A new `PianoMixContext` owns the two levels (`pianoLevel`, `mediaLevel`), persists them to `localStorage`, sends MIDI **CC7** to the Suzuki on piano-level changes, and re-asserts CC7 on MIDI reconnect. A small presentational `MixControls` component renders the two `−/+` clusters and is dropped into both players' chrome. Media players apply `mediaLevel` to their media element's `.volume`.

**Tech Stack:** React (function components + context), Web MIDI (existing `usePianoMidi`), Vitest + @testing-library/react, SCSS.

**Spec:** `docs/superpowers/specs/2026-06-23-piano-mix-balance-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/modules/Piano/PianoKiosk/PianoMixContext.jsx` (new) | State + persistence + CC7 send + reconnect re-assert |
| `frontend/src/modules/Piano/PianoKiosk/PianoMixContext.test.jsx` (new) | Unit tests for the context |
| `frontend/src/modules/Piano/PianoKiosk/MixControls.jsx` (new) | Presentational two-cluster `−/+` control (pure props) |
| `frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx` (new) | Unit tests for the control |
| `frontend/src/Apps/PianoApp.jsx` (modify) | Mount `PianoMixProvider` inside the MIDI provider |
| `frontend/src/modules/Piano/PianoKiosk/modes/Music/MusicPlayer.jsx` (modify) | Use shared `mediaLevel`; render `MixControls` |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx` (modify) | Render `MixControls` (consumes `usePianoMix`) |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx` (modify) | Volume cluster tests |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx` (modify) | Apply `mediaLevel` to the resolved `mediaEl` |
| `frontend/src/Apps/PianoApp.scss` (modify) | `.piano-mix` layout rules |

**Key risk (resolved on-device in Task 8):** the onboard Suzuki must recognize MIDI CC7 over MIDI IN. GM Level 1 mandates it, so this is expected to pass. The only contingency — if a voice-change (Program Change) resets CC7 — is a one-line re-assert hook noted in Task 8. Nothing in Tasks 1–7 depends on the outcome.

**Test command (single file):**
`./node_modules/.bin/vitest run --config vitest.config.mjs <path>`

---

## Task 1: PianoMixContext

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/PianoMixContext.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/PianoMixContext.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Piano/PianoKiosk/PianoMixContext.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const midi = vi.hoisted(() => ({ connected: false, sendControlChange: vi.fn() }));
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

import { PianoMixProvider, usePianoMix } from './PianoMixContext.jsx';

function Harness() {
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel } = usePianoMix();
  return (
    <div>
      <span data-testid="piano">{pianoLevel}</span>
      <span data-testid="media">{mediaLevel}</span>
      <button type="button" onClick={() => setPianoLevel(0.5)}>piano-half</button>
      <button type="button" onClick={() => setMediaLevel(0.3)}>media-30</button>
    </div>
  );
}
const renderMix = () => render(<PianoMixProvider><Harness /></PianoMixProvider>);

beforeEach(() => {
  localStorage.clear();
  midi.sendControlChange.mockReset();
  midi.connected = false;
});

describe('PianoMixContext', () => {
  it('defaults both levels to 1', () => {
    renderMix();
    expect(screen.getByTestId('piano').textContent).toBe('1');
    expect(screen.getByTestId('media').textContent).toBe('1');
  });

  it('setPianoLevel sends CC7 (linear→0..127) and persists', () => {
    renderMix();
    fireEvent.click(screen.getByText('piano-half'));
    expect(midi.sendControlChange).toHaveBeenCalledWith(7, 64); // round(0.5*127)=64
    expect(screen.getByTestId('piano').textContent).toBe('0.5');
    expect(localStorage.getItem('piano.mix.pianoLevel')).toBe('0.5');
  });

  it('setMediaLevel persists without touching MIDI', () => {
    renderMix();
    fireEvent.click(screen.getByText('media-30'));
    expect(screen.getByTestId('media').textContent).toBe('0.3');
    expect(localStorage.getItem('piano.mix.mediaLevel')).toBe('0.3');
    expect(midi.sendControlChange).not.toHaveBeenCalled();
  });

  it('re-reads persisted levels on mount', () => {
    localStorage.setItem('piano.mix.pianoLevel', '0.4');
    localStorage.setItem('piano.mix.mediaLevel', '0.2');
    renderMix();
    expect(screen.getByTestId('piano').textContent).toBe('0.4');
    expect(screen.getByTestId('media').textContent).toBe('0.2');
  });

  it('re-asserts CC7 when MIDI is connected on mount', () => {
    midi.connected = true;
    localStorage.setItem('piano.mix.pianoLevel', '0.6');
    renderMix();
    expect(midi.sendControlChange).toHaveBeenCalledWith(7, 76); // round(0.6*127)=76
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/PianoMixContext.test.jsx`
Expected: FAIL — cannot resolve `./PianoMixContext.jsx`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Piano/PianoKiosk/PianoMixContext.jsx`:

```jsx
import { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';

/**
 * PianoMix — the single owner of the two software output levels that share the
 * BT speaker's one physical slider: the onboard Suzuki voice (driven by MIDI
 * CC7 / channel volume) and BT media audio (the media element's .volume). Both
 * levels persist; the physical slider stays the master above them.
 */
const PIANO_KEY = 'piano.mix.pianoLevel';
const MEDIA_KEY = 'piano.mix.mediaLevel';
const CC_VOLUME = 7; // MIDI Channel Volume (GM Main Volume)

const clamp01 = (v) => Math.max(0, Math.min(1, Math.round(v * 10) / 10));
const readLevel = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return 1;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp01(n) : 1;
  } catch { return 1; }
};

const FALLBACK = { pianoLevel: 1, mediaLevel: 1, setPianoLevel: () => {}, setMediaLevel: () => {} };
const Ctx = createContext(FALLBACK);

export function PianoMixProvider({ children }) {
  const { connected, sendControlChange } = usePianoMidi();
  const logger = useMemo(() => getLogger().child({ component: 'piano-mix' }), []);
  const [pianoLevel, setPianoLevelState] = useState(() => readLevel(PIANO_KEY));
  const [mediaLevel, setMediaLevelState] = useState(() => readLevel(MEDIA_KEY));
  const pianoRef = useRef(pianoLevel);
  pianoRef.current = pianoLevel;

  const setPianoLevel = useCallback((v) => {
    const level = clamp01(v);
    setPianoLevelState(level);
    try { localStorage.setItem(PIANO_KEY, String(level)); } catch { /* storage unavailable */ }
    const cc = Math.round(level * 127);
    sendControlChange(CC_VOLUME, cc);
    logger.info('piano.mix.piano-level', { level, cc });
  }, [sendControlChange, logger]);

  const setMediaLevel = useCallback((v) => {
    const level = clamp01(v);
    setMediaLevelState(level);
    try { localStorage.setItem(MEDIA_KEY, String(level)); } catch { /* storage unavailable */ }
    logger.info('piano.mix.media-level', { level });
  }, [logger]);

  // Re-assert the piano CC7 level whenever MIDI (re)connects, so a reconnect or
  // keyboard power-cycle restores the chosen balance.
  useEffect(() => {
    if (!connected) return;
    const cc = Math.round(pianoRef.current * 127);
    sendControlChange(CC_VOLUME, cc);
    logger.info('piano.mix.cc7-assert', { level: pianoRef.current, cc });
  }, [connected, sendControlChange, logger]);

  const value = useMemo(
    () => ({ pianoLevel, mediaLevel, setPianoLevel, setMediaLevel }),
    [pianoLevel, mediaLevel, setPianoLevel, setMediaLevel],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePianoMix = () => useContext(Ctx);

export default Ctx;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/PianoMixContext.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoMixContext.jsx frontend/src/modules/Piano/PianoKiosk/PianoMixContext.test.jsx
git commit -m "feat(piano): PianoMix context — persisted piano(CC7)+media levels"
```

---

## Task 2: Mount PianoMixProvider in PianoApp

**Files:**
- Modify: `frontend/src/Apps/PianoApp.jsx` (provider composition, ~lines 156–167)

- [ ] **Step 1: Add the import**

In `frontend/src/Apps/PianoApp.jsx`, after the `PianoSoundProvider` import (line 25), add:

```jsx
import { PianoMixProvider } from '../modules/Piano/PianoKiosk/PianoMixContext.jsx';
```

- [ ] **Step 2: Wrap the shell with the provider**

Find this block (around lines 158–166):

```jsx
      <PianoMidiProvider preferredInputName={config.midi.preferredInputName}>
        <ConnectGate>
          <PianoPlaybackProvider>
            <PianoWakeLockProvider>
              <PianoShell />
            </PianoWakeLockProvider>
          </PianoPlaybackProvider>
        </ConnectGate>
      </PianoMidiProvider>
```

Replace it with (insert `PianoMixProvider` inside `PianoPlaybackProvider`, so it is inside `PianoMidiProvider` and thus can call `usePianoMidi`):

```jsx
      <PianoMidiProvider preferredInputName={config.midi.preferredInputName}>
        <ConnectGate>
          <PianoPlaybackProvider>
            <PianoMixProvider>
              <PianoWakeLockProvider>
                <PianoShell />
              </PianoWakeLockProvider>
            </PianoMixProvider>
          </PianoPlaybackProvider>
        </ConnectGate>
      </PianoMidiProvider>
```

- [ ] **Step 3: Verify no regressions in the Piano app suite**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/`
Expected: PASS (existing suite still green; new context test green).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Apps/PianoApp.jsx
git commit -m "feat(piano): mount PianoMixProvider in the kiosk provider tree"
```

---

## Task 3: MixControls presentational component

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/MixControls.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MixControls from './MixControls.jsx';

const base = { pianoLevel: 0.8, mediaLevel: 0.5, onPiano: vi.fn(), onMedia: vi.fn() };

describe('MixControls', () => {
  it('renders piano and media percentages', () => {
    render(<MixControls {...base} />);
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
  });

  it('fires a negative delta on piano down and positive on piano up', () => {
    const onPiano = vi.fn();
    render(<MixControls {...base} onPiano={onPiano} />);
    fireEvent.click(screen.getByLabelText('Piano volume down'));
    fireEvent.click(screen.getByLabelText('Piano volume up'));
    expect(onPiano).toHaveBeenCalledWith(-0.1);
    expect(onPiano).toHaveBeenCalledWith(0.1);
  });

  it('fires deltas on media down/up', () => {
    const onMedia = vi.fn();
    render(<MixControls {...base} onMedia={onMedia} />);
    fireEvent.click(screen.getByLabelText('Media volume down'));
    fireEvent.click(screen.getByLabelText('Media volume up'));
    expect(onMedia).toHaveBeenCalledWith(-0.1);
    expect(onMedia).toHaveBeenCalledWith(0.1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`
Expected: FAIL — cannot resolve `./MixControls.jsx`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/modules/Piano/PianoKiosk/MixControls.jsx`:

```jsx
import Icon from './icons/Icon.jsx';

/**
 * Presentational balance control: a piano −/+ cluster and a media −/+ cluster.
 * Pure — handlers (which clamp/persist via PianoMix) are wired by the host.
 * `onPiano`/`onMedia` receive a signed delta. `btnClass` lets each host reuse
 * its existing button style so the control inherits the surrounding chrome.
 */
const STEP = 0.1;
const pct = (v) => `${Math.round((v ?? 0) * 100)}`;

export default function MixControls({ pianoLevel, mediaLevel, onPiano, onMedia, btnClass = 'piano-mix__btn' }) {
  return (
    <div className="piano-mix">
      <div className="piano-mix__cluster">
        <Icon name="piano" className="piano-mix__lead" label="Piano" />
        <button type="button" className={btnClass} onClick={() => onPiano(-STEP)} aria-label="Piano volume down"><Icon name="volume-down" /></button>
        <span className="piano-mix__val">{pct(pianoLevel)}</span>
        <button type="button" className={btnClass} onClick={() => onPiano(STEP)} aria-label="Piano volume up"><Icon name="volume-up" /></button>
      </div>
      <div className="piano-mix__cluster">
        <Icon name="music" className="piano-mix__lead" label="Media" />
        <button type="button" className={btnClass} onClick={() => onMedia(-STEP)} aria-label="Media volume down"><Icon name="volume-down" /></button>
        <span className="piano-mix__val">{pct(mediaLevel)}</span>
        <button type="button" className={btnClass} onClick={() => onMedia(STEP)} aria-label="Media volume up"><Icon name="volume-up" /></button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/MixControls.jsx frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx
git commit -m "feat(piano): MixControls — shared piano/media volume clusters"
```

---

## Task 4: MusicPlayer uses shared mediaLevel + MixControls

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Music/MusicPlayer.jsx`

- [ ] **Step 1: Add imports**

After the `Icon` import (line 11), add:

```jsx
import { usePianoMix } from '../../PianoMixContext.jsx';
import MixControls from '../../MixControls.jsx';
```

- [ ] **Step 2: Consume the mix context; drop local volume state**

Near the other context hooks (after line 27, `const kb = config?.keyboard ...`), add:

```jsx
  const { mediaLevel, setMediaLevel, pianoLevel, setPianoLevel } = usePianoMix();
```

Delete the local volume state line (line 56):

```jsx
  const [vol, setVol] = useState(1);
```

- [ ] **Step 3: Apply mediaLevel to the audio element**

Replace the volume effect (line 75):

```jsx
  useEffect(() => { if (audioRef.current) audioRef.current.volume = vol; }, [vol]);
```

with:

```jsx
  useEffect(() => { if (audioRef.current) audioRef.current.volume = mediaLevel; }, [mediaLevel]);
```

- [ ] **Step 4: Remove the old changeVol handler**

Delete this line (line 128):

```jsx
  const changeVol = (d) => { setVol((v) => Math.max(0, Math.min(1, Math.round((v + d) * 10) / 10))); reveal(); };
```

- [ ] **Step 5: Replace the volume markup with MixControls**

Replace the whole volume block (lines 180–184):

```jsx
          <div className="piano-music-player__volume">
            <button type="button" className="piano-music-btn" onClick={() => changeVol(-0.1)} aria-label="Volume down"><Icon name="volume-down" /></button>
            <span className="piano-music-player__vol-val">{Math.round(vol * 100)}</span>
            <button type="button" className="piano-music-btn" onClick={() => changeVol(0.1)} aria-label="Volume up"><Icon name="volume-up" /></button>
          </div>
```

with:

```jsx
          <MixControls
            pianoLevel={pianoLevel}
            mediaLevel={mediaLevel}
            onPiano={(d) => { setPianoLevel(pianoLevel + d); reveal(); }}
            onMedia={(d) => { setMediaLevel(mediaLevel + d); reveal(); }}
            btnClass="piano-music-btn"
          />
```

- [ ] **Step 6: Verify the Music suite still passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Music/`
Expected: PASS. (`MusicPlayer` now reads `usePianoMix`; with no provider in the test tree it gets the FALLBACK — `mediaLevel`/`pianoLevel` 1, no-op setters — so it renders without error.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Music/MusicPlayer.jsx
git commit -m "feat(piano): Music player uses shared media level + MixControls balance"
```

---

## Task 5: PianoVideoChrome renders MixControls

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`

- [ ] **Step 1: Write the failing test**

In `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`, add a mock for the mix context at the top (after the imports on line 4) and a new describe block. Insert after line 4:

```jsx
const mix = vi.hoisted(() => ({
  pianoLevel: 0.8, mediaLevel: 0.5, setPianoLevel: vi.fn(), setMediaLevel: vi.fn(),
}));
vi.mock('../../PianoMixContext.jsx', () => ({ usePianoMix: () => mix }));
```

Then add this describe block at the end of the file (before the final close):

```jsx
describe('PianoVideoChrome — mix balance', () => {
  it('drives the piano level down/up from the mix context', () => {
    mix.setPianoLevel.mockReset();
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Piano volume down'));
    fireEvent.click(screen.getByLabelText('Piano volume up'));
    expect(mix.setPianoLevel).toHaveBeenCalledTimes(2);
  });

  it('drives the media level down/up from the mix context', () => {
    mix.setMediaLevel.mockReset();
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Media volume down'));
    fireEvent.click(screen.getByLabelText('Media volume up'));
    expect(mix.setMediaLevel).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`
Expected: FAIL — `Unable to find a label 'Piano volume down'`.

- [ ] **Step 3: Add the imports and render MixControls**

In `PianoVideoChrome.jsx`, after the `Icon` import (line 3), add:

```jsx
import { usePianoMix } from '../../PianoMixContext.jsx';
import MixControls from '../../MixControls.jsx';
```

Inside the component body, after `const barRef = useRef(null);` (line 20), add:

```jsx
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel } = usePianoMix();
```

In the row, add a spacer + `MixControls` immediately before the play-along button (between line 55's `<div className="piano-video-chrome__spacer" />` group and line 56). Insert just before the play-along `<button ...>`:

```jsx
        <MixControls
          pianoLevel={pianoLevel}
          mediaLevel={mediaLevel}
          onPiano={(d) => setPianoLevel(pianoLevel + d)}
          onMedia={(d) => setMediaLevel(mediaLevel + d)}
          btnClass="piano-video-chrome__btn"
        />
        <div className="piano-video-chrome__spacer" />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx`
Expected: PASS (original 5 tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.test.jsx
git commit -m "feat(piano): video chrome renders MixControls balance"
```

---

## Task 6: PianoVideoPlayer applies mediaLevel to the media element

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx`

- [ ] **Step 1: Add the import**

After the `usePianoPlayback` import (line 6), add:

```jsx
import { usePianoMix } from '../../PianoMixContext.jsx';
```

- [ ] **Step 2: Read mediaLevel and apply it to the resolved media element**

After the `usePianoMidi` hook line (line 29, `const { activeNotes, pressNote, releaseNote } = usePianoMidi();`), add:

```jsx
  const { mediaLevel } = usePianoMix();
```

Then add an effect that applies it to the resolved element. Insert immediately after the existing `useEffect` that mirrors media-element state ends (after line 129, the closing `}, [mediaEl]);`):

```jsx
  // Apply the shared media level to the resolved element (mirrors MusicPlayer).
  useEffect(() => { if (mediaEl) mediaEl.volume = mediaLevel; }, [mediaEl, mediaLevel]);
```

- [ ] **Step 3: Verify the Videos suite passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/modes/Videos/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx
git commit -m "feat(piano): video player applies shared media level to its element"
```

---

## Task 7: MixControls styling

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss`

- [ ] **Step 1: Append the layout rules**

At the end of `frontend/src/Apps/PianoApp.scss`, add a top-level block:

```scss
// Shared piano/media balance control (MixControls). Buttons inherit the host
// chrome's button style via `btnClass`; these rules only lay out the clusters.
.piano-mix {
  display: flex;
  align-items: center;
  gap: 1.5rem;

  &__cluster { display: flex; align-items: center; gap: 0.25rem; }
  &__lead { opacity: 0.7; }
  &__val {
    min-width: 2.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--piano-stage-muted);
  }
}
```

- [ ] **Step 2: Build the frontend to confirm SCSS compiles**

Run: `npx vite build 2>&1 | tail -20`
Expected: build completes without SCSS errors. (If the repo has a faster lint/style check, that is acceptable too.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "style(piano): layout for the MixControls balance clusters"
```

---

## Task 8: Build, deploy, and on-device verification (incl. CC7 gate)

**Files:** none (deploy + manual verification).

> This task confirms the spec's Step 0 hardware gate live, because the Suzuki's MIDI OUT path runs in the browser on the kiosk tablet and can't be exercised from the server.

- [ ] **Step 1: Full Piano suite green**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/PianoKiosk/`
Expected: PASS (all suites, including new context/control/chrome tests).

- [ ] **Step 2: Build and deploy**

Confirm the garage is not in an active fitness session and no Player video is playing (per `CLAUDE.local.md` deploy gate), then:

```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 3: Reload the piano kiosk**

Reload the piano kiosk tablet (FKB) so it serves the new bundle (FKB serves old JS until reloaded — see the Shield/FKB notes in `CLAUDE.md`/`CLAUDE.local.md` for the cache-clear/loadStartURL path for that device).

- [ ] **Step 4: CC7 gate — verify the onboard piano attenuates**

On the kiosk: start a Music track, hold a note on the Suzuki (onboard voice), and tap **Piano volume down** to ~10–20%. Confirm the piano gets quieter relative to the track while the track stays put. Tap **Media volume down** and confirm only the track drops. Reload the kiosk and confirm both levels persisted.

- [ ] **Step 5: Contingency — only if CC7 resets on voice change**

If, and only if, switching the Suzuki voice (Program Change) resets the piano volume back to full, re-assert CC7 after voice selection. In `PianoSoundContext.jsx`, the onboard branch of `select` (and `selectVoice`) sends Program Change; add a re-send of CC7 there using the persisted level. (Read `piano.mix.pianoLevel` from `localStorage` and `sendControlChange(7, Math.round(level * 127))` right after the Program Change.) Then rebuild/redeploy/reload and re-verify Step 4. Skip this step if CC7 survives voice changes (expected for GM Level 1).

- [ ] **Step 6: Commit any contingency change**

```bash
git add frontend/src/modules/Piano/PianoKiosk/PianoSoundContext.jsx
git commit -m "fix(piano): re-assert CC7 piano level after onboard voice change"
```

---

## Done when

- Music and Video now-playing chrome each show a piano `−/+` and a media `−/+` cluster.
- Lowering the piano cluster attenuates the onboard Suzuki voice on the BT speaker without changing the track; lowering the media cluster does the inverse.
- Both levels persist across kiosk reloads and are re-asserted on MIDI reconnect.
- The physical slider still works as the master over the balanced mix.
