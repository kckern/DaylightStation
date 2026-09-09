# Home Line handoff: calls connect and hold; echo is instrumented, not yet fixed

**Date:** 2026-09-08 (evening)
**Prod:** `1cad76820`, container healthy, living-room TV reloaded onto it
**Bug record:** `docs/_wip/bugs/2026-09-08-homeline-negotiation-deadlock-and-silent-failure.md`
**Plan:** `docs/_wip/plans/2026-09-08-homeline-negotiation-deadlock-fix.md`
**Reference:** `docs/reference/call/README.md` (updated), `_extensions/audio-bridge/DESIGN.md` (AEC section updated)

---

## State at handoff

| Item | Status |
|---|---|
| Phone → `livingroom-tv` call connects | **Working.** Verified on the owner's own phone at 04:29 UTC: `negotiating → verifying_media → connected` in 21s, lease `active`. |
| Connected call survives past 3 minutes | **Working.** Headless call held 4 minutes with no disconnect. |
| Phone self-view mirrored | Shipped (`cff30b0da`). |
| Caller hears their own voice back from the TV | **Open.** Cause narrowed and a fix deployed, but **not yet verified by a real call**. See §3. |
| TV WebSocket reconnects every 30–60s | Open, undiagnosed (bug doc §5.3). Did not block any call tonight. |
| No TURN server | Open, latent (bug doc §6). LAN calls connect on host candidates. |

Do not place test calls while the household is asleep: the headless harness
wakes the living-room TV and plays a tone through it (ducked to level 5, still
audible).

---

## 1. What was actually broken (three defects, in the order they were found)

The bug doc's original §5.1 ("the single offer gets dropped by a closed
socket") was wrong about *where* the offer was lost. Evidence that settled it:
the log store held **zero** `homeline.signaling.offer` in 7 days, while the
phone's heartbeats on the same socket kept arriving. The phone never sent an
offer at all.

1. **The controller's unmount cleanup killed the offer it was building**
   (`e76ff6a3a`). `clearWork` in `useCallController.js` was keyed on the `peer`
   object's identity and the cleanup effect was keyed on `clearWork`. Building
   the offer calls `setRemoteStream` inside `createPC`, which gives
   `useWebRTCPeer` a new `peer` identity, which re-ran the cleanup mid
   `createOffer`: aborted work, cleared every timer, closed the half-built
   `RTCPeerConnection`. **Chrome never settles a pending `createOffer` on a
   closed connection**, so there was no error, no rejection, and no timeout —
   just `pc-created` then silence. Fix: read the peer through a ref so
   `clearWork` is identity-stable and the cleanup runs on unmount only. The ICE
   recovery ladder had been relying on the accidental timer wipe and now guards
   itself against re-arming. `pc-reset` is logged at info so a mid-offer close
   can never hide again. Regression test: *"keeps its timers and peer when the
   peer object changes identity mid-negotiation"* (fails on the old code).

2. **The TV never sent `media-verified`** (`9e8ce4502`). `CallLeaseService`
   marks a lease `active` only after `media-verified` from **both** roles. The
   phone sent it; nothing on the TV ever did. Every call therefore stayed inside
   its 180s setup window, expired, revoked its credentials, and
   `device.restored` yanked the TV back to its previous content mid-call. A
   headless call connected at 19s and was cut at 185s. Fix: `VideoCall.jsx`
   runs `useMediaHealth` once ICE is connected and sends one `media-verified`
   per verified result per peer revision. The phone's report is deduplicated
   the same way (it was re-sending every 2s).

3. **The first-round changes** (`765a3910b`) remain correct and shipped: re-offer
   on every fresh `waiting` until an answer is accepted; `NEGOTIATE_TIMEOUT` at
   20s climbing the same one-soft-recovery ladder as `WAIT_TIMEOUT`, ending in
   `recovery_prompt` with reason `tv_no_answer` and honest copy; every dropped
   ephemeral send logged as `signaling.dropped`. They were simply behind defect 1.

