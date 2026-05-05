# Screen Framework Software Volume — Detailed Design

**Date:** 2026-05-05
**Companion audit:** `docs/_wip/audits/2026-05-05-screen-framework-software-volume-audit.md`
**Status:** Design — decisions confirmed, ready for implementation.

---

## 1. Contract (Confirmed)

`master ∈ [0, 1]` is a **multiplier**. It does not replace any component's volume; it scales whatever the component already wants to use.

```
effective = master × component × duck
```

- `master` — screen-wide knob (this design)
- `component` — per-track / per-source volume the component already manages (Player queue volume, AudioLayer base, audio-bridge calibration gain, etc.)
- `duck` — transient duck multiplier (e.g. `AudioLayer`'s `duckLevel = 0.15`)

Properties:

| `master` | Behavior |
|----------|----------|
| `1.0`    | Components play at exactly their own desired levels |
| `0.5`    | Everything halved |
| `0.0`    | Silence (mute) |

Components retain full local control. Mute toggles, fades, ducks all keep working — they multiply with master, not against it.

---

## 2. Scope (Important Correction)

**In scope** — only audio surfaces rendered **inside the screen-framework tree**:

| Surface | Where it lives |
|---------|----------------|
| Player (and its renderers: ContentScroller, VideoPlayer, AudioPlayer, RemuxPlayer) | Mounted by `ScreenActionHandler` when content is queued |
| AudioLayer | Inside Player |
| Audio bridge | Used by call/doorbell flows on Shield TV screens |
| Piano sound effects | Mounted as overlay via subscription |
| VideoCall audio (`<video>` srcObject) | Mounted as PiP/overlay for doorbell/call |

**Out of scope** — separate apps with their own provider trees and their own volume systems:

- Fitness app (`FitnessApp`, `useMediaAmplifier`, `nav/VolumeProvider`, `GovernanceAudioPlayer`, `useAudioFeedback`)
- Feed app (`FeedApp`, `FeedPlayerContext`, `FeedPlayer`)
- Weekly Review (`useAudioRecorder`)

The screen-framework master only affects the screen-framework. Other apps continue to manage their own audio.

### Edge case: shared modules used in multiple contexts

Player, audio bridge, and Piano are **shared modules** used by multiple apps. To keep them safe in both contexts:

- The volume context is defined in a **shared lib** (`frontend/src/lib/volume/ScreenVolumeContext.js`), with a default value of `{ master: 1 }`.
- Only the screen-framework's `ScreenVolumeProvider` wraps the tree with state. Other apps don't.
- When a shared module is rendered inside the screen-framework: `master` applies.
- When the same module is rendered inside another app (e.g., Fitness using Player): `master = 1` from the default — behavior is unchanged.

This keeps shared modules agnostic to which app is hosting them.

---

## 3. Provider API

**Files:**
- `frontend/src/lib/volume/ScreenVolumeContext.js` (new) — context definition + default value + module-level accessors
- `frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx` (new) — stateful provider used by screen-framework

### Component

```jsx
<ScreenVolumeProvider
  keyboardId={keyboardId}     // used to derive storageKey
  defaultMaster={0.5}
  step={0.1}
>
  {children}
</ScreenVolumeProvider>
```

`storageKey` = `screen-volume-{keyboardId}` (per-keyboard persistence — see §11 decision 8).

### Context value

```ts
interface ScreenVolumeContextValue {
  master: number;            // ∈ [0, 1]; default 1 when no provider
  muted: boolean;            // convenience: true ↔ master === 0
  setMaster(next: number): void;       // clamps to [0, 1]
  step(delta: number): void;            // adds delta, clamps; unmutes if currently muted (decision 3)
  toggleMute(): void;                   // master = 0 ↔ master = preMute
}
```

### Hooks

```js
useScreenVolume()                            // → context value (master = 1 if no provider)
useEffectiveVolume(local: number = 1)        // → master × local; re-renders on master change
useMasterVolumeOnElement(ref, local = 1)     // applies master × local to ref.current.volume in an effect
```

### Module-level accessors (for non-React code)

```js
import {
  getMasterVolume,        // () => number   (latest master, sync; 1 if no provider mounted)
  getMasterMuted,         // () => boolean
  subscribeMaster,        // (fn) => unsubscribe; fn(master, muted)
} from '../../lib/volume/ScreenVolumeContext';
```

The provider mirrors state into module-level vars on every change.

---

## 4. State Model

```js
{
  master: 0.5,    // ∈ [0,1]  — persisted (default 0.5 — decision 1)
  muted: false,   //          — persisted
  preMute: 0.5,   //          — NOT persisted; reset to defaultMaster on fresh session
}
```

### Persistence

- **Where:** `localStorage[screen-volume-{keyboardId}]`
- **Format:** `{ "master": 0.5, "muted": false }`
- **Read:** on mount; fall back to `defaultMaster` if absent or malformed
- **Write:** on every `setMaster` / `toggleMute`
- **Sync:** none — each keyboard/screen has its own master (decision 8)

---

## 5. Provider Placement

In `ScreenRenderer.jsx`, between `ScreenDataProvider` and `MenuNavigationProvider`:

```jsx
<ScreenDataProvider sources={config.data}>
  {viewport(
    <div ref={screenRootRef} className={...}>
      <ScreenVolumeProvider keyboardId={config.keyboardId}>   {/* ← new */}
        <MenuNavigationProvider>
          <ScreenOverlayProvider>
            <PipManager>
              ...
```

This reaches:
- Fullscreen overlays (sibling div, in tree)
- Corner PiP (sibling div, in tree)
- Panel-mode PiP (portaled into slots that are descendants of `ScreenProvider` — context flows)
- Main panel/widget content

---

## 6. Integration Patterns

Three patterns for the in-scope surfaces.

### Pattern A — `HTMLMediaElement.volume`

```diff
+ const { master } = useScreenVolume();
  ...
- mediaEl.volume = adjustedVolume;
+ mediaEl.volume = adjustedVolume * master;
```

Or with the helper (when there's a ref and a known local volume):

```diff
- mediaEl.volume = adjustedVolume;
+ useMasterVolumeOnElement(mediaElRef, adjustedVolume);
```

**Applies to:** `useCommonMediaController.js:1199`, `AudioLayer.jsx:49`.

### Pattern B — Web Audio gain (audio bridge)

`createMediaElementSource()` is one-way (irreversible) so we **don't** route HTMLMediaElement audio through a master GainNode. Components that already have their own `AudioContext` and `GainNode` keep them — they just multiply master onto the existing local gain:

```diff
+ const { master } = useScreenVolume();
  ...
- gainNode.gain.value = configRef.current.gain || 2;
+ gainNode.gain.value = (configRef.current.gain || 2) * master;
```

Re-apply on master change with `useEffect([master])` or `subscribeMaster`.

**Note on the bridge's 2× default:** the 2× isn't "louder than normal" — it's calibration for the natively quiet Shield TV mic. Post-2×, bridge audio is at "normal perceived volume," and master then scales that. At master=0.5, bridge is at half normal — same proportion as everything else.

**Applies to:** `useNativeAudioBridge.js:473`. (`VideoCall.jsx`'s `muteGain` — only if VideoCall is shown inside screen-framework PiP; same pattern.)

### Pattern C — One-shots (`new Audio()`)

```diff
  const audio = new Audio(src);
- audio.volume = 0.4;
+ audio.volume = 0.4 * getMasterVolume();
  audio.play();
```

Read at trigger time. Long-lived one-shots can `subscribeMaster` and update mid-flight if needed — none currently need that.

**Applies to:** `useSpaceInvadersGame.js:48` (Piano buzzer — only when Piano is shown as a screen-framework overlay).

---

## 7. handleVolume Rewrite

`frontend/src/screen-framework/actions/ScreenActionHandler.jsx:204-214` (the current `DaylightAPI` handler):

```js
const handleVolume = useCallback((payload) => {
  const endpoints = {
    '+1': 'api/v1/home/vol/+',
    '-1': 'api/v1/home/vol/-',
    'mute_toggle': 'api/v1/home/vol/togglemute',
  };
  const endpoint = endpoints[payload.command] || 'api/v1/home/vol/cycle';
  DaylightAPI(endpoint).catch((err) => {
    logger().warn('volume.api-error', { endpoint, error: err.message });
  });
}, []);
```

becomes:

```js
const { step, toggleMute } = useScreenVolume();

const handleVolume = useCallback((payload) => {
  switch (payload.command) {
    case '+1': step(+0.1); break;
    case '-1': step(-0.1); break;
    case 'mute_toggle': toggleMute(); break;
    default:
      logger().warn('volume.unknown-command', { command: payload.command });
  }
}, [step, toggleMute]);
```

No backend call. No state file. No SSH. The `display:volume` action contract from `actionMap.js:9` is unchanged — `NumpadAdapter`, `ActionBus`, and the action map all work as-is.

---

## 8. Hardware Bootstrap (Decision 5)

**No automatic bootstrap.** Hardware volume is set manually (e.g., via SSH or the device's OS settings) and the screen-framework software volume operates on top of whatever level the hardware is at.

Implication: the design assumes hardware is set high enough to give software headroom. If hardware is at 50%, software at master=1.0 will only be as loud as 50% × component-volume. That's the user's responsibility to configure once per device.

Removes all backend coupling from this feature. The screen-framework software-volume system makes zero API calls.

---

## 9. Mute Semantics (Decision 3)

```js
toggleMute() {
  if (muted) {
    setMaster(preMute);
    setMuted(false);
  } else {
    setPreMute(master);
    setMaster(0);
    setMuted(true);
  }
}
```

`step(delta)` while muted: **always apply the step on top of `preMute`, then unmute.**

```js
step(delta) {
  if (muted) {
    setMaster(clamp(preMute + delta));
    setMuted(false);
  } else {
    setMaster(clamp(master + delta));
  }
}
```

Vol-up while muted → `preMute + 0.1`. Vol-down while muted → `preMute - 0.1`. Keys always do what they say.

Mute does **not** touch the OS or `amixer`. Software-only.

---

## 10. Visible Feedback HUD (Decision 4)

**Ships with v1.** A transient toast on every master change, ~1.2s.

```
🔊  ████████░░  50
```

(`🔇` icon and no bar when muted.)

**File:** `frontend/src/screen-framework/overlays/MasterVolumeToast.jsx` (new)

Renders inside `ScreenOverlayProvider`'s toast stack (`ScreenOverlayProvider.jsx:105-117`). Reuses the existing toast machinery. Listens to master changes via `subscribeMaster` (or context); shows for 1.2s, then hides. Multiple rapid changes reset the timer.

---

## 11. Confirmed Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Default master | **0.5** — equal headroom up and down; hardware tuned manually for loudness |
| 2 | Step size | **0.1** — 10 stops |
| 3 | Mute UX on volume keys | **Always apply step on top of preMute, then unmute** — keys always do what they say |
| 4 | HUD in v1 | **Yes** — transient toast |
| 5 | Hardware bootstrap | **None** — hardware is set manually, no auto-push |
| 6 | Player's `useVolumeStore` | **Keep** as per-track SSOT; master multiplies at final write site |
| 7 | Audio bridge 2× gain × master | **Compose** — multiply onto bridge's existing gain; documented in §6 |
| 8 | Per-keyboard storage | **`storageKey = screen-volume-{keyboardId}`** — each screen has its own master |

---

## 12. Migration Order

| # | Subsystem | Files touched | Notes |
|---|-----------|---------------|-------|
| 1 | Shared lib + provider + handler | `lib/volume/ScreenVolumeContext.js` (new), `screen-framework/providers/ScreenVolumeProvider.jsx` (new), `ScreenRenderer.jsx`, `ScreenActionHandler.jsx` | After step 1 the master exists but no surface respects it. **Don't ship between 1 and 2** — volume keys would do nothing. |
| 2 | Player + AudioLayer | `useCommonMediaController.js`, `AudioLayer.jsx` | Covers all Player renderers. **First ship-able state.** |
| 3 | HUD | `overlays/MasterVolumeToast.jsx` (new) | Visible feedback. |
| 4 | Audio bridge | `useNativeAudioBridge.js` | Web Audio gain (Pattern B). |
| 5 | Piano sound effects | `useSpaceInvadersGame.js` | One-shot (Pattern C) — only relevant when Piano shown as overlay. |

Total: ~5 files modified, 3 files created.

---

## 13. Test Plan

### Unit (vitest)

- `ScreenVolumeProvider`
  - `setMaster` clamps to `[0, 1]`
  - `step(+0.1)` from 0.5 → 0.6; `step(+0.6)` clamps at 1
  - `step(-0.1)` from 0.0 stays at 0
  - `toggleMute` from `master=0.5` → `master=0`, `muted=true`, `preMute=0.5`
  - `toggleMute` from muted → `master=0.5`, `muted=false`
  - `step` while muted unmutes and applies step to preMute (vol-up: `preMute + delta`; vol-down: `preMute - delta`)
  - `getMasterVolume()` reflects latest state synchronously
  - `subscribeMaster(fn)` is called on every change; returns unsubscribe
  - Persistence: write on change; read on mount; fall back to `defaultMaster` on malformed JSON
  - Different `keyboardId` props produce different localStorage keys
- `handleVolume` (in `ScreenActionHandler.test.jsx`)
  - `'+1'` → `step(+0.1)` called
  - `'-1'` → `step(-0.1)` called
  - `'mute_toggle'` → `toggleMute` called
  - Unknown command → logger.warn called, no other action
  - **No `DaylightAPI` call** for any command (regression guard)
- `useEffectiveVolume(local)`
  - Returns `master × local`
  - Re-renders when master changes
  - Returns `local × 1 = local` when no provider mounted

### Integration (Playwright)

- Press numpad volume-down → `document.querySelector('video').volume` drops accordingly
- Mute toggle → media element volume reads ~0; toggle again → restores
- Reload page → master persists from localStorage at the per-keyboard key
- HUD toast appears on volume change and dismisses after ~1.2s

### Manual

- Audio bridge volume scaling (Shield TV doorbell flow)
- Piano buzzer audible only

---

## 14. Backward Compatibility

- **Numpad keymap YAML** — unchanged.
- **Action contract `display:volume`** — unchanged.
- **Backend `/api/v1/home/vol/:level`** — unchanged. **Now unused by the frontend.** Eligible for cleanup as a separate task (not in scope here).
- **Backend `volLevel` history file** — no longer written. Eligible for cleanup.
- **Other apps** (Fitness, Feed, Weekly Review) — unaffected; they keep their own volume systems.

---

## 15. Files Touched

**New:**
- `frontend/src/lib/volume/ScreenVolumeContext.js` — shared context + module-level accessors + default value
- `frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx` — stateful provider
- `frontend/src/screen-framework/overlays/MasterVolumeToast.jsx` — HUD
- `tests/unit/screen-framework/ScreenVolumeProvider.test.jsx`

**Modified:**
- `frontend/src/screen-framework/ScreenRenderer.jsx` — wrap with provider
- `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` — rewrite `handleVolume`
- `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` — update tests, assert no `DaylightAPI`, assert `step`/`toggleMute` calls
- `frontend/src/modules/Player/hooks/useCommonMediaController.js` — multiply master at line 1199
- `frontend/src/modules/Player/components/AudioLayer.jsx` — multiply master at line 49 (compose with duck)
- `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` — multiply master onto bridge gain
- `frontend/src/modules/Piano/PianoSpaceInvaders/useSpaceInvadersGame.js` — `getMasterVolume()` at trigger

**Unchanged:**
- `frontend/src/screen-framework/input/adapters/NumpadAdapter.js`
- `frontend/src/screen-framework/input/actionMap.js`
- `tests/unit/screen-framework/NumpadAdapter.test.js`
- `backend/src/4_api/v1/routers/homeAutomation.mjs`
- `backend/src/1_adapters/home-automation/remote-exec/RemoteExecAdapter.mjs`

---

## 16. Out of Scope (explicit)

- **Other apps' audio.** Fitness, Feed, Weekly Review have their own volume systems and provider trees. The screen-framework master does not reach them.
- **Iframe audio** (Feed embeds, future YouTube). Cross-origin; can't be controlled from parent. Out of scope by design.
- **Cross-screen sync.** Each keyboard/screen has its own master.
- **Replacing `useVolumeStore`.** It remains Player's per-track SSOT.
- **Removing the backend volume endpoint.** Stays available for any other consumer; cleanup is a separate task.

---

## Ready to Implement

All open decisions confirmed. Migration order in §12 makes step 1+2 a single first deployable bundle. From step 3 onward each step adds independent value.
