# Screen Framework Software Volume Audit

**Date:** 2026-05-05
**Scope:** Replace screen-framework hardware/OS volume control (numpad → backend → `amixer` over SSH) with a software-level master volume that wraps every audio/video surface rendered inside `ScreenRenderer`.
**Status:** Discovery — no code changes proposed yet. This audit informs the redesign.

---

## Goal

Today, pressing volume up/down on the office numpad changes the **operating system's** master volume on the host machine via SSH `amixer`. We want:

1. Hardware volume pinned at a fixed, high level (e.g. 100%).
2. A **software** master volume (0–100) owned by the screen-framework.
3. That single master applied uniformly to **every** audio-producing element rendered inside the screen — main video, ambient audio, governance overlay music, sound effects, WebRTC call audio, audio bridge, TTS, etc.
4. Components shouldn't have to know about it individually — the wrapper composes with whatever per-track volume the component already manages (e.g. AudioLayer ducking, Player queue volume, Fitness per-track volume).

---

## Current Wiring (Hardware Volume)

```
numpad keydown
  → NumpadAdapter.handler                  frontend/src/screen-framework/input/adapters/NumpadAdapter.js:33
  → translateAction('volume', '+1')        frontend/src/screen-framework/input/actionMap.js:9
  → ActionBus.emit('display:volume', { command: '+1' })
  → ScreenActionHandler.handleVolume       frontend/src/screen-framework/actions/ScreenActionHandler.jsx:204
  → DaylightAPI('api/v1/home/vol/+')
  → router.get('/vol/:level', ...)          backend/src/4_api/v1/routers/homeAutomation.mjs:195
  → handleVolumeRequest                     backend/src/4_api/v1/routers/homeAutomation.mjs:131
  → remoteExecAdapter.setVolume(level)      backend/src/1_adapters/home-automation/remote-exec/RemoteExecAdapter.mjs:120
  → ssh "amixer set Master <level>%"
```

### Frontend specifics

**`actionMap.js:9`** — only translation involved:
```js
volume: (params) => ({ action: 'display:volume', payload: { command: params } }),
```

**`ScreenActionHandler.jsx:204-214`** — entire handler:
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

Registered via `useScreenAction('display:volume', handleVolume)` at line 377.

**Numpad keymap source:** `NumpadAdapter` fetches from `/api/v1/home/keyboard/{keyboardId}` (NumpadAdapter.js:24). Keymap entries look like `{ '5': { function: 'volume', params: '+1' } }` — see test fixture in `tests/unit/screen-framework/NumpadAdapter.test.js:45`.

### Backend specifics

`handleVolumeRequest` (`homeAutomation.mjs:131-192`) maintains its own state file `history/hardware/volLevel = { volume, muted }`, increments by 12, and dispatches to `remoteExecAdapter.setVolume()` which issues `amixer set Master <vol>%` over SSH (RemoteExecAdapter.mjs:120-133). There is **no software gain stage anywhere in the volume flow**.

---

## Audio Surfaces in the Screen Tree

Below is the complete inventory of every place inside the screen-framework's React tree (or modules it renders) that emits sound. **All of these would need to compose with a software master volume.**

### A. HTMLMediaElement (the easy ones — 13 surfaces)

| File | Line | Element | Role |
|------|------|---------|------|
| `modules/Player/renderers/ContentScroller.jsx` | 377 | `<video>` | Main video content |
| `modules/Player/renderers/ContentScroller.jsx` | 422 | `<audio>` | Main audio playback |
| `modules/Player/renderers/ContentScroller.jsx` | 431 | `<audio>` | Ambient/background track |
| `modules/Player/renderers/VideoPlayer.jsx` | 626 | `<video>` | DASH video (Plex) |
| `modules/Player/renderers/RemuxPlayer.jsx` | 131 | `<video>` | Video-leader stream |
| `modules/Player/renderers/RemuxPlayer.jsx` | 145 | `<audio>` | Audio companion to remux video |
| `modules/Player/renderers/AudioPlayer.jsx` | 280 | `<audio>` | Audio-only playback |
| `modules/Feed/players/FeedPlayer.jsx` | 53–54 | `<video>`/`<audio>` | Feed split-stream player |
| `modules/Fitness/components/FitnessWebcam.jsx` | 188 | `<video>` | Webcam preview (no audio) |
| `modules/Fitness/player/overlays/GovernanceAudioPlayer.jsx` | 97 | `<audio>` | Governance overlay music |
| `Apps/CallApp.jsx` | — | `<video>` ×2 | Local + remote WebRTC tracks |
| `modules/CameraFeed/useHlsStream.js` | 40 | `<video>` | HLS camera feed |

