# Media Rebuild — Carry-Over Defect Audit (2026-06-10)

Adversarial audit of the rebuilt Media App against `docs/reference/media/`
(requirements C1–C10, technical contracts), run after the Backspace hijack
shipped in the rebuild revealed that reused platform seams and ported modules
had never been audited against the spec. Three parallel passes: spec
conformance, reused platform seams, ported module semantics.

## Fixed in this wave

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 1 | P0 | Queue tracked "current" by index while ops were identity-based — **reordering changed what was playing** (move up/down on the playing row switched tracks mid-playback) | queueOps rebuilt from spec: current tracked by queueItemId, index recomputed per op |
| 2 | P0 | upNext priority was permanent — **two Up Next items looped forever**, queue tail unreachable, repeat=off never terminated | Positional up-next band + demote-on-play-past; advancement only looks ahead |
| 3 | P0 | WebSocketService **hard-reloads the page after ~4 min of backend outage**, killing local playback (C9.4/C9.7) | `setAutoReloadEnabled(false)` opt-out; media app disables on mount, kiosks unchanged |
| 4 | P1 | Persisted/claimed **position never reached the player** — resume and Take Over started at 0:00 (C9.1, C7.3) | PlayerBridge injects `seconds` into the play prop, captured when an item becomes current |
| 5 | P1 | URL dedupe token included nav params — **reload after navigating replayed `?play` and destroyed the session** (§8) | Token built from the playback param namespace only |
| 6 | P1 | Autoplay-blocked overlay's window key listener ate Space/Enter while typing (same class as the Backspace bug) | Editable-target guard added |
| 7 | P1 | Failed dispatches poisoned the 5s idempotency cache — **Retry was a silent no-op**; consecutive hand-offs collapsed to one dedupe key and were dropped (C6.4) | Failure evicts the cache key; adopt keys carry snapshot identity; explicit retry bypasses dedupe |
| 8 | P1 | repeat=one trapped explicit Skip Next forever | Advancement distinguishes natural end from user skip |
| 9 | P1 | Reset didn't clear the URL-command token — deep links dead after reset (§11.3) | Reset clears both keys |
| 10 | P2 | `playNow` without clearRest prepended + rewound (replayed history) instead of replacing the current item (§4.4) | Replace-in-place |
| 11 | P2 | `addUpNext` insertion index miscounted when spent upNext items sat behind the cursor | Band-relative insertion |
| 12 | P2 | `reorder({items})` silently deleted unlisted items | Unlisted items append, never drop |
| 13 | P2 | Removing the current item carried its position onto the successor; removing the only item left a phantom currentItem | Successor promotion + position reset; empty → no current |
| 14 | P2 | Stop dispatched RESET — **destroyed the queue without confirmation** | New STOP action: playback ends, queue survives (`ready` state); Play resumes from the queue head |
| 15 | P2 | Pause lost up to 5s of position (hot tier never flushed) | Pause writes the hot position durably |
| 16 | P2 | Terminal `stopped` broadcast carried the first render's sessionId after reset/adopt (§10.3) | Latest-ref in the unmount path |
| 17 | P2 | "Frozen: Part 2" triggered the deep-link Play-this-ID affordance | contentId regex rejects whitespace |
| 18 | P2 | Take Over failures were invisible (C7.4) | Failure notification |
| 19 | P2 | Adopted snapshots kept the remote's `meta.ownerId` (§9.2) | Adoption preserves the local owner |
| 20 | P2 | Hand-off path bypassed its log taxonomy events | `handoff.initiated` emitted from the picker path |

## Known gaps — documented, not yet fixed

- **C9.5 error surface**: load/play failures auto-advance via the Player's
  resilience exhaustion (reported as item-ended), but the Player's `onError`
  is not wired to the controller, no error indicator renders, and there is no
  per-item retry affordance. Needs design: Player onError semantics include
  recoverable errors, so naive wiring would advance prematurely.
- **C5.3 partial**: remote-targeted Play Now/Next/Up Next/Add from search and
  detail (queue panel ops under peek are covered; the four content-adding
  actions always target local).
- **C6.2 softened / C6.5 missing**: Transfer/Fork defaults to the persisted
  preference rather than forcing a per-dispatch choice; per-dispatch
  shader/volume/shuffle options have no UI.
- **C4.3 device history**: deferred (no backend contract; tracked in the
  technical doc §4.2).
- **C5.4 partial / C4.2 partial**: shader has no control or display surface.
- **§11.1 drift**: scope recents/favorites keys unimplemented;
  `media-app.recents` is in use but undocumented in the schema.
- **wsService send-queue**: unbounded while disconnected; stale heartbeats
  burst-flush on reconnect (visible now that the auto-reload no longer
  truncates outages at 4 min).
- **useDismissable stacking**: with two keyboard-opened overlays, Escape
  dismisses the older one first (capture-phase registration order).
- **Shuffle never replays within a pass but has no played-set**; with
  repeat=all it may pick any non-current item (radio-style). Documented
  divergence.
