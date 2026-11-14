# Piano voice patches and the Patch finder

The Sound sheet lists voices from a device catalog (`PianoKiosk/devices/suzukiMdg400.js`).
That catalog was transcribed from the older Suzuki **Micro Grand** owner's manual
(128 GM voices + 10 Asian folk voices on bank 1). The MDG-400 is a later engine
(reviews put it at 122 sounds), so a catalog address can play a different sound
than the keyboard's own panel button. No MDG-400 manual was found online.

Rather than trust the catalog, each piano keeps a small correction table, and the
maintenance drawer has a tool to fill it in by ear.

## Data

Per-piano config (`pianos.<id>.voicePatches`, or top level for the single
default piano), written by the Patch finder through `pianoConfigWrite.js`:

```yaml
voicePatches:
  "0:0": { msb: 0, lsb: 3, pc: 0, name: Acoustic Grand }
```

- **Key** is the voice's *catalog* identity `pc:bank`, the same key presets use
  (`usePianoPreset.soundVoiceKey`). A saved favourite keeps meaning the same
  voice after its address is corrected.
- **Value** is the address actually sent: Bank Select MSB (CC 0), LSB (CC 32),
  Program Change. `name` is for humans reading the YAML.
- Malformed rows are dropped (`normalizePatches`), never guessed.
- Saving the catalog address removes the row.

`PianoSoundContext` resolves `addressFor(voice, voicePatches)` on every send
(`selectVoice`, `resync`), so the Sound sheet, presets, Producer and the chrome
chip all pick the correction up with no changes of their own. The
`piano.device.voice` log carries `sent` and `patched`.

## Patch finder (Maintenance → Patch finder)

1. Pick a voice on the left. Its current address (saved patch, else catalog) is
   sent and an audition phrase plays.
2. Nudge Bank MSB / Bank LSB / Program with the arrows, or tap a number to type
   it (0–127). **Prev / Next** step the program. Each change is sent at once and,
   with *Play after each change*, played.
3. **Save as <voice>** writes the row and reloads config.

Auditions never change the selected voice: leaving the finder calls `resync()`,
which puts the real voice back.

### From the keyboard

The right column shows voice changes the keyboard itself sends when someone
presses a panel button, with **Try** to load that address. On the tablet,
Chromium holds no Web MIDI (released when the bridge owns OUT, see
`useWebMidiBLE.relinquishWebMidi`) and the bridge WebSocket only carries notes,
so this polls the bridge's raw read-port tap, `GET http://localhost:8770/midi/tap`
(last 64 chunks, `BridgeCore.tapMidiIn`). Polling opens nothing on the BLE link.
Repeats from the piano's echo and the BLE flush re-send are collapsed
(`bridgeMidiTap.dedupeChanges`). Off the tablet the column says it needs the bridge.

Whether the MDG-400 transmits panel voice changes at all is unverified. If
nothing shows up, use the steppers.

## Log events

`piano.patch-finder.{mounted,try,audition,adopt,save,save-failed,unmounted}`,
`piano.midi-tap.{start,voice-change,poll-failed,recovered,stop,unavailable}`.

## Forensics outside the app

The Jamcorder keeps a daily `.mid` of all MIDI traffic. Its LAN API lists
recordings with `POST /api/library/list/assets` and serves them at
`GET /sdcard<midiPath>`. It's useful for checking after the fact what the
keyboard sent; it merges ports, so the channel alone doesn't identify the sender.
