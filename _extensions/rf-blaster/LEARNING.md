# Learning a 433 MHz remote

`ir-blaster` cannot do this — the ATOM's onboard IR LED is transmit-only, so
that board borrows codes captured elsewhere. A 433 MHz receiver costs about two
dollars, so this board learns its own.

## The workflow

1. **Flash the board** with any valid config (it needs at least one code to
   build; a placeholder is fine — you are about to replace it).

   ```bash
   node firmware/tools/flash.mjs <dataDir>/household/config/rf-blasters.yml disco-light
   ```

2. **Open a listening window** and press the button during it. The endpoint
   blocks for the whole window, so background it or use a second terminal:

   ```bash
   curl -s 'http://rf-disco-light.local/learn?ms=8000' | tee /tmp/learn.json | jq '{repeated, pulse_count, frames_seen}'
   ```

   Press the remote button **repeatedly** — five or six times, held close to the
   receiver. Repetition is not politeness; it is the noise filter (below).

3. **Check `repeated`.** If it is `true`, the same frame length was seen more
   than once and you almost certainly have the real code. If `false`, the
   response carries a `warning` and you should press again — a single unrepeated
   frame is as likely to be a neighbour's doorbell as your remote.

4. **Paste the timings** into `rf-blasters.yml`:

   ```bash
   jq -c '.timings' /tmp/learn.json
   ```

   ```yaml
   codes:
     disco_on:
       timings: [350, 1050, 350, 1050, ...]
       repeats: 8
       gap_us: 10000
   ```

5. **Regenerate, reflash, test:**

   ```bash
   node firmware/tools/flash.mjs <dataDir>/household/config/rf-blasters.yml disco-light
   curl 'http://rf-disco-light.local/send?code=disco_on'
   ```

Repeat per button. Name codes for what they do to the light (`disco_on`,
`disco_off`, `disco_fast`), not for what the remote's button is labelled.

## How the capture works, and why that shapes the advice

A superheterodyne receiver with no transmitter in range does not sit quiet — it
outputs a continuous stream of noise, because its AGC winds gain up until it is
amplifying atmospheric hash. Three things keep that from swamping the capture:

- **A noise floor.** Edges closer together than 80 µs are dropped in the ISR.
  Real OOK bit cells are hundreds of microseconds; most noise is far shorter.
- **A circular buffer.** It keeps overwriting for the whole window, so a button
  pressed at *any* point during it survives — you do not have to press at the
  instant the window opens.
- **A repeat requirement.** The capture is split on long LOW gaps into candidate
  frames, and the frame *length* that occurs most often wins. Random RF hash
  does not produce the same pulse count twice in a row. A real remote does,
  because one press sends the frame several times.

That last point is why "press it repeatedly" is the single most useful thing you
can do. One press may work; five is much more likely to.

## When it fails

| Symptom | Meaning | Try |
|---|---|---|
| `"no frame boundary found"` | no LOW gap longer than `sync_gap_us` | lower `device.sync_gap_us` (2500 → 1500), reflash |
| `"no frame long enough"` | gaps found, but every frame under 16 pulses | usually pure noise — move the remote closer, check the RX antenna |
| `repeated: false` every time | frames are not landing identically | press more times per window; suspect a marginal antenna |
| `overflowed: true` and garbage | noise filled the 2048-edge buffer | shorten the window (`?ms=3000`) and press immediately |
| Learns fine, replay does nothing | the light wants more frames | raise `repeats` (8 → 16) before touching timings |
| Replay works up close only | transmit power / antenna | 17.3 cm wire on the TX, and power it from 5 V not 3.3 V |

## A note on what you are capturing

These remotes are not authenticated. The "code" is a fixed bit pattern set by a
chip in the remote, and replaying it is exactly what the light expects. That is
why this works at all — and also why anything on 433 MHz in the house is worth
thinking about before it controls something that matters. A disco light is a
fine thing to drive this way. A door lock is not.