Healthy trace shape now (all in the log store): `homeline.signaling.offer`
~10s after reserve → `homeline.signaling.answer` + ICE `connected` ~1s later →
`media-verified` from phone **and** tv at +8s → `homeline.signaling.media-verified`
with `state: active`. If a call is abandoned without hangup,
`lease.participant-stale` ends it ~15s after heartbeats stop and
`device.restored` puts the TV back.

---

## 2. How to verify a call without a phone

Playwright chromium on the prod host with fake media. The script lived in the
session scratchpad as `headless-call.mjs`; it is ~30 lines and worth
recreating under `tests/` if it gets used again:

```js
import pkg from '/opt/Code/DaylightStation/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ args: ['--no-sandbox','--ignore-certificate-errors',
  '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport:{width:420,height:860}, ignoreHTTPSErrors:true,
  permissions:['camera','microphone'] });
const p = await ctx.newPage();
await p.goto('https://daylightlocal.kckern.net/call', { waitUntil:'networkidle' });
await p.locator('button.call-app__target').filter({ hasText: /living/i }).first().click();
// poll p.locator('.call-app').innerText() for state copy; the connected layout reads empty
```

Known gap: the script's "End call" locator never matched the connected layout,
so its calls ended by `participant-stale`, not hangup. A rerun inside that ~15s
window gets "This TV is already in a call."

---

## 3. The echo (open)

**Symptom.** The caller, in a different room, hears their own voice ~0.3s
late. That is the TV speaker → Shield USB mic → audio bridge → phone loop; the
Shield has no hardware AEC for USB audio (`_extensions/audio-bridge/DESIGN.md`).
Both mitigations were engaged on the owner's call: `volume-duck` to level 5 and
`bridge-aec-active` with Speex (`filterLength: 24000` = 500ms window at 48kHz,
`frameSize: 480`). The phone's self-view is already `muted`; that is not it.

**Ruled out.** Mic gain (×3) is applied *after* the canceller
(`worklet → gainNode → compressor`), so the >1.0 peaks in `bridge-volume` are
post-gain and do not clip the canceller's input. Speex preprocessor uses default
residual suppression (only `SET_ECHO_STATE` is configured).

**Leading cause (fixed in `9826cf6b2`, unverified).** In
`useNativeAudioBridge.js` the mic and reference rings are consumed in lockstep
**by sample count** — there are no timestamps and no resynchronisation. The
reference was tapped by a `ScriptProcessorNode`, whose callback runs on the
**main thread**; Chrome drops it 512 samples at a time whenever that thread is
busy (React render, video decode). Each drop shifts the reference 10.7ms behind
the echo it should predict. Starting from a real echo delay of a few hundred ms,
a few dozen drops push the lag negative, and no adaptive filter can subtract an
echo that arrives before its reference. Fix: the tap is now an `AudioWorklet`
(audio thread, never skips; port messages queue rather than drop) that watches
`currentFrame` and zero-fills any underrun, logged as `aec-ref-gap`.

**Instrumentation (`9826cf6b2` + `1cad76820`).** While a call is up, the
canceller logs `bridge-aec-diag` every 5s of far-end speech and at least every
15s regardless:

| Field | Meaning |
|---|---|
| `erleDb` | dB the canceller removed while the far end was audible. Healthy Speex: 15–25. ~0: never converged. `null`: far end silent. |
| `lagMs` | cross-correlation of decimated mic vs reference. **Positive** = reference leads the echo (causal; cancellable while < 500ms). **Negative** = reference has fallen behind; uncancellable until realigned. |
| `peakCorr` | confidence of `lagMs` (0–1). Below ~0.2, ignore the lag. |
| `refEnergy`, `gateGain` | what the −14dB suppression gate saw and did. |

**Next step is one real call, 30s of talking, then:**

```bash
curl -s {env.log_store_url}/select/logsql/query \
  -d 'query=(_msg:bridge-aec-diag OR _msg:aec-ref-gap) AND _time:30m'
```

