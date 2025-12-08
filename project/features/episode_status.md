# Update episode status on playback end or exit

When an episode finishes playing or the user exits playback, the episode's status should be updated to "completed" or "in progress" based on how much of the episode was watched in the FitnessShow.jsx component.  

## Functional Requirements
- Status values: use "completed" when watch threshold met; otherwise use "in_progress". Do not emit other states.
- Completion threshold: mark completed when playback position >= 90% of episode duration (rounded down to nearest second). Allow manual override to completed when the player fires its natural `ended` event regardless of percent.
- In-progress threshold: mark in_progress when playback position >= 10% and < 90%; ignore exits before 10% (leave status unchanged).
- Triggers: send update on (1) natural end, (2) user-initiated exit/close/back from FitnessShow, (3) hard navigation away (route change) if player has started.
- Source of truth: derive position and duration from the active player instance in `FitnessShow.jsx`; fall back to last known progress in context if the media element is unavailable.
- Debounce/once: ensure only one update per session exit; suppress duplicate requests within 2 seconds.
- Payload: include `episodeId`, `status`, `positionSeconds`, `durationSeconds`, and a boolean `naturalEnd` flag.
- Error handling: log failures and retry once on transient network errors; on second failure, keep status change queued in memory and flush on next app focus.
- Telemetry: emit a lightweight event (`episode_status_update_attempt`) with status and percent watched for analytics/debugging.
- UI refresh: after a successful status update, re-call the show API to fetch the updated episode payload and rehydrate the UI from that response (do not locally mutate caches beyond the refreshed payload).

## Design Spec
- Responsibility boundary: `FitnessShow.jsx` owns playhead sampling, status derivation, and the update call; API client module owns HTTP, retry, and error translation; global store (context) exposes last-known show payload.
- Flow: on `ended` or exit/back/nav, compute status + payload → debounce guard (2s window) → fire `PUT/POST episode status` → on success, immediately re-call show API → replace show payload in context/store → UI re-renders from fresh payload.
- Data sources: prefer live media element for position/duration; fallback to context progress snapshot if element unavailable; duration rounded down to whole seconds before threshold math.
- Edge cases: if duration < 30s, always mark completed on natural end; if playback never started (<10%), skip update; if player destroyed mid-flight, cancel inflight update.
- Retry/backoff: single retry on network 5xx/timeout with 500ms backoff; no retry on 4xx. Queue unsent change in memory and flush on next app focus.
- Concurrency: ignore duplicate triggers while a request is inflight; accept the first successful response and drop later arrivals for the same session/episode.
- Telemetry: emit `episode_status_update_attempt` before request and `episode_status_update_result` after (include status, percent watched, naturalEnd, success/fail, retry flag).
- UX: show no blocking UI; optionally log to console in dev. If API refresh fails, keep existing UI but log and retry refresh on next focus.

## Phased Implementation Plan
- Phase 1: Wire playhead sampling
	- Add helpers in `FitnessShow.jsx` to read currentTime/duration safely and round to seconds; store last-known snapshot in context.
	- Gate sampling to only start after playback begins; handle element missing/null.
- Phase 2: Status derivation + thresholds
	- Implement a pure function to compute status (`completed`/`in_progress`/`none`) from position/duration and `naturalEnd` flag.
	- Unit test threshold edges (0%, 9%, 10%, 89%, 90%, natural end, short-duration <30s).
- Phase 3: Trigger wiring
	- Hook into `ended`, player destroy/exit handlers, back/navigation events in `FitnessShow.jsx` to invoke the status computation.
	- Add debounce guard (2s window) and inflight lock.
- Phase 4: API client + retries
	- Implement `updateEpisodeStatus(episodeId, payload)` with single retry on 5xx/timeout (500ms backoff), no retry on 4xx.
	- Emit telemetry events (`episode_status_update_attempt/result`).
- Phase 5: Refresh and rehydrate
	- After a successful update, re-call the show API to fetch fresh episode payload; replace show state in context/store; ensure UI re-renders.
	- If refresh fails, log and schedule refresh on next app focus.