These all expose `.volume ∈ [0,1]`. A master volume can be applied as a multiplier on whatever per-track volume the component already wants.

### B. Web Audio API (the hard ones — already routed through gain stages)

These already have explicit Web Audio graphs. The master volume could be a final `GainNode` they each subscribe to.

| File | Pattern | Role |
|------|---------|------|
| `modules/Input/hooks/useNativeAudioBridge.js:473` | `createGain()` (default 2× boost) | Shield TV native mic bridge |
| `modules/Fitness/components/useMediaAmplifier.js:36` | `createMediaElementSource()` → `createGain()` → `destination` | Per-track amplifier wired around a `<video>` / `<audio>` element |
| `modules/Input/VideoCall.jsx` | `createGain()` (`muteGain`) | Call mute |
| `modules/Input/Webcam.jsx` | Multiple `AudioContext` / `AudioWorkletNode` | Diagnostic capture |
| `modules/Input/hooks/useAudioProbe.js` | `AudioWorkletNode` (`volume-meter-ongoing`, `rms-probe-processor`) | Input metering |
| `modules/Input/hooks/useVolumeMeter.js` | `RTCPeerConnection` loopback + AudioWorklet | Call audio metering |
| `modules/Fitness/player/panels/hooks/useVoiceMemoRecorder.js` | `AudioContext` | Record fitness voice memo |
| `modules/WeeklyReview/hooks/useAudioRecorder.js` | `AudioContext` + `AudioWorkletNode` | Record weekly review voice |

Note: most of these are **input/recording** paths, not output — a master output volume should not affect them. The **output** paths in this list are `useNativeAudioBridge` (audio bridge plays into the page) and `useMediaAmplifier` (gain on a `<video>`/`<audio>`).

### C. One-shot sound effects (`new Audio()`)

| File | Line | Purpose |
|------|------|---------|
| `modules/Piano/PianoSpaceInvaders/useSpaceInvadersGame.js` | 48 | Wrong-note buzzer (`audio.volume = 0.4` hardcoded) |
| `modules/Fitness/shared/hooks/useAudioFeedback.js` | 17 | Click / success / error / count pings (`audio.volume = volume` from prop) |

These create disposable `Audio` objects. Master volume must be queryable at trigger time.

### D. WebRTC peer streams

| File | Pattern |
|------|---------|
| `modules/Input/VideoCall.jsx:224` | `remoteVideoRef.current.srcObject = peer.remoteStream` |
| `modules/Input/hooks/useWebRTCPeer.js` | `RTCPeerConnection` |
| `modules/Input/hooks/useHomeline.js` | Signaling for call audio/video |
| `Apps/CallApp.jsx` | Merges local + remote + bridge audio |

Volume on a `MediaStream` is set on the `<audio>`/`<video>` element rendering it, so this folds into category A — but only if the element is the master volume's subscriber.

### E. Existing per-component / per-domain volume controllers

These already exist and are **partially overlapping** with the proposed master. The redesign needs to compose with — not replace — them.

| File | What it does |
|------|--------------|
| `modules/Fitness/nav/VolumeProvider.jsx` | Hierarchical per-track volume (grandparentId / parentId / trackId) via context. Persists via `volumeStorage.js`. Scoped to FitnessApp only. |
| `modules/Fitness/components/useMediaAmplifier.js` | Applies Fitness volume to a media element via Web Audio gain |
| `modules/Player/hooks/useCommonMediaController.js:1199` | `mediaEl.volume = adjustedVolume` |
| `modules/Player/hooks/usePlaybackSession.js:81` | Uses `useVolumeStore` |
| `modules/Feed/players/FeedPlayerContext.jsx` | Per-feed-session volume + mute |
| `modules/Feed/players/FeedPlayer.jsx:107` | `v.volume = volume` |
| `modules/Player/components/AudioLayer.jsx:49` | `el.volume = ...` with rAF fade for duck/skip |

