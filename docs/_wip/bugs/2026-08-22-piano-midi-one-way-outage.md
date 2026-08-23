# Piano MIDI went one-way: notes in, nothing out

**Date:** 2026-08-22
**Status:** root-caused, fixed, regression-covered
**Symptom:** keys played on the piano lit up on the kiosk screen, but instrument
changes, the on-screen keyboard, and MIDI-file playback produced nothing at the piano.
**Reported as:** "it's like it's one way only. And the diagnostics are not helpful."

---

## Why the diagnostics weren't helpful

They said the link was healthy, and they believed it. Every layer the kiosk could see
reported success:

- `pbctl status` → `CONNECTED`, uptime climbing, 1 reconnect.
- JamCorder `/api/midi-io/settings/get` → `bleToDin: true`, `filtering: false` — the
  two settings the runbooks tell you to check were both correct.
- The frontend's own `midiHealth.out` → **up**.
- `midi.out.voice` / `midi.out.cc` events were being emitted on schedule.

The link was dead anyway. Nothing in the system asked the only question that mattered:
*did anything arrive at the other end?*

---

## Measurement

The JamCorder counts what it receives per transport. That counter is outside the
browser's control, which makes it the one trustworthy witness.

| Probe | Broken | After fix |
|---|---|---|
| JamCorder `ble.in` — messages received **from the tablet** | **0** | 26 → 72 |
| JamCorder `ble.usbOut` / `ble.uartOut` — forwarded **to the piano** | 0 / 0 | 72 / 72 |
| JamCorder `usb.in` — received **from the piano** (the working direction) | 387 | 6052 |
| Android `dumpsys midi` → `mInputPortOpen` | **false** | **true** |
| Android `dumpsys midi` → `DeviceConnection count` | 1 | 2 |
| Frontend `midi.out.*` | `conn:pending, state:disconnected` | `conn:open, state:connected` |

`mInputPortOpen=[false]` is decisive: in Android MIDI a device's *input* port is the one
you WRITE to. Nothing on the tablet had a write handle open, so no browser send could
reach the piano regardless of what Web MIDI reported.

Inbound was unaffected because it takes a completely different route — piano → USB →
JamCorder → BLE → **APK** → WebSocket → browser. Only OUT depends on the browser holding
a live Web MIDI handle, which is exactly why the failure was asymmetric.

---

## Root cause

`useWebMidiBLE.js`, the output watchdog. It had two self-heal branches and **both were
guarded on conditions that were false during the real failure**:

```js
// 1. Re-bind when the output is missing or disconnected…
if (!isPortConnected(outputRef.current) && accessRef.current) bindOutput(accessRef.current);
// 2. Bridge mode: re-hold the input if the port dropped.
if (!inputRef.current && accessRef.current) holdInputForOutput(accessRef.current);
```

- Branch 1 did fire — but `bindOutput` picks `outs.find(isPortConnected) || outs[0]`.
  When every enumerated port is dead it falls back to `outs[0]`, **re-binding the same
  corpse every 2 seconds, forever.** There was no rung above "re-bind within the current
  access object".
- Branch 2 never fired. It only re-holds when the ref is `null`. The stale port *object*
  survived the flap; only its native connection died. A surviving reference is not proof
  of a surviving handle.

`emitOut` was already logging `conn` — the single field that showed the truth — on every
send. Nothing ever read it.

Trigger was most likely the JamCorder's own scheduled reboot (`autoRebootTime: 180`),
which tore down BLE and, being on DHCP, also moved the device off its documented IP.

---

## Fix

`resetLink()` — null the refs, re-run `connect()`, re-acquire MIDI access — already
existed and does precisely what a page reload does. **It was wired only to a manual
button in the OperatorDrawer.** Nothing called it automatically.

1. New `isPortDelivering(port)` = `isPortConnected(port) && connection !== 'pending'`.
   `state` describes the DEVICE; `connection` describes OUR handle. `'closed'` is not a
   fault — it is the normal pre-send state, since Web MIDI opens implicitly on `send()`.
2. The watchdog judges OUT on that predicate, and re-holds the input whenever the held
   port stops delivering rather than only when the ref is null.
3. **New escalation rung:** after 3 consecutive failing ticks (~6s), call `resetLink()`
   — rate-limited to once per 5 minutes, logged at warn as `midi.out-recover-reset`.

The cooldown is the important half. Unbounded recovery churn is what got
`holdInputForOutput` reverted once before (`fda53ea6b`) for flapping the APK's BLE link,
so the ceiling is deliberate: a permanently dead port (JamCorder unplugged) costs at
most 12 re-acquires an hour instead of 1800.

Covered by `useWebMidiBLE.outputRecover.test.js` (escalates / doesn't escalate when
healthy / rate-limits). Full `PianoKiosk` suite: 241 files, 2640 tests, green.

---

## Detection

`node cli/piano-midi-e2e.cli.mjs` — reads both halves of the path from opposite ends
(JamCorder counters + Android `dumpsys midi`), prints a per-direction verdict, exits
non-zero when unhealthy so it can be scheduled. `--send` forces traffic and proves
`ble.in` climbs; `--json` for machines.

Against today's fault it would have printed `android write port open: ✗` and
`hub RECEIVED from tablet: 0` — the two numbers nobody was looking at.

---

## Also found

- **The JamCorder is on DHCP and had drifted** from the documented `10.0.0.244` to
  `10.0.0.243`, breaking the nightly MIDI harvest and every runbook URL. Config updated
  in `devices.yml`, `piano/config.yml`, `bootstrap.mjs`, and the reference docs.
  **It should be given a DHCP reservation** — it self-reboots every 180 minutes, and
  each reboot is a chance to move again.
- **Effects (reverb/chorus) have no send path at all** — a separate, pre-existing gap.
  See `docs/_wip/plans/2026-08-22-piano-effects-sysex-options.md`.

---

## Lesson

The health signal was derived from the same subsystem it was meant to police. `port.state`
is the browser's opinion of the browser's own link, and it was wrong for hours without
ever being contradicted. The fix that matters long-term is not the watchdog rung — it is
having a witness at the far end (`ble.in`) that the failing component cannot influence.
