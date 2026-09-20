# Media redesign — batch 3: PLACE.2a aim lifetime evidence packet

## Scope and guardrails

This packet records a narrow proposed closure attempt for `PLACE.2a/AC4` and
`AC5` only. It does not accept `PLACE.2a`, amend the acceptance ledger, alter
product behavior, or claim `AC6` from aim persistence. No physical device
commands or deployment are in scope.

The governing wording is taxonomy `PLACE.2a` (lines 849–855): the aim lasts
through an evening, expires after two idle hours (Q1), pauses only while the
aimed screen is playing content this device sent or is steering (R4), opens
locally after expiry (R7), and every play/line-up action uses it under
`PLAY.1a`. The implementation map calls aim lifetime `LOCAL` plus
`ORIGIN/FLEET`; it separately requires the result chain to reach the actual
player and updated session state.

## Six-criterion evidence inventory

| Criterion | Current evidence | Status and exact gap |
|---|---|---|
| AC1 — change aim in one step wherever shown | The accepted `PLACE.2b` five-case journey proves choices at phone browse and tablet/laptop browse-header only. | Unverified for every displayed aim surface. |
| AC2 — persist across navigation/reload | `JOURNEY-AIM-IDLE` chose Office and reloaded a phone page; the destination line restored Office. | Partial: no all-surface/navigation matrix. |
| AC3 — return local after two idle hours | The same phone journey fast-forwarded two hours and observed the local destination line with no device command. | Partial: only the tested phone flow. |
| AC4 — clock stops for sent/steered playback | `aimLifetime.test.js` proves the pure `exemption:true` calculation; `RemoteSessionController.test.js` proves a remote controller reports a verified steering identity after HTTP, ack, and matching playing state. | Unverified browser journey joining real receiver state to the aim clock. |
| AC5 — reopen after enough idle is local | `JOURNEY-AIM-IDLE` reloads after observed expiry and sees local; provider initializer rejects an expired persisted aim before first layout. | Partial: it is reload, not the specified closed-app/reopen proof. |
| AC6 — every play/line-up uses aim with remote actual outcome | `useContentDispatch.js` routes current aim to `DispatchProvider`'s `/device/:id/load`; its result is currently HTTP `res.ok`, and the existing runtime cast tests stub that response. | Unverified. This is not a Move/handoff dependency. It needs an ordinary-send, receiver-state-correlated outcome journey for each applicable play/line-up surface. |

## Actual junctions and uncertainty

`CastTargetProvider.jsx` owns persisted aim and the two-hour clock. Its
`getAimExemption` accepts only a non-stale fleet `playing` snapshot whose
identity matches `PeekProvider` steering activity. `PeekProvider.jsx` records
that activity only when `RemoteSessionController.js` has both accepted HTTP
and device ack plus a matching receiver `playing` publication. This is the
correct existing owner chain for an AC4 test; setting an active flag directly
would bypass it and is invalid evidence.

Ordinary aimed Play/Add is not handoff: `useContentDispatch.js` calls
`DispatchProvider.dispatchToTarget`, which GETs `/device/:id/load`; the
configured `WebSocketContentAdapter` converts it to a `queue` envelope, and a
browser receiver's `useExternalControl` applies that envelope to its local
controller and acks it. `HANDOFF_UNSUPPORTED` applies only to the separate
`handoff` envelope. The receiver also broadcasts `playback_state`, but the
ordinary dispatch provider currently settles success on the load HTTP result,
not that actual receiver state. The browser receiver foundation test proves a
queue command, receiver mutation, and ack, but it imports Vite source modules
and therefore is not automatically usable against the compiled preview.

Whether AC6's current HTTP-settled dispatch behavior violates the user's
actual-outcome contract is still under Sol's verification; this is a tentative
evidence gap, not a confirmed product bug. If Sol confirms the mismatch, the
candidate integration task is to make ordinary `DispatchProvider`
play/line-up outcomes wait for and correlate the target browser/receiver's
matching `playback_state` (or report an explicit unconfirmed/failure outcome),
then run ordinary UI journeys for each action surface. Whether the existing
real browser-receiver harness can be adapted to the compiled preview is also
unverified; do not infer an F3e/handoff dependency.

## Proposed AC4/AC5 test packet — pending approval

Owner/path: extend only `tests/live/flow/media/media-app-aim-journey.runtime.test.mjs`; product owner under observation is `CastTargetProvider.jsx`. Reuse the existing F2 `media-app-browser-control.runtime.test.mjs` local WebSocket bus/ingress setup so the target receiver emits real ack and `playback_state`; no synthetic fleet/steering state.

1. Two browser pages select the same persisted remote aim through normal UI.
2. The caller enters the existing Remote control surface, issues a normal Play,
   and waits for receiver ack plus its matching `playing` state publication;
   this is the only event that may pause the clock.