### F. Iframes — out of scope by design

Cross-origin iframes can't have their audio controlled from the parent. These will either be muted, paused, or simply not subject to the master.

| File | Line |
|------|------|
| `modules/Feed/Scroll/detail/DetailView.jsx` | 254 |
| `modules/Feed/Reader/ArticleRow.jsx` | 216 |
| `modules/Feed/Scroll/cards/FeedCard.jsx` | 605 |
| `modules/Feed/Scroll/detail/sections/EmbedSection.jsx` | (generic) |
| `modules/AppContainer/Apps/Glympse/Glympse.jsx` | (no audio) |

---

## Provider Tree (Where to Inject)

`ScreenRenderer.jsx:341-369` nests:

```jsx
<ScreenDataProvider>
  <div className="screen-viewport">
    <MenuNavigationProvider>
      <ScreenOverlayProvider>      // fullscreen overlays + toasts (NOT portaled — sibling divs)
        <PipManager>               // corner PiP (sibling div) + panel PiP (portaled into slot DOM)
          <ScreenProvider>
            <PanelRenderer />      // widgets + panel slots
          </ScreenProvider>
        </PipManager>
      </ScreenOverlayProvider>
    </MenuNavigationProvider>
  </div>
</ScreenDataProvider>
```

**Recommended insertion:** between `ScreenDataProvider` and `MenuNavigationProvider`. That position:

- Reaches **fullscreen overlays** (rendered as children, not portals — `ScreenOverlayProvider.jsx:93-96`)
- Reaches **corner PiP** (sibling div — `PipManager.jsx:236-239`)
- Reaches **panel PiP** which portals into slot DOM nodes registered by `PanelRenderer` — those DOM nodes are descendants of `ScreenProvider`, so React context still flows
- Doesn't depend on data/menu/overlay state

```jsx
<ScreenDataProvider>
  <div className="screen-viewport">
    <ScreenVolumeProvider>            // ← INSERT HERE
      <MenuNavigationProvider>
        <ScreenOverlayProvider>
          ...
```

---

## Design Choices (the actual decision space)

There are three orthogonal choices to make.

### Choice 1: Application mechanism — `.volume` property vs Web Audio gain

| Approach | How it works | Pros | Cons |
|----------|--------------|------|------|
| **`element.volume = master × per-track`** | Each `<audio>`/`<video>` consumer reads master from context and multiplies | Simple, reversible, no Web Audio plumbing, works with all media elements | Doesn't reach Web Audio outputs that bypass `<audio>`/`<video>` (audio bridge, future TTS via AudioBuffer) — those need their own gain |
| **Master `GainNode` at end of an AudioContext graph** | Each producer routes through `MediaElementSource → masterGain → destination` | One knob controls everything; plays well with future synthesized audio (TTS, beeps, mixing) | `createMediaElementSource()` is **one-way** — once an element is captured you cannot revert. Output then *only* plays through Web Audio. Crashes if the element is mounted/unmounted across contexts. Adds complexity to every consumer. |
| **Hybrid (recommended)** | `.volume` for HTMLMediaElement consumers (categories A, C, D); shared master `GainNode` exposed for Web Audio consumers (category B) to multiply onto their existing gain | Each surface uses the cheapest viable mechanism; iframes excluded by design | Two integration paths to maintain |

The hybrid mirrors what we already do: `useMediaAmplifier` is Web Audio (because it needs >1× boost), `Player`/`Feed`/`Fitness` use `.volume` directly. Adding a master that's both a number-context (for `.volume` consumers) and a `GainNode` ref (for Web Audio consumers) keeps the existing abstractions intact.

### Choice 2: Composition with existing per-component volume

Today components have their own volume:

- `Player` uses `useVolumeStore` + queue volume props
- `Feed` has `FeedPlayerContext` per session
- `Fitness` has the most sophisticated system (`VolumeProvider`, `useMediaAmplifier`, per-track persistence)
- `AudioLayer` does ducking (`duckLevel = 0.15`)
- `GovernanceAudioPlayer` has `volume = 0.85` default

The master should be a **multiplier**, not a replacement: `effectiveVolume = master × componentVolume × duckMultiplier`. This means:

- No component is forced to give up its existing controls
- Ducking still works (`AudioLayer.jsx:49`)
- Fitness per-track persistence still works
- Mute is `master = 0`

For Web Audio consumers (`useMediaAmplifier`, `useNativeAudioBridge`), the existing `gainNode.gain.value` becomes `gainNode.gain.value = baseGain × master`.

### Choice 3: Persistence and hardware initialization

- **Master volume persistence:** localStorage (per-screen) or backend (synced across devices). Recommend **localStorage** keyed by `keyboardId`/screen — volume is a local UX preference, doesn't need to travel.
- **Hardware bootstrap:** the backend `handleVolumeRequest` should still exist, but the **frontend stops calling it on every keypress**. Instead, on screen mount, issue **one** `setVolume(100)` call to ensure hardware is at full so the software master has full dynamic range. This keeps the SSH/`amixer` mechanism for the (rare) case someone changes it externally.
- **Mute behavior:** software mute (master = 0). Don't touch the OS mute — that risks leaving the host muted if our app crashes.

---

## Migration Touchpoints

The redesign must change or compose with these:

### Must change

| File | Change |
|------|--------|
| `screen-framework/actions/ScreenActionHandler.jsx:204-214` | `handleVolume` stops calling `DaylightAPI`. Reads/writes the `ScreenVolumeProvider` instead. |
| `screen-framework/ScreenRenderer.jsx:341-369` | Wrap tree with `<ScreenVolumeProvider>` |
| `screen-framework/providers/` | New file: `ScreenVolumeProvider.jsx` (state + context + master GainNode) |

### Must integrate (read master, multiply onto local volume)

| File | Why |
|------|-----|
| `modules/Player/hooks/useCommonMediaController.js:1199` | Final `.volume` write — multiply by master |
| `modules/Player/components/AudioLayer.jsx:49` | Already does fades — multiply by master |
| `modules/Feed/players/FeedPlayer.jsx:107` | `.volume` write |
| `modules/Fitness/components/useMediaAmplifier.js:36` | Multiply onto `gainNode.gain.value` |
| `modules/Fitness/nav/VolumeProvider.jsx` | Read screen master in `applyToPlayer` |
| `modules/Fitness/player/overlays/GovernanceAudioPlayer.jsx` | `.volume` write |
| `modules/Input/hooks/useNativeAudioBridge.js:473` | Multiply onto bridge gain |
| `modules/Piano/PianoSpaceInvaders/useSpaceInvadersGame.js:48` | One-shot — read master at trigger |
| `modules/Fitness/shared/hooks/useAudioFeedback.js:17` | One-shot — read master at trigger |

