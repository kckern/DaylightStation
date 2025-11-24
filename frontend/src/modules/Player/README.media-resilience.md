# Player Media Resilience Delta (MediaResilliancy vs. main)

_Last updated: November 23, 2025_

This document captures every change made under `frontend/src/modules/Player/**` on the `MediaResilliancy` branch relative to `main`, along with the purpose, intended benefit, and remaining risks or open questions. Use it as the authoritative review log before merging.

## High-Level Themes

1. **Media resilience architecture** – `Player.jsx` now orchestrates its own recovery flow (remounts, hard resets, telemetry) via the new `useMediaResilience` hook, entry GUID bookkeeping, and resilience overlays.
2. **Operational overlays** – `PlayerOverlayLoading` and `PlayerOverlayPaused` replace the old generic loading overlay with richer diagnostics, manual recovery affordances, and pause-state UX.
3. **Instrumentation** – `playbackLog` emits detailed breadcrumbs for remounts, overlay visibility, and timers, intended to aid postmortems.
4. **Styling alignment** – `Player.scss` adds layout support and debug-strip styling for the new overlays.

---

## File-by-File Detail

### `frontend/src/modules/Player/Player.jsx`

| Change | Purpose | Benefit | Dangers / Follow-Ups |
| --- | --- | --- | --- |
| **Expanded React stack** – imports now include `useState`, `useEffect`, `useMemo`, plus new helpers (`useMediaResilience`, `mergeMediaResilienceConfig`, `guid`, `playbackLog`, overlay components). | Provide the hooks/utilities needed for stateful resilience orchestration and telemetry. | Enables the Player to keep local copies of meta, accessors, and playback metrics instead of depending on child components. | File now has significantly more responsibilities; violates SRP and increases cognitive load for future contributors.
| **Entry GUID normalization (`ensureEntryGuid` + `entryGuidCache`)** | Ensure every active source has a stable `guid` for wait-keys, remount keys, and logging even when upstream items omit it. | Prevents remount storms triggered by key churn and improves log readability. | WeakMap fallback allocates GUIDs per object; if upstream reuses plain objects, GUID churn still possible. Consider pushing GUID generation upstream to avoid silent coupling.
| **Default state factories (`createDefaultMediaAccess`, `createDefaultPlaybackMetrics`)** | Provide safe, memoized defaults when the player mounts or switches items. | Eliminates `undefined` checks around consumer callbacks and keeps resilience hook inputs stable. | Factories return new object references; repeated resets may trigger unnecessary re-renders. Consider `useMemo` or constants for truly static defaults.
| **Stateful tracking (`resolvedMeta`, `mediaAccess`, `playbackMetrics`, `pendingSeekSeconds`, `remountState`)** | Mirror the SinglePlayer’s resolved metadata and playback telemetry inside the parent so resilience routines have synchronous access. | Parent can trigger reloads, overlays, and health checks without querying deep children. | Adds multiple layers of derived state that can drift from actual playback if callbacks fail. Requires rigorous effect ordering to avoid stale metrics.
| **`activeSource` / `singlePlayerProps` memoization with fallback GUID injection** | Decouple queue vs. single item selection logic and guarantee stable props for `SinglePlayer`. | Reduces repeated object spreads and ensures React keys include resiliency nonce. | Extensive memo chains make it harder to reason about when `SinglePlayer` actually re-renders; debugging key mismatches might be tricky.
| **`forceSinglePlayerRemount` + remount diagnostics** | Provide a central way (used by resilience hook or manual triggers) to restart the `SinglePlayer`, optionally seeking back to an intent time, and capture a diagnostic context. | Gives resilience flows deterministic control over remount cadence and surfaces telemetry via `playbackLog`. | Remount is now the hammer for many situations; risk of hiding root causes behind automatic retries. Repeated remounts can leak timers or break analytics if not throttled.
| **`handleResilienceReload` pipeline** | Interpret `useMediaResilience` reload requests (document reloads, hard resets, remounts) and choose the least-destructive action. | Allows granular fallbacks before forcing a full page reload and keeps the playback UI alive. | Coupling to `mediaAccess.hardReset` relies on SinglePlayer wiring; if the child stops registering handlers, resilience silently degrades. Needs tests around each branch.
| **Media access registration (`handleRegisterMediaAccess`)** | Let SinglePlayer hand back imperative helpers (`getMediaEl`, `hardReset`, `fetchVideoInfo`) so overlays/resilience can operate without querying DOM directly. | Centralizes native element access, enabling overlays to display live ready/network state. | API surface is implicit; no typing enforces the shape, so regressions are likely if SinglePlayer evolves. Consider TS typedefs or PropType validation.
| **Playback metrics + overlays** | SinglePlayer now reports `seconds`, `isPaused`, `isSeeking` to the parent, which feeds `useMediaResilience` and overlays. | Overlays can show accurate timers, and resilience logic can differentiate pause vs. stall cases. | Metric updates rely on frequency heuristics; flooding `setPlaybackMetrics` could cause renders each frame. Need throttling if data spikes.
| **`withTransport` helper + ref exposure rewrite** | Wrap imperative calls to prefer controller transports (if provided) before falling back to DOM element APIs. | Abstracts over audio/video implementations and avoids direct DOM mutation when transport objects expose richer methods. | Swallows errors silently and returns `null`, which can hide broken controller implementations. Add logging or throw in development to avoid silent failures.
| **Player props expansion** – `SinglePlayer` now receives callbacks: `onResolvedMeta`, `onPlaybackMetrics`, `onRegisterMediaAccess`, `seekToIntentSeconds`, `onSeekRequestConsumed`, `remountDiagnostics`, `wrapWithContainer=false`. | Give SinglePlayer the hooks it needs to report into the new parent-level resilience system. | Keeps resilience logic centralized in one place while leaving rendering to SinglePlayer. | Backwards compatibility risk: existing SinglePlayer implementations must implement all new callbacks and semantics, but no prop gating/checks exist.
| **New overlay composition** – wraps SinglePlayer with `PlayerOverlayLoading` and `PlayerOverlayPaused`, and provides idle fallback overlays when no item is active. | Surface buffering/paused feedback consistently and keep resilience telemetry alive even when no media is active. | Improves UX (clear status, manual recovery tap target) and observability (debug strip). | Overlay visibility tied to `overlayProps` from `useMediaResilience`; if that hook misbehaves the player may render empty. Consider default props or guards.
| **Export surface change** – re-export `PlayerOverlayLoading`/`Paused` instead of the removed `LoadingOverlay`. | Keep external modules aligned with new overlay components. | Prevents downstream imports from breaking when `LoadingOverlay` disappears. | Consumers still referencing `LoadingOverlay` will break; no compatibility shim provided.