Decision table:

- `erleDb` 15+ and the caller no longer hears themselves → done; leave the
  diag in, it costs ~2ms per 5s.
- `erleDb` ≈ 0, `lagMs` positive and < 500 → alignment was never the problem.
  Next suspect: **Speex at 48kHz**. It is designed for 8/16kHz; convergence at
  48k with 24000 taps is slow and the preprocessor's suppression bands assume
  speech-rate sampling. Run the canceller at 16kHz (decimate mic+ref ÷3, 8000
  taps for the same 500ms, interpolate back) — speech-band audio loses nothing.
- `erleDb` ≈ 0, `lagMs` > 500 → the echo path is longer than the window: raise
  `aec.filter_length` in `devices.yml` (`input.audio_bridge.aec`) or add a fixed
  reference delay line so the window starts nearer the echo.
- `lagMs` **negative** → the reference is still losing samples, or the mic is.
  Check `aec-ref-gap` first. If gaps are zero, the mic path (APK → WS, raw PCM,
  no sequence numbers) is dropping; that needs a frame counter in the bridge
  protocol to prove and a realignment step (drop/pad mic samples) to fix.
- The blunt fallback if all else fails: make the suppression gate a real
  half-duplex gate (`GATE_FLOOR` 0.2 → ~0.02 with a ~300ms hangover). It kills
  the caller's self-echo at the cost of the TV side being unable to interrupt.

**Note on the headless harness for this:** the fake microphone's tone sat below
the original diag threshold, so the one headless call after the worklet change
produced no `bridge-aec-diag` line. The threshold is now −40 dBFS mean-square
and a line fires every 15s regardless, but that build has not had a call yet.

---

## 4. Things that will bite the next person

- **Root-owned files and directories.** A root-running PII hook periodically
  re-owns tracked files (`CallApp.jsx`, `CallApp.test.jsx`, `VideoCall.jsx`,
  `docs/reference/call/README.md` tonight) and left this very directory
  root-owned and not group-writable. Files: `cp` out, `rm -f`, `cp` back, then
  edit. This directory was recreated; the root-owned original is parked at
  `docs/_wip/_deleteme_hand-offs-rootowned/` (could not be moved into
  `_deleteme/`) for the owner to delete.
- **The deploy gate does not know about Home Line.** `scripts/deploy-gate.sh`
  checks fitness, the Player and the Portal. A redeploy during a call drops it.
  Tonight's deploys added a manual check for `homeline.*` activity in the last
  2 minutes before stopping the container; that belongs in the gate proper.
- **`loadStartURL` on the Shield does not clear the WebView cache.** It was
  enough tonight (the TV's DOM showed the new `index-*.js` each time), but if a
  TV ever seems to run old code after a reload, `clearCache` first.
- **Frontend `debug` logs never reach the store.** `status-change` on the TV is
  debug. Absence proves nothing.
- The pre-existing `useCallController` ICE-ladder test was passing *because of*
  defect 1 (the accidental timer wipe hid a double-arm). It now passes on
  merit with the in-flight guard; do not "simplify" the guard away.

---

## 5. Commits tonight, oldest first

| Commit | What |
|---|---|
| `765a3910b` | re-offer until answered; `NEGOTIATE_TIMEOUT`; `signaling.dropped`; honest recovery copy |
| `e76ff6a3a` | controller cleanup no longer kills the offer (the real deadlock); ICE ladder guard; `pc-reset` log |
| `9e8ce4502` | TV sends `media-verified`; phone dedupes it; calls outlive the 180s setup window |
| `cff30b0da` | phone self-view mirrored |
| `9826cf6b2` | AEC reference tap → AudioWorklet with gap zero-fill; `bridge-aec-diag` (ERLE, lag) |
| `1cad76820` | diag threshold −40 dBFS, reports at least every 15s |

All on `main`, all built with `scripts/build-daylight.sh`, all deployed behind a
clear gate except the first, which used an owner-authorised override during an
active fitness session.
