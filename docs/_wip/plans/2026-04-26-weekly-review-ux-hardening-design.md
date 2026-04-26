# Weekly Review UX Hardening — Design

Date: 2026-04-26
Module: `frontend/src/modules/WeeklyReview/`

## Goals

1. **Audio capture is non-negotiable.** The widget must verify a working microphone before any user action and lock the UI if the mic disconnects mid-session.
2. **Audio data must never be discarded.** Every exit path saves what we have. The "Discard" affordance is removed entirely.
3. **Navigation reduced to a fixed model.** TOC → day → fullscreen image, with predictable arrow-key meanings at every level.
4. **Enter = upload, always.** Recording continues. The user may press Enter as often as they like; the server tolerates duplicate finalize calls.

## Non-goals

- No change to the chunk-upload pipeline (`useChunkUploader.js`) or IndexedDB durability layer (`chunkDb.js`).
- No new auth, session, or backend changes beyond:
  - Extending the bootstrap day window from 7 → 8 days (excluding today).
  - Tolerating repeated `finalize` calls within the same session.

## Resolved decisions

1. **8-day grid.** Bootstrap (`/api/v1/weekly-review/bootstrap`) is updated server-side to return **the 8 most recent past days, excluding today.** Today is not shown as a cell. If today is `2026-04-26`, the grid spans `2026-04-18` through `2026-04-25`. The existing `isToday` highlight logic in `DayColumn` becomes dead code and is removed.
2. **Disconnect timing.** Auto-reconnect bounded at ~3 seconds. If reconnect fails, the UI locks and finalize runs.
3. **Finalize duplicates.** Server-side `/api/v1/weekly-review/recording/finalize` is patched as needed so repeat calls within the same session succeed (overwrite or append — server's choice; we accept either).

## Navigation model

Four levels:

- **L0** — parent menu (outside the widget).
- **L1** — TOC: 8 cells in a 4×2 grid showing the past 8 days.
- **L2** — Day detail: photos + events for one day.
- **L3** — Fullscreen single image.

Default landing: **L1 TOC**, with the most recent day focused.

| Key | L1 TOC | L2 Day | L3 Fullscreen |
|---|---|---|---|
| ← Left | Open prev day's L2 (no-op at first) | Prev day at L2 (no-op at first) | Prev day at L2 (drops out of fullscreen) |
| → Right | Open next day's L2 (no-op at last) | Next day at L2 (no-op at last) | Next day at L2 (drops out of fullscreen) |
| ↑ Up | Exit widget to parent menu | Open fullscreen image #1 (L3) | Cycle to next image (wraps) |
| ↓ Down | Exit widget to parent menu | Back to L1 TOC | Cycle to prev image (wraps) |
| Enter | Upload (finalize current session) | Upload (finalize current session) | Upload (finalize current session) |
| Back / Esc | Save + exit widget (modal) | Up one level (back to L1) | Up one level (back to L2) |

**Boundary rule.** Left at first day = no-op. Right at last day = no-op. No wrap.

**Removed gestures.** No Enter-opens-detail. No double-press. No long-press. The model is keyboard-only and predictable.

### Enter = upload — exceptions

The "Enter triggers upload" rule applies only when the user is navigating the main content (TOC / Day / Fullscreen). It does **not** apply when:

- A modal is open (pre-flight failed, resume-draft, stop-confirm, finalize-error). In a modal, arrow keys toggle focus between buttons and Enter activates the focused button.
- The recording bar is focused (`focusRow === 'bar'`). Enter activates the focused bar button (Save & Close). The bar is reachable from the keyboard via Down at TOC; pressing Down again from the bar exits the widget.
- The disconnect modal is showing (informational only — all keys are swallowed while reconnect/finalize is in progress).

### Layout stability

Any element whose text changes per second or per frame (recording timer `m:ss`, pending-chunk count, sync status text, MIC LIVE/LOST pill, fullscreen image counter `N / total`) must use tabular numerals (`font-variant-numeric: tabular-nums`) and reserved-width containers (`min-width` in `ch` units). Otherwise the surrounding layout shifts every tick. This is implementation discipline — every dynamic text element gets a fixed-width treatment, no exceptions.

## Mic enforcement

User answer: pre-flight gate + disconnect-only gate during recording. Natural pauses do not block.

### Pre-flight gate (before user can act)

The widget mounts in a **pre-flight blocked state**. The TOC renders behind a blocking overlay; arrow keys and Enter are swallowed. Back / Esc remains active (see below) so the user can bail before any recording starts.

The block lifts when **both** conditions hold:
1. The audio stream initialized successfully (AudioBridge WS or `getUserMedia`).
2. At least one audio frame has been observed above the silence threshold (`normalized > 0.02` — the existing `silenceWarning` threshold).

A pre-flight overlay is shown until the gate clears. Copy: **"Listening for your microphone... Speak to begin."**

If the gate doesn't clear within ~10 seconds, the overlay shows a failure state with two buttons:
- **Retry** — re-acquire stream, re-run gate.
- **Exit** — leave the widget cleanly (no recording was ever started, no data to save).

Back / Esc during pre-flight (any time, not just the timeout state) exits the widget cleanly — there's no audio data to save yet, so the no-loss rule doesn't apply.

The recorder is started immediately on mount (so chunks begin queueing as soon as the user speaks). The gate purely blocks the UI; it does not block recording. Pre-gate audio is captured and uploaded normally.

### During-recording: disconnect-only gate

While recording is live, monitor:
- The audio track's `readyState`. If it transitions to `"ended"`, that's a disconnect.
- AudioBridge `onclose` events with non-1000 codes.
- Natural pauses (silence at the analyser) do **not** trigger.

On disconnect, the widget:
1. Shows a transient "Mic dropped — reconnecting..." banner.
2. Attempts a single auto-reconnect of the mic stream (~3 seconds bounded).
3. **If reconnect succeeds**, banner clears, recording continues. Sequence numbers continue. Brief gap in the audio is accepted.
4. **If reconnect fails**, the widget locks the UI with a modal: **"Microphone disconnected. Saving your recording..."** and immediately calls `finalizeRecording()`. The modal has **no Discard option**. Once finalize succeeds, the widget exits cleanly to the parent menu.

If finalize itself fails on the disconnect path, fall through to the existing `finalizeError` flow (Retry / Exit-save-later). Exit-save-later still preserves chunks in IndexedDB and on the server for next-mount draft recovery, so no data is lost.

## Enter = upload semantics

Each Enter press calls `POST /api/v1/weekly-review/recording/finalize` with the current `sessionId`, `week`, and best-known `duration`.

After finalize:
- Recording **continues**. The MediaRecorder is not stopped.
- Chunks emitted after finalize keep flowing through the same chunk endpoint with the same `sessionId`.
- The next Enter press triggers another finalize call. The server may produce additional finalized files (the user explicitly accepted duplicates).

**UX feedback:** a brief "Uploading..." flash on the recording bar during the in-flight finalize call. No modal. The user keeps navigating immediately.

**Debounce:** Enter is debounced at 1s to absorb double-fires from the remote. If finalize is in flight, additional Enter presses are ignored (not queued).

**Error handling:** If finalize errors, surface a non-blocking toast on the recording bar ("Save failed — will retry"). The chunk pipeline continues. The next successful Enter press supersedes the failure. We never block the user out of navigation due to a finalize error mid-recording (only on the disconnect-driven path described above).

## Back / save-on-exit guarantee

Single rule: **the widget never unmounts with un-uploaded local chunks unless save was attempted first.**

### Per-level Back behavior

- **At L3 Fullscreen:** Back climbs one level → drops to L2 day detail.
- **At L2 Day:** Back climbs one level → goes to L1 TOC.
- **At L1 TOC:** Back triggers the existing stop-confirmation modal. The only choices are **"Continue Recording"** and **"Save & Close."** No Discard.

### Pop-guard (system / remote back)

`MenuNavigationContext.setPopGuard` intercepts the system back / `popstate` at all times. It mirrors the per-level behavior above:
- L3 → drop to L2.
- L2 → drop to L1.
- L1 → show save modal.

This means whether the user presses the soft Back, the remote Back, or triggers a `popstate`, the same hierarchy applies.

### Page teardown

Existing `pagehide` and `beforeunload` beacon flush remain. Last-resort durability if the browser tears down before save completes. (Already correct in the current implementation.)

### Resume-draft overlay

If a draft is found at mount, the only option is **"Finalize Previous."** The existing **"Discard"** button is removed.

## Component / file changes

| File | Change |
|---|---|
| `WeeklyReview.jsx` | Rewrite the keyboard handler around the 4-level state machine. Replace `selectedDay` boolean with `viewLevel: 'toc' \| 'day' \| 'fullscreen'` plus `dayIndex` (always set) and `imageIndex` (set when at L3). Add pre-flight gate state. Remove the "init overlay" press-to-start UI. Remove all Discard buttons. |
| `hooks/useAudioRecorder.js` | Add disconnect detection: track `ended` event and bridge WS `onclose` non-1000. Surface `disconnected` flag and `firstAudibleFrameSeen` flag. Add bounded `reconnect()` method. |
| `components/PreFlightOverlay.jsx` | New. Shown until pre-flight passes. Animated mic icon. Retry/Exit buttons after timeout. |
| `components/FullscreenImage.jsx` | New. Renders one image fullscreen with image index indicator (e.g., "3 / 12"). |
| `components/DayDetail.jsx` | Remove the close-button affordance (Back handles exit). Add U-arrow hint to enter fullscreen. Stop owning its own keyboard handling — `WeeklyReview.jsx` now owns all keyboard. |
| `components/RecordingBar.jsx` | Add a brief "Uploading..." flash during in-flight finalize calls. Add a clear "MIC LIVE" / "MIC LOST" indicator. |
| `WeeklyReview.scss` | Styles for pre-flight overlay, fullscreen image view, mic-status indicator. |
| Backend: `bootstrap` endpoint | Extend to return 8 past days (excluding today) instead of 7. |
| Backend: `finalize` endpoint | Patch (if needed) to tolerate repeat calls within the same session. |
| `components/DayColumn.jsx` | Remove `isToday` highlight logic — today is no longer in the grid. |

## State machine

States:

| State | Description |
|---|---|
| `LOADING` | Bootstrap fetch in flight. |
| `PREFLIGHT` | Mic acquisition / first-frame check. UI inert. |
| `PREFLIGHT_FAILED` | Mic didn't come up within ~10s. Retry / Exit buttons. |
| `READY_TOC` | Recording live, user at L1. |
| `READY_DAY` | Recording live, user at L2. |
| `READY_FULLSCREEN` | Recording live, user at L3. |
| `RECONNECTING` | Mic dropped; auto-retry in progress. UI shows banner but stays interactive (existing chunks still flowing from buffer). |
| `DISCONNECTED_FINALIZING` | Auto-retry failed; finalize in progress; UI fully locked. |
| `RESUME_DRAFT` | Overlay for unfinalized prior session. Only "Finalize Previous". |
| `FINALIZE_ERROR` | Finalize call failed; Retry / Exit-save-later. |
| `STOP_CONFIRM` | Back pressed at L1; modal showing Continue / Save & Close. |

State transitions are driven by:
- Bootstrap completion: `LOADING → PREFLIGHT`.
- Pre-flight gate clears: `PREFLIGHT → READY_TOC`.
- Pre-flight timeout: `PREFLIGHT → PREFLIGHT_FAILED`.
- Arrow keys at READY_*: navigate between READY_TOC / READY_DAY / READY_FULLSCREEN.
- Enter at any READY_*: trigger finalize, stay in current state.
- Back at READY_*: climb hierarchy, eventually `READY_TOC → STOP_CONFIRM`.
- Mic disconnect: `READY_* → RECONNECTING`, then `→ READY_*` (success) or `→ DISCONNECTED_FINALIZING` (fail).
- Finalize on DISCONNECTED_FINALIZING completes: exit widget.
- Finalize fails on DISCONNECTED_FINALIZING: `→ FINALIZE_ERROR`.

## Testing

### Unit

- `useAudioRecorder` — disconnect detection (track `ended`, WS close), first-frame detection, reconnect bounded retry timing.

### Integration (Playwright)

`tests/live/flow/weekly-review/`:

- Pre-flight blocks all input until audible audio.
- Pre-flight failure path: 10s timeout → Retry / Exit buttons work.
- Navigation: TOC → R → Day → R → Day → D → TOC. Boundary no-ops at first/last day. Up at L2 enters fullscreen; Up at L3 cycles images; Down at L3 cycles back.
- Enter at any level triggers finalize; recording continues; second Enter triggers another finalize.
- Back at L3 → L2; Back at L2 → L1; Back at L1 → save-confirm modal (no Discard option present in DOM).
- Mic disconnect mid-recording → reconnect succeeds → recording continues.
- Mic disconnect mid-recording → reconnect fails → finalize modal → exit.
- Resume-draft overlay shows only "Finalize Previous", no Discard.

### Manual smoke

Real Shield TV device:
- AudioBridge WS lifecycle on disconnect.
- Mic LED state matches widget state.
- Remote Back button respects the per-level hierarchy.
- Power-cycle scenario (kill the widget mid-recording, reload, verify resume-draft path saves data).

## Out of scope (explicit non-changes)

- The existing chunk-upload retry/backoff logic in `useChunkUploader.js` is correct; not touching it.
- The IndexedDB schema and retention purge in `chunkDb.js` is correct; not touching it.
- The `MenuNavigationContext` pop-guard plumbing is correct; we just register a different per-level handler.
- The pagehide/beforeunload beacon flush stays as-is.