### `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx` (new)

| Change | Purpose | Benefit | Dangers / Follow-Ups |
| --- | --- | --- | --- |
| **Dedicated loading overlay component** with stateful timers, media element inspection, manual reset triggers, and logging hooks. | Replace the minimal overlay with one that can act as a resilience control plane. | Operators can see ready/network states, intent seek position, and trigger hard resets via spinner interactions; telemetry logs capture every second of the stall. | Component is 300+ lines with many responsibilities (timers, logging, DOM inspection). Lacks unit tests and can easily drift from Player expectations. Needs decomposition or hooks.
| **Failsafe timer (`hardResetDeadlineMs`)** | Automatically request a hard reset if buffering exceeds a configured deadline. | Reduces cases where playback stays stuck indefinitely without user action. | Without backoff, repeated hard resets may lead to thrash, especially on poor networks. Add exponential backoff or cap tries.
| **`getMediaEl` polling for diagnostics** | Sample DOM media element properties once per second to render into debug strip. | Provides precise insight into HTMLMediaElement state (readyState/networkState). | Polling may keep the main thread busy on low-power devices; consider requestAnimationFrame or event-based updates. Swallowing errors with `console.warn` may spam logs.
| **Extensive logging via `playbackLog`** for overlay summaries and visibility transitions. | Provide structured breadcrumbs for DevOps dashboards. | Makes it easier to correlate user reports with telemetry. | Logging every second could generate high-volume logs. Consider gating behind debug flag or sampling.
| **User interactions mapped to `emitHardReset`** | Provide touch/click/double-click handlers that request a hard reset. | Gives power users a recovery lever without reloading the page. | Without UI affordance explaining the gesture, accidental taps could trigger disruptive resets.