3. Advance the browser clock beyond two hours while that state remains real;
   assert the aim remains remote. Stop or make the target non-playing through
   the receiver, then advance only the remaining clock and assert it returns
   local.
4. Close the caller page after a persisted remote aim has become idle; open a
   new page in the same profile and assert the first ordinary destination line
   is local before any Play/Add interaction.

Expected first failure/root cause: the current one-page aim journey has no
live F2 receiver/ingress and never creates `PeekProvider` steering activity,
so it can prove expiry but cannot exercise AC4. The packet first determines
whether the F2 harness's source imports preclude preview use. If it does,
stop after recording that harness blocker rather than changing architecture.

## Verification and decision gates

Run only the focused F2 receiver file and the extended aim journey, serially,
after the packet is approved; reuse the existing unchanged product preview if
its provenance remains valid. One independent reviewer checks that the
receiver state, not an HTTP/ack alone, causes the AC4 exemption and that the
reopen path is not merely reload. At most two repair cycles; then reassess.

No acceptance status changes until a clean committed candidate has the stated
browser evidence. AC1–3/6 remain as recorded above even if AC4/5 close.

## Execution record — AC5 verification journey

The approved one new journey was added to
`tests/live/flow/media/media-app-aim-journey.runtime.test.mjs`. It selects
Office through the normal phone picker, closes the page, reopens the same
browser-profile storage at one millisecond before the boundary (expect Office),
then reopens at one millisecond after it (expect This device). It does not
write `media-app.cast-target`, set an aim flag, or use a device command.

The one permitted focused run was attempted against the supplied unchanged
preview:

```text
BASE_URL=http://127.0.0.1:42167 npx playwright test \
  tests/live/flow/media/media-app-aim-journey.runtime.test.mjs \
  --grep 'a closed app restores' --workers=1 --reporter=line
```

The first attempt failed before product JavaScript loaded: `page.goto` received
`net::ERR_CONNECTION_REFUSED` for the dead supplied preview. This was not a
behavioral RED. A later owner-authorized recovery reused the existing accepted
artifact (no build) from a new detached `1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`
worktree. Its dynamic preview returned exact header
`X-Media-Acceptance-Source: accepted-1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`.

The initial recovered run reached product code and read **This device** at its
pre-expiry reopen. That result is not classified as a product RED: its clock
was allowed to advance while navigation and interaction waited, the test had
an unnecessary `localStorage.clear` init script, and it lacked a context-wide
device-command guard.

The approved one-pass harness correction froze the browser-context clock at
each measured instant and added read-only `Date.now()`/persisted-lease
assertions. It reached the first evidence point and established the exact
start state:

```json
{"now":1789819200000,"aim":{"targetIds":["office-tv"],"activityAt":1789819200000}}
```

The journey then stopped because the test fixture incorrectly expected
`targetIds: ["office"]`; the actual configured ID is `office-tv`. After that
fixture correction, the focused rerun exposed a harness ordering issue: it
read persisted storage immediately after navigation, before the app mounted.
`CastTargetProvider` expires the aim synchronously during initialization and
persists that state from an effect, so this storage read could race the effect.
The test now opens Search and asserts the visible **This device** destination
before reading storage as diagnostic evidence. The user-visible assertion is
unchanged.

The focused corrected run passed against the unchanged accepted preview:

```text
BASE_URL=http://127.0.0.1:44769 npx playwright test \
  tests/live/flow/media/media-app-aim-journey.runtime.test.mjs \
  --grep 'a closed app restores' --workers=1 --reporter=line
1 passed (7.9s)
```

The preview returned
`X-Media-Acceptance-Source: accepted-1bc54a7d9f05732ecc25c1a047f900b4b8f6d6fd`.
There was no build. Earlier close/reopen failures remain inconclusive harness
results, not evidence of a product defect. This single corrected browser case
is AC5 evidence only; it changes no acceptance status. The static source
observation remains: `CastTargetProvider` reads/writes
`media-app.cast-target` and synchronously expires only when
`now - activityAt >= AIM_IDLE_MS`; it has no intentional new-page clear branch.

## AC4 disposition

`media-app-browser-control.runtime.test.mjs` does use two real browser pages,
the branch WebSocket ingress, receiver `useExternalControl`, a queue-command
ack and target-side queue mutation. Its target command is `queue:add`, and it
explicitly asserts `target.locator('video')` has count zero. It therefore does
not mount or observe an actual playing Player for the existing F2 journey.
That cannot establish the R4 premise that the aimed screen is playing content
this device sent or is steering. AC4 is parked at this concrete host-integration
gap; no speculative receiver harness or production change was made.
