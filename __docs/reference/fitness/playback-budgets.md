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

The separate `playback_budget` gate composes with exercise governance and survives manual/remote play, seek and queue advance. Exhaustion displays “Unattended playback limit reached” and “An adult can join to continue.” Queue and workout remain intact; saved playback state records reason `playback_budget`.

GET `/api/v1/fitness/playback-budgets?deviceId=...` reads status. POST `/api/v1/fitness/playback-budgets/observe` submits roster IDs, guest IDs, canonical content ID, stream/sequence and grant settlements. Responses are uncached. Limits and labels come from server configuration; effective parent labels come from the content catalog. Durable daily records live under household `fitness/playback-budgets/YYYY-MM-DD.yml`, schema `fitness.playback-budgets/v1`. Invalid records are errors, never fresh balances. Writes use atomic replacement with file/directory fsync. Request receipts make retries idempotent, and reset generations fence old grants.

Deploy backend and frontend together, then reload the kiosk. A spent-today rollout must seed the existing device/policy balance before that first refresh; editing YAML alone does not activate enforcement.

Validation covers domain boundaries, real YAML persistence and corruption, native media event accounting, outages, player gates and a meter/API/store flow spanning two episodes and 15 minutes, reload, supervisor reset and local midnight.
