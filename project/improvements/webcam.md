# Goal
Consolidate fitness webcam instances into a single react component that can be reused across the app.  Same filter/shader should be applied consistently.  Snapshot should be taken no matter the source of the webcam (sidebar, full screen, etc).  FitnessCamStage seems to violate DRY principles, and principles of modularity and reusability.

## Architecture Suggestions
Use a single reusable `FitnessWebcam` component and route every webcam use through it (sidebar, fullscreen, overlays, snapshots) to keep capture, filters, and snapshots consistent.

### Core Component
- Build `FitnessWebcam` that owns: getUserMedia lifecycle, device selection (video/audio), error/loading UI, volume meter, shader/filter application, snapshot capture, and exposes refs/commands via props/context.
- Props: `onSnapshot(blob|dataUrl)`, `onStreamReady(stream)`, `onError(err)`, `videoConstraints`, `audioConstraints`, `shader`/`filter` config, `captureIntervalMs`, `showControls` toggle, `renderOverlay` render-prop for custom UI.
- Outputs via ref: `start()`, `stop()`, `switchCamera(direction|deviceId)`, `switchMic(direction|deviceId)`, `takeSnapshot()`, `getStream()`, `applyShader(config)`, `setConstraints(partial)`.
- Internals: single `<video>` element bound to `MediaStream`; canvas pipeline for filters/shaders; optional `OffscreenCanvas` if available.

### Snapshot Pipeline
- Always capture from the rendered video (post-filter) via canvas to ensure consistent look; support both manual and interval-based snapshots.
- Interval capture hook (`useWebcamSnapshots`) accepts `intervalMs`, `enabled`, `onSnapshot`, `onError`; shared by sidebar/fullscreen to avoid duplicate timer logic.
- Snapshots carry metadata: `{ takenAt, deviceId, resolution, filterId, context: 'sidebar'|'player'|'overlay' }` so backend can differentiate sources even though component is shared.

### Filters/Shaders
- Centralize shader/filter definitions in `webcamFilters.js` (e.g., lut, grayscale, blur, vignette). Component takes `filterId` and optional params; applies consistently in both sidebar and fullscreen.
- Apply filters on the canvas layer (not CSS) so snapshots match on-screen preview.
- Provide a minimal preset map and a way to inject custom shaders for experiments.

### Device Management
- Single device-selection hook (`useMediaDevices`) that lists cameras/mics, remembers last-used IDs in memory (not localStorage), and offers `next/prev` cycling.
- Handle permissions/errors uniformly; surface friendly messages; expose availability flags so hosts can render fallbacks.

### Integration Points
- Sidebar `FitnessVideo` and fullscreen `FitnessCamStage` become thin wrappers that render `FitnessWebcam` with mode-specific chrome but no duplicated media logic.
- Snapshot consumers (logging/upload) subscribe via `onSnapshot`; reuse the same hook in both locations to guarantee snapshots fire regardless of entry point.
- Provide a small context (`FitnessWebcamProvider`) if multiple consumers need the same stream instance (e.g., sidebar preview + overlay meter) without extra getUserMedia calls.

### Resilience & UX
- Guard SSR (`typeof navigator !== 'undefined'`) and feature-detect `getUserMedia`; show actionable errors.
- Auto-retry on device change/stream drop with backoff; expose `status` so hosts can show “reconnecting.”
- Keep hotkeys (e.g., `c`/`m` cycling) in the shared component to avoid drift between views.

### Migration Plan
1) Extract common logic from `FitnessCamStage`/`FitnessSidebar/FitnessVideo` into `FitnessWebcam` + `useMediaDevices` + `useWebcamSnapshots`.
2) Replace existing `<video>` usages with the new component, passing minimal props for each host.
3) Move filters/shaders into `webcamFilters.js`; wire both hosts to the same presets.
4) Verify snapshots fire from both sidebar and fullscreen; compare outputs to ensure visual parity.


## Detailed Design Doc

### Goals & Non-Goals
- Goals: single webcam pipeline (capture, filter, snapshot) reused across sidebar/fullscreen/overlays; identical visuals between preview and captured snapshots; minimal duplicated code; predictable device handling; safe fallbacks without localStorage reliance.
- Non-goals: recording/streaming to remote endpoints, advanced color grading UI, or device-permission UX redesign.

### Component Surface (`FitnessWebcam`)
- Props: `videoConstraints`, `audioConstraints`, `filterId`, `filterParams`, `captureIntervalMs`, `enabled`, `onSnapshot`, `onStreamReady`, `onError`, `renderOverlay`, `showControls`, `className`, `style`.
- Ref API: `start()`, `stop()`, `switchCamera(dir|deviceId)`, `switchMic(dir|deviceId)`, `takeSnapshot() -> Promise<Snapshot>`, `getStream()`, `applyFilter({ filterId, params })`.
- Render: wraps a single `<video>` + optional `<canvas>` (or OffscreenCanvas) for shader pipeline; overlay slot for UI.

### Hooks & Utilities
- `useMediaDevices`: enumerate devices, watch for changes, provide `next/prev` selectors, remember last-used IDs in memory.
- `useWebcamStream`: manages getUserMedia, retries/backoff, SSR guards, status machine (`idle|starting|ready|error|reconnecting`).
- `useWebcamSnapshots`: timer + manual capture from the post-filter canvas; debounced error reporting.
- `webcamFilters.js`: map of filter IDs to shader/canvas transforms; default noop + shared presets.

### State & Persistence
- No localStorage usage; last-used devices are kept in-memory per session. Volume/mute is unrelated here.
- Internal state: `status`, `activeVideoId`, `activeAudioId`, `stream`, `lastSnapshotMeta`, `error`.