### Backend (keep mostly unchanged)

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/homeAutomation.mjs:131-192` | No code change required. Frontend will only call this once on mount, with `level=100`. |

---

## UX Considerations

- **Visible feedback** — there is no on-screen volume HUD today. Switching to software volume is a chance to add one (a transient overlay showing 0–100). The framework already has a toast/overlay system.
- **Initial value** — what does master volume default to on first launch? Suggest 70 (matches the old hardware default in `homeAutomation.mjs:138`).
- **Power-on safety** — on every screen mount, push hardware to a known level so software has full range. If `remoteExecAdapter` is unreachable (the 503 path at `homeAutomation.mjs:134`), the screen still works at whatever level the OS happens to be at.
- **Mute discoverability** — confirm whether mute should also dim the screen / show a mute indicator, since users currently get no feedback that mute is active.

---

## Risks / Open Questions

1. **WebRTC remote audio level.** Setting `<audio>.volume` on a remote stream element should work, but should be tested — some Chromium versions historically had quirks with `MediaStream`-backed elements.
2. **`createMediaElementSource` lock-in.** If we adopt the gain-node approach for any HTMLMediaElement, we permanently route its audio through Web Audio. Reverting requires recreating the element. This argues for the hybrid approach (use `.volume` unless we already have a Web Audio graph).
3. **Fitness `VolumeProvider`** is its own context with persistence. The master should be **upstream** of it (Fitness multiplies its per-track volume by the master); confirm there's no circular dependency in `FitnessApp.jsx`'s wrapping order.
4. **Audio bridge default of 2× gain.** If the master ranges 0–1, multiplying onto a 2× bridge gain makes its effective range 0–2. That's correct behavior — but it means master=100 doesn't mean "every signal at line level"; it means "every signal at its component-defined level." Document that.
5. **Iframe content** (Feed embeds, future YouTube embeds) won't be controlled. Decide whether to disable mute-via-master or accept that iframe audio bypasses the master.
6. **Sound-effect components** (`useSpaceInvadersGame`, `useAudioFeedback`) need a non-React way to read the master at trigger time — a global subscription or a `getMasterVolume()` exported from the provider's module so non-component code can call it.
7. **Existing `useVolumeStore`** in Player. Confirm whether it should remain the per-track source of truth (with master as an outer multiplier) or merge into the new master.
8. **Tests.** `tests/unit/screen-framework/NumpadAdapter.test.js` covers the adapter (key → action emission); it doesn't touch the handler. The redesign is downstream of the adapter — no NumpadAdapter test changes needed. New unit coverage should target `ScreenVolumeProvider` (subscribe, unsubscribe, multiplier composition) and the updated `handleVolume`.

---

## Recommendation Summary

1. **Hybrid model.** Build `ScreenVolumeProvider` exposing both a numeric `master ∈ [0,1]` (for `.volume` consumers) and a `GainNode` ref (for existing Web Audio consumers to chain into).
2. **Insert provider** between `ScreenDataProvider` and `MenuNavigationProvider` in `ScreenRenderer.jsx`.
3. **Replace** `ScreenActionHandler.handleVolume`'s `DaylightAPI` calls with provider-state writes.
4. **Compose, don't replace** Player/Feed/Fitness/AudioLayer existing volume — master is an outer multiplier.
5. **One-shot hardware bootstrap** on mount (`setVolume(100)`); keep backend endpoint for that single bootstrap call.
6. **Add a transient volume HUD** while we're in the area — there's no current feedback for volume changes.
7. **Defer iframe audio control.** Document as out-of-scope.

---

## Affected Files (Reference)

| File | Role |
|------|------|
| `frontend/src/screen-framework/input/adapters/NumpadAdapter.js` | Numpad key → action (no change) |
| `frontend/src/screen-framework/input/actionMap.js` | `volume` → `display:volume` (no change) |
| `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` | **Change**: `handleVolume` (lines 204–214) |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | **Change**: insert provider |
| `frontend/src/screen-framework/providers/ScreenVolumeProvider.jsx` | **New file** |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | Compose master into `.volume` write |
| `frontend/src/modules/Player/components/AudioLayer.jsx` | Compose master into fade |
| `frontend/src/modules/Feed/players/FeedPlayer.jsx` | Compose master into `.volume` write |
| `frontend/src/modules/Fitness/components/useMediaAmplifier.js` | Compose master into gain |
| `frontend/src/modules/Fitness/nav/VolumeProvider.jsx` | Read master in `applyToPlayer` |
| `frontend/src/modules/Fitness/player/overlays/GovernanceAudioPlayer.jsx` | Compose master |
| `frontend/src/modules/Input/hooks/useNativeAudioBridge.js` | Compose master onto bridge gain |
| `frontend/src/modules/Piano/PianoSpaceInvaders/useSpaceInvadersGame.js` | Read master at trigger |
| `frontend/src/modules/Fitness/shared/hooks/useAudioFeedback.js` | Read master at trigger |
| `backend/src/4_api/v1/routers/homeAutomation.mjs` | No change (used only for one-time bootstrap) |
| `backend/src/1_adapters/home-automation/remote-exec/RemoteExecAdapter.mjs` | No change |
| `tests/unit/screen-framework/NumpadAdapter.test.js` | No change (adapter unaffected); new tests target the provider |
