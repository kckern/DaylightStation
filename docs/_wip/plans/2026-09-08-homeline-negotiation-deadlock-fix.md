# Home Line: end the `negotiating` deadlock and make the phone tell the truth

**Date:** 2026-09-08
**Fixes:** `docs/_wip/bugs/2026-09-08-homeline-negotiation-deadlock-and-silent-failure.md` §5.1, §5.2, and proposal 3 (silent signalling drops)
**Out of scope:** §5.3 (TV WebSocket flap — diagnosed separately, see Task 7), §6 (TURN), the two UI asks (mirrored self-view, pull-to-refresh on the phone preview)
**Status:** Tasks 1–6 shipped in `765a3910b`; live verification then exposed
the real offer-killer (the controller's peer-identity cleanup, see the bug
doc's §5 correction), fixed in the follow-up commit

---

## What we are changing, in one paragraph

The phone may send exactly one SDP offer per peer revision, and that offer goes
out through a send path that drops silently when the socket is not open. When
the single offer is lost, the TV re-sends `waiting` and the phone refuses to
re-offer, so both sides sit in `negotiating` forever. `negotiating` is the only
setup state with no timer, so the phone says "Connecting securely…" until the
caller gives up, and the log then files the failure as `user_cancelled`. Three
changes fix this: re-offer on any fresh `waiting` while no answer has been
accepted, arm a 20-second `NEGOTIATE_TIMEOUT` that reuses the existing soft
recovery ladder, and log every dropped signalling message.

Everything the server needs is already in place. `CallLeaseService.#validatePhase`
accepts a second `offer` at the same revision as long as the TV has sent
`waiting` and the sequence number increases, so the phone-side fix needs no
backend change.

---

## Design decisions (made, not open)

1. **Re-offer rule.** On `waiting`, the phone re-offers unless the peer is
   `connected` **or** an answer has already been accepted for the current
   revision. The second guard matters because the TV's socket flaps every
   30–60s (§5.3): a `waiting` that arrives after a valid answer, while ICE is
   still `connecting`, must not tear down a connection that is about to
   succeed. If that ICE attempt later fails, the existing ladder in
   `useCallController` (5s grace, ICE restart, rebuild on a new revision)
   already handles it. The `offeredRevisionRef` guard is removed; a
   `answeredRevisionRef` replaces it.

2. **Timeout reuses soft recovery.** `NEGOTIATE_TIMEOUT` reduces exactly like
   `WAIT_TIMEOUT`: first time, `waking` with `reason: 'soft_recovery'` (the
   server reloads the TV call app; the TV re-joins, sends `waiting`, the phone
   re-offers under rule 1); second time, `recovery_prompt` with
   `reason: 'tv_no_answer'`. No new recovery mechanism. 20 seconds is long
   enough for a Shield to answer an offer and short enough that a person is
   still holding the phone.

3. **Dropped sends are warnings, not silent.** `useCallSignaling.send` logs
   `signaling.dropped` at `warn` (it reaches the log store; `debug` does not)
   with the message type, revision and sequence. The return value is also
   surfaced so a dropped `offer` shows up in the timeout's diagnostic log line.

4. **The TV needs no code change.** `handleOffer` already builds a fresh peer
   connection per offer and closes the previous one. Stale ICE candidates from
   the phone's abandoned peer at the same revision may be flushed into the new
   one; `addIceCandidate` tolerates that, and the case is logged at
   `ice-candidate-flush-failed` if it does not.

---

## Tasks

### Task 1 — Re-offer on every fresh `waiting` until an answer lands

**File:** `frontend/src/modules/Input/hooks/useCallSignaling.js`

- Replace `offeredRevisionRef` with `answeredRevisionRef` (initial `null`).
- Reset it to `null` in the session effect and in `rebuild` (new revision).
  Remove the reset in the `homeline-authorize-ack` handler and rewrite that
  comment: the ack no longer gates offers; it only restarts the handshake.
- `waiting` branch becomes:
  ```js
  else if (message.type === 'waiting' && role === 'phone'
    && peerRef.current.connectionState !== 'connected'
    && answeredRevisionRef.current !== revisionRef.current) {
    onEventRef.current?.({ type: 'tv-ready' });
    const offer = await peerRef.current.createOffer({ revision: revisionRef.current });
    const delivered = send('offer', { description: offer });
    loggerRef.current.info('signaling.offer', { callId: session.callId, peerRevision: revisionRef.current, delivered });
  }
  ```
- `answer` branch sets `answeredRevisionRef.current = message.revision` after
  `handleAnswer` resolves.
- `tv-ready` is emitted on every re-offer. That is safe: `TV_READY` is only
  allowed from `probing`/`waiting_tv`, so a re-offer during `negotiating` is a
  no-op for the reducer, and after a soft recovery it is exactly the event
  that moves `waiting_tv → negotiating` again.

**Tests:** `frontend/src/modules/Input/hooks/useCallSignaling.test.jsx`
- Keep the existing five tests green (the reauth test already expects a
  second offer; it still passes because no answer was accepted).
- Add: *a repeated `waiting` with no answer re-offers on the same revision* —
  send `waiting` twice, expect `createOffer` called twice and both offers to
  carry `revision: 0` with increasing `sequence`.
- Add: *a `waiting` after an accepted answer does not re-offer while ICE is
  still connecting* — `waiting`, `answer`, `waiting` with `connectionState:
  'connecting'`; expect `createOffer` called once.
- Add: *a rebuild clears the answered guard* — after `answer`, call `rebuild()`,
  then `waiting`; expect a new offer on revision 1.

### Task 2 — `NEGOTIATE_TIMEOUT` in the reducer

**File:** `frontend/src/Apps/call/callMachine.js`

- `negotiating: ['ANSWERED', 'ICE_INTERRUPTED', 'NEGOTIATE_TIMEOUT', 'FAIL', 'CANCEL']`
- Reducer case:
  ```js
  case 'NEGOTIATE_TIMEOUT': return state.recoveryCount < 1
    ? { ...state, value: 'waking', recoveryCount: 1, reason: 'soft_recovery' }
    : { ...state, value: 'recovery_prompt', reason: 'tv_no_answer' };
  ```
  Share the body with `WAIT_TIMEOUT` via a small helper so the two ladders
  cannot drift; only the terminal reason differs (`tv_unavailable` vs
  `tv_no_answer`).

**Tests:** `frontend/src/Apps/call/callMachine.test.js`
- Add to the illegal-transition sweep: `NEGOTIATE_TIMEOUT` is ignored outside
  `negotiating`.
- Add: *a stalled negotiation gets one soft recovery, then prompts with
  `tv_no_answer`* — mirror the existing `WAIT_TIMEOUT` test.
- Add: *a wait timeout already spent the soft recovery, so a negotiate
  timeout prompts immediately* — `WAIT_TIMEOUT` then `NEGOTIATE_TIMEOUT`;
  the shared `recoveryCount` means only one automatic reload per attempt.

### Task 3 — Arm the timer and log what stalled

**File:** `frontend/src/Apps/call/useCallController.js`

- New effect beside the `waiting_tv` one:
  ```js
  useEffect(() => {
    if (state.value !== 'negotiating') return undefined;
    const attemptId = state.attemptId;
    const timers = timersRef.current;
    const timer = later(() => {
      loggerRef.current.warn('call.negotiate.timeout', {
        callId: state.callId, attemptId, peerRevision: state.peerRevision,
        connectionState: peerConnectionRef.current?.connectionState ?? null,
        recoveryCount: state.recoveryCount,
      });
      dispatch({ type: 'NEGOTIATE_TIMEOUT', attemptId });
    }, 20_000);
    return () => { clearTimeout(timer); timers.delete(timer); };
  }, [later, peerConnectionRef, state.attemptId, state.callId, state.peerRevision, state.recoveryCount, state.value]);
  ```
- Name the constant `NEGOTIATE_TIMEOUT_MS = 20_000` next to the wait values
  so the numbers are in one place.

**Tests:** `frontend/src/Apps/call/useCallController.test.jsx`
- Add: *a negotiation that never answers reloads the TV once, then prompts* —
  `startToProbe`, `tv-ready`, advance 20s, expect `waking` and a POST to
  `/recover` with `level: 'soft'`; resolve it, dispatch `WAKE_OK` via the api
  mock, `tv-ready` again, advance 20s, expect `recovery_prompt` with
  `reason: 'tv_no_answer'`.
- Add: *an answer inside the window cancels the timer* — `tv-ready`,
  `answered` at 5s, advance 30s, state is still `verifying_media` and no
  `/recover` call was made.
- Add: *hanging up inside the window is filed as the caller's reason* — this
  already holds, but assert it so the `user_cancelled` label stays a real
  user decision and never a timeout.

### Task 4 — Stop dropping signalling silently

**File:** `frontend/src/modules/Input/hooks/useCallSignaling.js`

- Wrap the `sendEphemeral` call: when it returns `false`, log
  `signaling.dropped` at `warn` with `{ callId, type, peerRevision, sequence }`
  and still return `false`. The heartbeat is the one type excluded from the
  warning (it fires every 5s and a closed socket would spam the store); log it
  with `logger.sampled` at 2/min instead.
- The `restartIce` and `rebuild` paths get the same treatment for free because
  they go through `send`.

**Test:** `useCallSignaling.test.jsx` — make `sendEphemeral` return `false`
for one call and assert the warn logger was called with `type: 'offer'`. The
mocked logger currently only exposes `info`/`warn`; add `sampled`.

### Task 5 — Say something true on the phone

**File:** `frontend/src/Apps/CallApp.jsx`

- `recovery_prompt` notice becomes reason-aware:
  - `tv_no_answer` → "The TV joined but never answered the call."
  - `tv_unavailable` → "The TV did not join the call."
  - otherwise the existing "The TV or media link did not recover."
- The `waking` copy for `soft_recovery` already reads "Reloading the call
  app…", which is accurate for the negotiate path too. No change.
- No new controls: "Restart TV…", "Try a new call" and "End call" already
  cover the choices.

### Task 6 — Docs and the bug record

- `docs/reference/call/README.md`
  - Phone state machine: note that `negotiating` is bounded by a 20-second
    timer that spends the same single automatic soft recovery as `waiting_tv`.
  - Signaling and recovery: replace the one-offer-per-revision wording with
    the rule from decision 1, and state that dropped signalling is logged as
    `signaling.dropped`.
  - Triage: add a block after the `waiting_tv` one — *"When the phone reaches
    `negotiating` and leaves it with `tv_no_answer`"* with the queries from
    the verification section below.
- Bug doc: flip §5.1, §5.2 and proposal 3 to FIXED with the commit hash; leave
  §5.3 and §6 OPEN.
- `docs/_wip/refactors/` is not touched; this is a bug fix, not a refactor.

### Task 7 — Diagnose the TV WebSocket flap (separate, after deploy)

Not part of the fix commit. After the call connects at least once, pull the
TV's reconnect cadence and compare it with the known ~60s protocol-ping flap
(the app `heartbeat` is the fix there, and the call hook already sends one
every 5s on the call topic, but the base socket may not):

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=context.component:VideoCall AND _time:2h' -d 'limit=200'
```

Outcome goes in its own bug doc if it is anything other than the known flap.

---

## Order of work

1. Task 2 (reducer) and Task 1 (signaling) first — both are pure and fully
   unit-testable with no server.
2. Task 3, then Task 4, then Task 5.
3. Run the unit gate: `npm run test:unit:vitest -- frontend/src/Apps/call frontend/src/modules/Input/hooks`
   and capture the real exit code, not the tail of the output.
4. Task 6 docs in the same commit.
5. Build, gate, deploy, reload the living-room TV (FKB `loadStartURL`, see
   `CLAUDE.local.md`), then verify live.

---

## Verification (live, after deploy)

Place a call from the phone to `livingroom-tv`.

**Expected on the happy path**
- Phone: `pc-created`, then `signaling.offer` with `delivered: true`.
- TV: `pc-created` (`context.component:useWebRTCPeer` on the TV side). Its
  presence is the single line that proves the deadlock is gone.
- Phone: `call.state.transition` through `negotiating → verifying_media →
  connected`.

**Forced failure path**
- Mid-negotiation, kill the TV's page (`fkb.cli.mjs` `loadUrl about:blank`,
  or pull the Shield's network for a moment).
- Within 20s the phone logs `call.negotiate.timeout` and transitions to
  `waking` with `soft_recovery`; the TV reloads, sends `waiting`, and the
  phone re-offers on the same revision. If the TV never comes back, a second
  20s window ends in `recovery_prompt` with `reason: 'tv_no_answer'` and the
  phone reads "The TV joined but never answered the call."
- The record for that attempt ends with `recovery_cancelled` or
  `retry_requested`, never `user_cancelled`.

**Queries**
```bash
# The phone's view of the attempt
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=context.app:homeline-phone AND _time:1h' -d 'limit=200'

# Did any signalling get dropped?
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:"signaling.dropped" AND _time:1h'

# Timeouts and what the peer was doing at the time
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:"call.negotiate.timeout" AND _time:24h'

# The server's view
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=_msg:homeline.* AND _time:1h' -d 'limit=200'
```

Remember `status-change` on the TV is `debug` and never reaches the store.

---

## Risks

- **Re-offer during a healthy ICE attempt.** Mitigated by the answered guard
  (decision 1). If a real call still shows a re-offer between `answer` and
  `connected`, the guard is wrong and the fix is to also skip re-offers while
  `connectionState === 'connecting'`.
- **Soft recovery reloads the TV while a person is in the room.** This already
  happens for `WAIT_TIMEOUT`, and a stalled call is worse than a reload. The
  single shared `recoveryCount` guarantees at most one automatic reload per
  attempt across both timeouts.
- **TURN is still absent.** Once the handshake completes, a LAN with client
  isolation or mDNS-only candidates will fail at ICE, not at signalling. That
  shows up as `ICE_INTERRUPTED` then `recovery_exhausted`, and is the next
  bug doc, not this one.