### `frontend/src/modules/Player/components/PlayerOverlayPaused.jsx` (new)

| Change | Purpose | Benefit | Dangers / Follow-Ups |
| --- | --- | --- | --- |
| **Pause-specific overlay** that reuses loading overlay styles but shows a pause glyph and timecode. | Differentiate “healthy pause” from “stalled buffering” states, matching user expectations. | Cleaner UX; avoids showing spinner when user simply paused. | Relies on `pauseOverlayActive` flag managed elsewhere; if state desyncs, pause overlay might appear while stalled. No resilience logging here—consider parity with loading overlay.
| **Fullscreen gesture blocking** | Prevent overlays from interfering with platform fullscreen toggles. | Stops inadvertent fullscreen exits/enters when interacting with overlay controls. | Adds duplicated logic from loading overlay; consider extracting shared hook.

### `frontend/src/modules/Player/Player.scss`

| Change | Purpose | Benefit | Dangers / Follow-Ups |
| --- | --- | --- | --- |
| **Commented out `cursor: none` on `.player`** | Restore cursor visibility (possibly for desktop debugging). | Developers regain a cursor while testing overlays and resilience flows. | TV app behaviour may regress if cursor should stay hidden. Confirm platform-specific styling before shipping.
| **`.loading-overlay` layout tweaks** – padding, box sizing, center alignment moved to flex column wrapper. | Support richer overlay content (debug strip, timers) with better spacing. | Keeps overlay responsive and ensures spinner stays centered regardless of viewport. | Extra padding could intersect with existing video letterboxing; test across themes.
| **`.loading-overlay__inner` container** | Provide structural wrapper for spinner vs. debug strip. | Simplifies aligning timer vs. log sections. | Adds another DOM level; ensure accessibility tree remains reasonable.
| **Pointer cursor on `.loading-spinner`** | Communicate that spinner is now clickable (manual hard reset). | UX hint for manual recovery interactions. | On TV devices without pointer, cursor style has no effect; consider conditional styling to avoid confusing remote users.
| **`.loading-debug-strip` styles** | Visualize telemetry text appended by `PlayerOverlayLoading`. | Gives operators contextual data without opening dev tools. | Always-on debug strip might distract end users; consider gating behind `debug` flag or environment check.

---

## Residual Risks & Recommendations

1. **Complexity creep** – `Player.jsx` now mixes queue management, resilience orchestration, overlay layout, and imperative APIs in one file. Refactor into composable hooks or context providers to keep future features manageable.
2. **Implicit contracts** – Handshake between `SinglePlayer` and parent (`onResolvedMeta`, `onRegisterMediaAccess`, transport API) is undocumented. Add TypeScript types or at least a shared JSDoc contract to reduce accidental breakages.
3. **Logging volume** – Overlay logging emits every second when visible. Validate that `playbackLog` backend can handle the traffic, or throttle to warning scenarios.
4. **User-facing debug strip** – Consider hiding the debug strip for production viewers or behind a `debug` feature flag to avoid confusing non-technical users.
5. **Remount storm safeguards** – Add metrics/guardrails to avoid infinite remount loops (e.g., limit to N remounts per minute, escalate to full page reload after threshold).

---

Please update this README as further adjustments land so reviewers can continue to trace intent, benefits, and remaining concerns.
