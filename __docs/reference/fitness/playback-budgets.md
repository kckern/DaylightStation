# Unattended playback budgets

Fitness can limit unattended playback across all content that carries a configured governed label. Types remain discovery filters. Each allowance belongs to a household, physical fitness device and policy; changing episodes, sessions or reloading does not replenish it.

```yaml
governance:
  playback_budgets:
    - id: unattended-governed-playback
      match: governed
      when: unattended
      limit_minutes: 15
      reset_on: [local_day, supervisor_join]
```

No budget entries preserves existing playback. A supervisor is an active roster participant whose household profile is `type: owner` or has `roles: [guardian]`, the same definition used by unattended HOT governance (`governance.superusers` is retired and ignored). Exemptions and guests do not imply supervision. Presence is instrumented through the roster. A supervisor counts only on their own strap: a supervisor's profile picked in the guest picker is a guest assignment, so it neither stands metering down nor triggers the `supervisor_join` reset.

A budget only meters while a governed child is on the roster. A governed child is a roster id that is not a supervisor, not exempt and not a guest; no household profile is required (a member rider without a profile is metered). With no governed child (only supervisors, guests or exempt riders) playback is not metered and the allowance is NOT reset. The browser sends the roster's guest assignments as `guestIds` in each observe body (array of at most 100 strings, each at most 100 characters), and the server applies the same rule to `participantIds` minus `guestIds`. Server and browser share one module, `shared/supervision.mjs` (`classifySupervision`, `isGovernedChildId`).

Allowance resets at household-local midnight, or once on an absent-to-present supervisor transition. Supervised time is free; when the supervisor leaves, the fresh allowance remains. The provider observes roster changes even with no Player mounted. HOT and challenges never replenish the allowance.

The browser meters observed native playing time with a monotonic clock. Pause, buffering, seeking, exercise holds, supervised and unmatched playback do not consume time. Playback rate and seeking distance do not multiply wall time. The server reserves grants of at most five seconds durably before playback. Clean stops refund unused grant time; losing the browser can conservatively spend its outstanding reservation. No new grant is available during a storage or network outage; the browser stops when its acknowledged grant ends. Grants expire after 15 seconds or at midnight. The browser renews two seconds before a grant runs out without pausing: playback keeps spending the current grant while the renewal is in flight, and the time played after the settlement snapshot is charged to the new grant. It only pauses when the old grant ends before the new one arrives. (Renewing by pausing first stuttered a child's video for ~2s of every 5s, 2026-10-18..20.) With nothing to meter, the browser observes once a minute; roster, content and supervision changes still observe immediately.

The separate `playback_budget` gate composes with exercise governance and survives manual/remote play, seek and queue advance. Queue and workout remain intact; saved playback state records reason `playback_budget`.

## Cover, statuses and the admin unlock

`PlaybackBudgetController.state()` reports one status:

| Status | Blocking | Meaning |
|---|---|---|
| `inactive` / `supervised` | no | nothing to meter (no governed content or child, or a supervisor is present) |
| `ready` | no | a grant is in hand; playback spends it |
| `held` | no | another hold owns the screen (exercise governance `videoLocked`, an open voice memo). No grant is asked for while it holds, so the meter keeps the media paused but puts up **no** cover: that hold's own screen and unlock are what the rider sees. Once it lifts, a grant is requested at once |
| `checking` | yes | a grant is being requested |
| `unavailable` | yes | the read failed or did not answer within `OBSERVE_TIMEOUT_MS` (8 s); retried every 2 s |
| `exhausted` | yes | today's allowance is spent (shown even while another hold is up) |
| `overridden` | no | an admin unlocked this item (below) |

**Why `held` exists (2026-11-10).** On the garage kiosk a Forza video under an
unattended governance lock (`videoLocked`, waiting for warm-up) sat behind
"Checking playback allowance… Waiting for playback allowance" for good: with
`canPlay` false the meter asks for no grant, so `checking` never ended, and its
cover hid the governance lock screen and its unlock. The supervisor joining
(`fitness.playback_budget.reset {reason: supervisor_join}`) and the presence
gate (`state: on`) were both fine; neither could reach a request that was never
made.

The cover (`overlays/PlaybackBudgetNotice.jsx`, `data-testid="playback-budget-overlay"`,
`data-status`) says what is happening for each blocking status and always offers
**Unlock** and **Back**:

- *checking*: "Checking playback allowance…" — "This usually takes a moment. A grown-up can unlock this video now."
- *unavailable*: "Playback allowance unavailable" — "The allowance could not be read; trying again. A grown-up can unlock this video."
- *exhausted*: "Unattended playback limit reached" — "A grown-up can join the workout to continue, or unlock this video with a fingerprint."

**Unlock** asks for an admin fingerprint with the presence gate's unlock
(`registerAdmin('playback_budget')`: any user in `users.admin`, see
[presence-gate.md](presence-gate.md)), in the same `UnlockPrompt` ("Grown-up
needed", 30 s). A match calls `usePlaybackBudget().grantOverride({ userId })`,
which lifts the meter for the **current item only** (by content id, like the
presence gate's per-entry admission): status `overridden`, no grant requested,
held playback resumes. The next item is metered again. A cancelled or failed
scan lifts nothing and the cover returns. **Back** closes the player.

Logs: `fitness.playback_budget.status` (`from`, `to`, `blocked`, `canPlay`,
`override`; info when the cover goes up or down, debug otherwise),
`fitness.playback_budget.unlock_tap`, `.unlocked` (`userId`), `.unlock_dismissed`,
`fitness.playback_budget.admin_override` (`userId`, `contentId`, `deviceId`),
and `fitness.playback_budget.unavailable` (warn) on a failed or timed-out read.

GET `/api/v1/fitness/playback-budgets?deviceId=...` reads status. POST `/api/v1/fitness/playback-budgets/observe` submits roster IDs, guest IDs, canonical content ID, stream/sequence and grant settlements. Responses are uncached. Limits and labels come from server configuration; effective parent labels come from the content catalog. Durable daily records live under household `fitness/playback-budgets/YYYY-MM-DD.yml`, schema `fitness.playback-budgets/v1`. Invalid records are errors, never fresh balances. Writes use atomic replacement with file/directory fsync. Request receipts make retries idempotent, and reset generations fence old grants.

Deploy backend and frontend together, then reload the kiosk. A spent-today rollout must seed the existing device/policy balance before that first refresh; editing YAML alone does not activate enforcement.

Validation covers domain boundaries, real YAML persistence and corruption, native media event accounting, outages, player gates and a meter/API/store flow spanning two episodes and 15 minutes, reload, supervisor reset and local midnight.
