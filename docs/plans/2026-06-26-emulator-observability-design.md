# Emulator Observability — Eliminate Fire-and-Forget & Silent Failures

**Date:** 2026-06-26
**Status:** Implemented (2026-06-26) — approved scope: outcome-verified, module-wide
**Module:** `frontend/src/modules/Emulator/`

## Problem

A live session (Pokémon Crystal → Super Mario Land, garage Firefox kiosk) exposed
failures that prod logs reported as *successes*:

1. **SML never rendered**, yet logs showed `boot.ready`, `emulator.console.started`,
   and `resume-loaded {ok:true}`.
2. **Persisted volume didn't apply on load** — only "took" after the volume panel
   was opened (without changing anything). No log of either event.
3. **No retry path** when a launch fails to render — the user is left on a blank
   screen with no affordance.

Root causes are a cluster of fire-and-forget / silent-success patterns where the
code logs *intent* and *promise resolution* rather than *observed outcome*.

### Failure surface (full inventory)

| # | Site | Problem | Severity |
|---|------|---------|----------|
| 1 | `loadEmulatorJS.js` memoized `_loadPromise` | Reused across games with no game/core identity check → returns the **stale** (first-booted) instance. SML's ROM never loads. The one signal, `load.memoized-hit`, is `debug` → invisible in prod. | Critical |
| 2 | `EmulatorConsole.jsx:465` `Promise.resolve(p.saveResume(bytes)).catch(() => {})` | Empty catch on the **save-on-exit** write → a failed save is data loss with zero trace. | Critical |
| 3 | `saveClient.js` `getBlob` `!res.ok → null` | Conflates "no save exists" (204/404) with a real failure (500/network) → resume silently loads nothing. | Critical |
| 4 | `saveClient.js` `putBlob`/`deleteBlob` return bare `false` | No logging on failure; callers ignore the `false`. | High |
| 5 | `EmulatorEngine.js` `boot.ready` | Resolves on promise resolution, not observed render → "started" can mean a blank screen. | High |
| 6 | `EmulatorConsole.jsx:402` boot-time volume apply | Silent, no log. | Medium |
| 7 | No error/retry UI on empty/failed boot | `setError` only fires on a *rejected* load; the stale-instance "success" bypasses it. | High |
| 8 | `EmulatorConsole.jsx:173,289` localStorage `catch { /* ignore */ }` | Best-effort, but currently zero trace. | Low |

## The Observability Contract

Applied to every async op in the module:

1. **No swallowed errors.** Zero `.catch(()=>{})` / comment-only catches. Every
   catch emits a structured `warn`/`error`. Best-effort localStorage writes drop
   to `debug` — never silent.
2. **Begin + outcome.** Every significant async op logs a start and a terminal
   `{ ok: true|false }`. Absence of an event never implies success.
3. **Success = observed, not resolved.** Boot is not `ready` until a first frame
   is confirmed for *this* ROM. New events `boot.first-frame` vs `boot.no-frames`
   (warn); `no-frames` trips the error state.
4. **Identity guards on shared state.** The loader verifies the resolved instance's
   game/core matches the request; mismatch → `warn` + forced reload. Eliminates the
   stale-instance class.
5. **saveClient discriminates absent vs failed.** Returns a discriminated result
   (`{ status: 'absent' | 'ok' | 'error', data?, httpStatus? }`); every save/delete
   logs its outcome; a failed persist surfaces a `warn` + UI hint, never a blank
   `.catch`.
6. **User-facing failures are recoverable.** Empty boot / failed load / failed
   resume → error state with a **retry** affordance, not a dead screen.
7. **Correlation id.** A per-mount `playId` is generated on console mount and
   stamped on every event in the play session, so one session greps end-to-end.

## Component-Level Changes

### `core/loadEmulatorJS.js`
- Track the `{ game, core }` the memoized instance was booted for.
- On a memoized hit, if requested `{ game, core }` differ → log
  `load.identity-mismatch` (warn) and force a fresh load (reset `_loadPromise`,
  tear down the prior `EJS_emulator`). Otherwise log `load.memoized-hit` at
  `info` with `{ requestedGame, resolvedGame }`.
- Promote enough context that a reuse is always visible in prod.

### `core/EmulatorEngine.js`
- Add a first-frame confirmation: after load resolves, poll `readFrameNum()` (or
  `EJS_onGameStart` for this ROM) until it advances, capped at ~3s.
- Emit `boot.first-frame { core, frames }` on success, `boot.no-frames { core }`
  (warn) on timeout. `boot.ready` keeps firing but now means "instance resolved";
  callers gate "playable" on `first-frame`.
- `boot.failed` already exists — keep, ensure it carries `{ core, error }`.

### `core/saveClient.js`
- `getBlob` → returns `{ status, data, httpStatus }`:
  - 204/404 → `{ status: 'absent' }`
  - ok + bytes → `{ status: 'ok', data }`
  - non-OK / thrown → `{ status: 'error', httpStatus }` + `warn` log.
- `putBlob`/`deleteBlob` → `{ status: 'ok' | 'error', httpStatus }` + log on error.
- `loadResume`/`persist`/`clear` propagate the discriminated result.
- Add a `logger` dep (injectable) to this client.

### `EmulatorConsole.jsx`
- Generate `playId` on mount; thread it into the child logger context so all
  console/session/engine events under this mount carry it.
- Boot chain: gate "started" on `boot.first-frame`; on `boot.no-frames` or a
  rejected load, `setError` with a retry-capable error object.
- Boot-time volume: log `emulator.console.volume-applied { level, volume, bus }`
  at `info`. Same on panel-open re-sync.
- Replace `Promise.resolve(p.saveResume(bytes)).catch(() => {})` with a logged
  outcome: `emulator.console.persisted { ok, bytes }` / `persist-failed` driven by
  the discriminated `persist` result.
- localStorage catches → `logger.debug('emulator.console.localstorage-failed', …)`.

### Error/Retry UI
- Add a retry affordance to the error state (reload the ROM via a fresh boot,
  resetting the loader memo first). Wire to the existing `setError` path so empty
  boots and failed loads both reach it.

## Testing (test-first)

Linchpin test — the bug that started this:
- **Boot game A, tear down, boot game B → assert B's ROM URL was actually loaded**
  (loader not short-circuited by stale memo). Fails today.

Additional:
- `boot.no-frames` path sets error + retry available.
- `saveClient` returns `absent` vs `error` distinctly; `getBlob` on 500 logs warn
  and does not look like "no save."
- Persist failure emits `persist-failed` (no silent catch).
- Volume-applied logs at boot and on panel open.
- `playId` present and stable across a mount's events.

## Out of Scope
- WRAM calibration accuracy (`matches:0`) — separate investigation; this work only
  improves its *observability*, not the algorithm.
- The console.warn re-ingestion double-logging (logging-framework level, not
  Emulator-specific) — note for a follow-up.