### Snapshot Flow
1) Draw current video frame to canvas (with filter applied).
2) Extract blob/dataURL; attach meta `{ takenAt, deviceId, resolution, filterId, context }`.
3) Call `onSnapshot(meta, blob)`; hosts handle upload/logging.
4) Interval capture uses `captureIntervalMs` + `enabled` flag; manual capture always available via ref.

### Error Handling & Resilience
- Guard `navigator.mediaDevices` and `getUserMedia`; emit friendly errors (`permission-denied`, `device-not-found`, `insecure-context`).
- Auto-retry on track end/device change with capped backoff; surface `status` so host can show “reconnecting.”
- Cleanly stop tracks on unmount or when toggling `enabled` false.

### Integration Plan
- Sidebar: replace `FitnessVideo` internals with `FitnessWebcam`, pass minimal chrome and hook snapshot/upload handlers.
- Fullscreen: replace `FitnessCamStage` video/snapshot logic with `FitnessWebcam`; reuse hotkeys by passing `renderOverlay` that wires key handlers once.
- Shared filters: both modes import `webcamFilters.js` so preview and snapshots stay identical.

## Suggestions for Better Component Naming and Reuse
- Rename `FitnessCamStage` to `FitnessWebcamMain` to clarify its role as the primary large-scale (not quote fullscreen) webcam view.
- Webcam should not be confused with Video in FitnessPlayer, therefore, avoid using "Video" in the webcam component names.
- Ensure all webcam-related components (sidebar, fullscreen, overlays) import from the same `FitnessWebcam` module to enforce DRY principles.
- Document the `FitnessWebcam` API clearly so future developers understand how to integrate it without duplicating logic.

## Phased Implementation Plan
- **Phase 1: Core extraction and scaffolding**
	- Create `FitnessWebcam` component with basic getUserMedia, single `<video>`, optional `<canvas>`, and ref API (`start/stop/switch/takeSnapshot`).
	- Add `useMediaDevices`, `useWebcamStream`, `useWebcamSnapshots` hooks and `webcamFilters.js` preset map (include noop filter).
	- Wire error/status handling and SSR guards; add minimal Storybook/demo or dev page to validate in isolation.

- **Phase 2: Filters and snapshot parity**
	- Implement canvas/OffscreenCanvas filter pipeline; ensure preview == captured snapshot output.
	- Add interval snapshot support with metadata; integrate upload/log callback in one host (e.g., fullscreen).
	- Validate performance and fallback to CSS filter only if canvas fails (but warn that snapshots may differ).

- **Phase 3: Device UX and resilience**
	- Implement device cycling UI/hotkeys (`c` camera / `m` mic) in the shared component; add reconnect/backoff on track end/device loss.
	- Add friendly error states (permission denied, no devices, insecure context) and recovery flows.
	- Keep last-used devices in-memory per session; no localStorage.

- **Phase 4: Host integration (sidebar & fullscreen)**
	- Replace `FitnessSidebar/FitnessVideo` internals with `FitnessWebcam`, keeping only layout/chrome.
	- Replace `FitnessCamStage` video/snapshot logic with `FitnessWebcam`; wire existing hotkeys via `renderOverlay`.
	- Confirm both hosts consume the same filter presets and snapshot hook.

- **Phase 5: Shared stream/context (if needed)**
	- Introduce `FitnessWebcamProvider` to share a single stream between sidebar preview and overlay/meter without extra getUserMedia calls.
	- Add a hook to tap into the shared stream for read-only overlays (volume meter, status badge) without creating tracks.

- **Phase 6: Nice to have Shader**
    - Add a CRT shader option to the `webcamFilters.js` presets for a retro aesthetic, with this refernece: 
     ```
     :root {
  --crt-red: rgb(218, 49, 49);
  --crt-green: rgb(112, 159, 115);
  --crt-blue: rgb(40, 129, 206);
}
/* Global */
html {
  font-size: 1.5rem;
  font-family: "Courier New", monospace;
  min-height: 100%;
}
main {
  height: 100vh;
  height: 100dvh;
  color: rgba(255, 255, 255, 0.75);
}

.pink {
  color: pink;
}
.yellow {
  color: yellow;
}
.lightblue {
  color: lightblue;
}
.code {
  color: attr(data-color);
}
.wrapper {
  padding-top: 2rem;
  padding-left: 1rem;
  display: inline-block;
  white-space: nowrap;
}
.code {
  animation: typewriter 1s steps(14) 1s 1 normal both;
  line-height: 1;
  margin: 0;
  display: inline-block;
  white-space: nowrap;
  overflow-x: hidden;
}
.cursor {
  display: inline-block;
  animation: blinkTextCursor 500ms infinite normal;
}

/* Animation */
.anim-typewriter {
}
@keyframes typewriter {
  from {
    width: 0;
  }
  to {
    width: 100%;
  }
}
@keyframes blinkTextCursor {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.crt {
  background-color: rgb(25, 25, 30);
  text-shadow: 0 0 0.2em currentColor, 1px 1px rgba(255, 0, 255, 0.5),
    -1px -1px rgba(0, 255, 255, 0.4);
  position: relative;
  &:before,
  &:after {
    content: "";
    transform: translateZ(0);
    pointer-events: none;
    //opacity: 0.5;
    mix-blend-mode: overlay;
    position: absolute;
    height: 100%;
    width: 100%;
    left: 0;
    top: 0;
    z-index: 1;
  }

  &:before {
    background: repeating-linear-gradient(
      var(--crt-red) 0px,
      var(--crt-green) 2px,
      var(--crt-blue) 4px
    );
  }
  &:after {
    background: repeating-linear-gradient(
      90deg,
      var(--crt-red) 1px,
      var(--crt-green) 2px,
      var(--crt-blue) 3px
    );
  }
}

---