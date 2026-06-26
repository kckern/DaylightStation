# Bug: Piano kiosk MIDI settings (instrument / reverb) respond one turn late

- **Date:** 2026-06-26
- **Area:** Piano kiosk · Web MIDI (BLE) · Sound settings
- **Severity:** Medium (settings work, but every change applies the *previous* selection — confusing/unusable for live voice switching)
- **Status:** App layer ruled out; root cause believed to be below the app (BLE MIDI transmission on the SM-T590 WebView). Better logging added; needs hardware-in-the-loop research.

---

## Symptom

In the Piano kiosk Settings → Sound, changing the **instrument** (onboard device
voice) or the **reverb**/effect level is consistently **one selection behind**:

> Set **Trumpet** → no change. Set **Tuba** → now I hear **Trumpet**. Set **French
> Horn** → now I hear **Tuba**.

i.e. the control sent at step *N* only becomes audible when the control at step
*N+1* is sent. Both **instrument** (Program Change / Bank+PC) and **reverb**
(Control Change) exhibit it, so the cause is a mechanism **shared by all outbound
control messages**, not specific to one setting.

Device: the SM-T590 piano tablet (Fully Kiosk WebView, Chromium), paired to the
electric piano over **Bluetooth MIDI**.

---

## What is RULED OUT (the app command path is correct and immediate)

Traced the full send path; every layer commits the **current** value synchronously
— there is no app-level stale state, queue, debounce, or off-by-one.

1. **UI handlers** pass the freshly-selected value, not a prior render's:
   - `PianoKeyboardPanel.jsx` → `onClick={() => selectVoice(v)}` (the tapped voice `v`).
   - `PianoSettingsSheet.jsx` → `onClick={() => select(s.id)}`, `onChange={(e) => setReverb(Number(e.target.value))}`.
2. **`PianoSoundContext.jsx`** sends the argument immediately, *then* updates React
   state — so the MIDI command uses the new value, not the old one:
   - `selectVoice(voice)` → `sendVoice(voice.pc, voice.bank || 0)` → `setDeviceVoice(voice)`.
   - `setEffect(name, patch)` → `sendControlChange(fx.levelCC, …)` inside the updater.
3. **`PianoMidiContext.jsx`** is a pure pass-through of `useWebMidiBLE` (no wrapper).
4. **`useWebMidiBLE.js`** calls `output.send([...])` directly with the correct bytes
   (`sendProgramChange`, `sendVoice`, `sendControlChange`) — no queue/setTimeout.

So at the moment of the tap, the **correct** MIDI bytes are handed to the Web MIDI
output. The one-turn delay happens **after** `output.send()`.

## Leading hypothesis (below the app)

**BLE MIDI transmission is buffering one control message and only flushing it when
the next `output.send()` is issued** — on this tablet's Chromium/BLE stack the
lone control message is held (BLE MIDI packs messages into timestamped packets;
on a slow/odd connection interval a single message can sit until a companion
arrives). The device therefore always receives the *previous* control.

This matches the symptom exactly: send N is delivered when send N+1 flushes it.

### Secondary hypotheses to keep open
- **Output port not `open`** at send time (`connection: 'pending'`/`'closed'`),
  so `send()` implicitly opens and queues — the new `conn`/`state` log fields
  will show this.
- **Bank Select latching** for non-zero-bank voices (MSB/LSB then PC) interacting
  with the buffering — the per-message logs now show the exact order.
- A device-side quirk (the piano latching PC until the next event) — less likely,
  since reverb (CC) is delayed identically.

---

## Why the logs were no help (and what changed)

`piano.*` telemetry **does** reach the backend (we see `piano.mode-enter`,
`piano.score-*`), but the relevant sends were invisible:
- `midi.out.program` and `midi.out.cc` were logged at **`debug`** (filtered out at
  the normal `info` level), and `sendVoice`/effects produced only a single coarse
  summary line with no timing or transmission state.

**Logging added (`useWebMidiBLE.js`):** a centralized `emitOut()` now sends + logs
every outbound **control** message (program / voice / bank / cc / local-control)
at **`info`** with:
- `seq` — a monotonic counter across all control sends (reveals exact ORDER),
- `t` — `performance.now()` ms (reveals timing between sends),
- `bytes` — the raw hex transmitted,
- `conn` / `state` — `output.connection` / `output.state` at send time (the best
  proxy we have for "did BLE flush or buffer this?", since Web MIDI `send()` is
  fire-and-forget with no completion event).

Notes are intentionally **not** routed through `emitOut` (too high-frequency).

---

## Next experiments (hardware-in-the-loop, with the new logs)

1. **Reproduce + read `seq`/`t`/`conn`:** change Trumpet→Tuba→Horn and capture the
   `midi.out.*` lines. If `conn` is `pending`/`closed`, the port-open path is the
   bug. If `conn:'open'` and each send is timely yet the device is one behind, it's
   transmission/packet buffering.
2. **Force a flush:** after the real control, send a benign follow-up
   (re-send the same message, or an Active Sensing `0xFE`, or a 0-velocity no-op)
   to see if a companion message flushes the buffered one. If it fixes it, the
   real fix is to coalesce-then-flush in `emitOut`.
3. **Explicit timestamp:** try `output.send(bytes, performance.now())` vs the
   current no-timestamp call — some BLE stacks treat these differently.
4. **Do NOTES lag too?** Studio playback uses `out.send` for note on/off. If notes
   are *not* delayed but control messages are, that narrows it to PC/CC handling
   (or running-status) rather than the whole BLE link.
5. **Check the Suzuki MDG-400** docs for PC/Bank apply timing; confirm whether the
   non-zero-bank voices behave differently from bank-0 (GM) voices.

---

## Files

- `frontend/src/modules/Piano/PianoKiosk/useWebMidiBLE.js` — send path + new `emitOut` logging.
- `frontend/src/modules/Piano/PianoKiosk/PianoSoundContext.jsx` — `selectVoice` / `setEffect` / `select`.
- `frontend/src/modules/Piano/PianoKiosk/PianoSettingsSheet.jsx`, `PianoKeyboardPanel.jsx` — the UI.
- `frontend/src/modules/Piano/PianoKiosk/devices/suzukiMdg400.js` — device voice/effect map.
