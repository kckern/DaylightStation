# WeeklyReview — Session Logging Gap

**Date:** 2026-06-07
**Status:** Finding + recommended fix (not yet implemented)
**Area:** `frontend/src/modules/WeeklyReview/`, `frontend/src/lib/logging/`

## TL;DR

WeeklyReview's *code-level* logging is excellent — thorough structured events at
every lifecycle/error/perf point, zero raw `console.*`. **But none of those events
persist to a session-log file on disk**, so a recorded WeeklyReview run is not
greppable after the fact (only visible in the live browser console / WS stream).

Root cause: the session-file transport only writes events whose context carries
**both** `app` and `sessionLog: true`. WeeklyReview never sets either, because it's
a screen-framework *widget* (not a top-level App like Feed/Fitness/Life/Admin, which
do set them).

## Evidence

- WeeklyReview is registered as a widget, not mounted as an App:
  `modules/WeeklyReview/index.js` → `registry.register('weekly-review', WeeklyReview)`.
- Its loggers only set `component`:
  - `WeeklyReview.jsx:18` — `getLogger().child({ component: 'weekly-review' })`
  - `hooks/useAudioRecorder.js`, `hooks/useChunkUploader.js`, `components/DayReel.jsx`
    — all `child({ component: '...' })`, no `app`/`sessionLog`.
- Session-file transport gate: `backend/src/0_system/logging/transports/sessionFile.mjs`
  `write()` returns early unless `event.context.app && event.context.sessionLog`.
  Files land in `media/logs/{app}/{ISO-ts}.jsonl`.
- Disk check (2026-06-07): no `media/logs/weekly-review/` dir exists. Grepping all of
  `media/logs/**` for `weekly-review` returns a single hit — an *admin* UI click that
  merely opened the widget preview (`event: preview.open`, `app: admin`) — never an
  actual recording session.

## How the other apps get session logs

They set the context themselves, on mount:

- `Apps/FitnessApp.jsx:64` — `useMemo(() => getLogger().child({ app: 'fitness', sessionLog: true }), [])`
  plus `configure({ context: { app: 'fitness', sessionLog: true } })` at `:78`, reverted
  to `sessionLog: false` on unmount.
- `Apps/FeedApp.jsx:18,51,59` — same shape (`app: 'feed'`).
- `Apps/LifeApp.jsx`, `Apps/AdminApp.jsx` — same.

## The gotcha (why a naive `configure()` is not enough)

Child loggers **snapshot the parent context at creation time**, not at emit time:
`lib/logging/Logger.js` `child()` does `const parentContext = { ...config.context }`
once. WeeklyReview's `const logger = ...child(...)` at `WeeklyReview.jsx:18` runs at
*module import*, long before any mount. So calling `configure({ context: { app,
sessionLog } })` later would **not** retroactively add `app`/`sessionLog` to that
already-created child. This is the same subtlety the feed code documents (see the
"recreate child each call to pick up sessionLog" notes in
`modules/Feed/players/FeedPlayerContext.jsx` and `modules/Feed/Scroll/feedLog.js`).

Also note: `child()` auto-emits a `session-log.start` event when the child is created
with `sessionLog: true` (`Logger.js:~187`). That event is what opens/rotates the
session file, so it should fire at **mount**, not at import.

## Recommended fix

Mirror FitnessApp: create the component logger inside the component with `useMemo` so
it (a) snapshots context at mount and (b) fires `session-log.start` at the right time,
and carry `app`/`sessionLog` in the child context directly rather than relying on
global config.

In `WeeklyReview.jsx`, replace the module-level logger:

```js
// before (module scope)
const logger = getLogger().child({ component: 'weekly-review' });

// after (inside the component body)
const logger = useMemo(
  () => getLogger().child({ app: 'weekly-review', component: 'weekly-review', sessionLog: true }),
  []
);
```

For the hooks (`useAudioRecorder`, `useChunkUploader`) and `DayReel`, either:
- pass `{ app: 'weekly-review', sessionLog: true }` into their child context too, or
- set global context once on mount —
  `configure({ context: { app: 'weekly-review', sessionLog: true } })` and revert with
  `configure({ context: { sessionLog: false } })` on unmount — and rely on their
  **lazy** `logger()` init (already used in the hooks) being first-called *after* mount
  so it snapshots the updated context. The explicit per-child approach is more robust
  than depending on effect/first-use ordering.

### Result
Runs would persist to `media/logs/weekly-review/{ISO-ts}.jsonl`, survive redeploys
(like the fitness session logs do), and be greppable by `sessionId` for post-hoc debugging
of recording/upload/reconnect flows.

## Scope / effort
Small, frontend-only. One required edit (`WeeklyReview.jsx` logger → `useMemo`) plus an
optional consistency pass on the two hooks + `DayReel`. No backend change — the
session-file transport already does the right thing once context is present.
