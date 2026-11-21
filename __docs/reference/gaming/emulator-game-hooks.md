# Emulator game hooks

A game's memory can drive the house. The browser emulator reads named states out
of the game's RAM (Mario is underground, a trainer battle started, the badge
count changed) and the house reacts: the garage lights drop when Mario goes down
a pipe and come back when he climbs out.

Three pieces, each in its own place:

| Piece | Where | Says |
|---|---|---|
| Memory map | `media/emulation/{system}/roms/<rom>.yml`, next to the ROM | which addresses mean what (game knowledge) |
| Bindings | the same sidecar, under `bindings:` | which state triggers which reaction (household choice) |
| Effect registry | `media/emulation/effects.yml` | what a named effect does in Home Assistant |

The console manifest (`gb/gameboy.yml` and the like) lists games and their
presentation. It never holds a memory map: inline `states:` / `bindings:` there
are ignored with `emulator.config.inline_states_ignored`.

## The sidecar

`gb/roms/SuperMarioLand.gb` reads `gb/roms/SuperMarioLand.yml`. A manifest entry
can point elsewhere with `map: roms/other.yml` (relative to the system folder,
and it cannot leave it).

```yaml
states:
  underground:
    addr: 0xDFE9            # CPU address
    type: flag              # flag | enum | count | number
    when: { equals: 0x04 }  # flag: active while this holds (equals/gt/lt/mask/changed)
    hold: [0x0C, 0x02, 0x00]  # raw values that mean "no change"
  music:
    addr: 0xDFE9
    type: enum
    values: { 0x04: underground, 0x07: birabuto }

bindings:
  - on: underground          # `name`, `!name`, or `name == value`
    effect: underground_lights   # scoped: enter when true, exit when false
  - on: music == boss
    do: { animation: red-pulse } # one-shot actions

calibration:
  scratch: [0xC080, 0xDC80]  # see "Locating WRAM" below
```

State fields: `addr` (required), `type`, `size` (1–4 bytes), `endian`, `decode:
bcd`, `when`, `values`, `hold`. The loader (`server/application/gameSidecar.mjs`)
validates every state and binding and drops a malformed one with
`emulator.sidecar.state_invalid` / `binding_invalid`; a binding naming a state
that does not exist is dropped at load, not at play.

`hold` exists for signals that are interrupted. Super Mario Land plays the
Starman theme over the underground theme without Mario leaving the pipe room, so
0x0C must not count as "overground".

Write the evidence into the sidecar's header: the ROM's hash, the sources, and
how the addresses were verified. The Super Mario Land sidecar is the example.

## Effects

A binding with `effect:` enters the effect when its expression becomes true and
exits it when the expression becomes false, when the game is closed
(`session-stop`), or when the page goes away without unmounting (`page-hide`:
reload, crash recovery). The browser sends only the id and the phase:

```
POST /api/v1/emulator/effects/:effectId   { phase: 'enter'|'exit', game, reason }
GET  /api/v1/emulator/effects             current phase per effect (diagnostics)
```

`EmulatorEffectService` looks the id up in `effects.yml` and runs it. An id that
is not in the registry is refused (404); the page never names a Home Assistant
entity.

```yaml
min_interval_ms: 3000
effects:
  underground_lights:
    snapshot: [light.room_overhead, light.room_led_strip_1, light.room_led_strip_2]
    hold_zone_lighting: true
    max_seconds: 600
    enter:
      - service: light.turn_off
        entity_id: light.room_overhead
      - scene: scene.room_led_blue
    exit: []
```

- **snapshot**: captured on enter with `scene.create` (`scene.arcade_restore_<id>`)
  and restored on exit after the exit steps, so exit puts back whatever was
  there.
- **hold_zone_lighting**: the fitness zone LED controller (`AmbientLedAdapter`)
  stands down while the effect is entered (`hold`/`release`) and repaints on the
  next zone sync after.
- **min_interval_ms**: transitions are applied no faster than this, because
  bursts wedge the garage strips' Zigbee radios. Requests inside the window
  coalesce: a dip into a pipe and straight out changes nothing.
- **max_seconds**: an entered effect exits on its own if no exit arrives.
- Steps: `scene:`, `script:` (with optional `variables:`), or `service:
  domain.service` with `entity_id` and optional `data`. An effect with an invalid
  step is dropped whole (`emulator.effects.invalid`).

`effects.yml` is read per request, so edits apply without a restart.

## Locating WRAM

States are read from the emulator's WASM heap at a WRAM base found once per
boot:

- **Protected cores** (a saved game, checkpoint provenance) export the libretro
  system RAM pointer (`daylight_memory_data_v1`); no writes.
- **The stock core** (anonymous "just play") has no export. `WramCalibrator`
  writes a 32-byte signature into WRAM with GameShark cheats, lets frames run,
  and searches the heap. A game that copies the scratch page into OAM every
  frame (Super Mario Land's sprite table at `$C000-$C09F`) makes the signature
  appear twice; `calibration.scratch` lists further addresses on other pages,
  and the calibrator keeps the base every ping agrees on and puts back the bytes
  under the later pings. Scratch addresses must be safe for the game to have
  overwritten for a few frames: say in the sidecar why each one is.
- `waitFrames` reports whether frames actually ran. A stalled boot (no frames,
  e.g. before the audio context starts) throws `ENOFRAMES` and the session
  retries every 5 s, six times (`emulator.calibration.retry-scheduled`), instead
  of reporting a failure.

Only Game Boy WRAM (`$C000-$DFFF`) and Genesis 68k RAM are mapped
(`browser/core/addressMap.js`). HRAM (`$FF80-$FFFE`) is not readable: it is a
separate array in the core. Reading it needs the protected cores to export
libretro's memory map (gambatte publishes HRAM there) — a core rebuild.

## Logs

| Event | Meaning |
|---|---|
| `wram-calibrate-ok` / `wram-calibrate-ambiguous` | calibration result (`pings`) |
| `emulator.statemap.started` | states are being read |
| `emulator.state.change` (debug) | a state changed value |
| `emulator.effect.enter` / `.exit` | the browser asked for an effect |
| `emulator.effects.requested` / `.applied` | the server ran it |
| `emulator.effects.step_failed` | a Home Assistant step failed |
| `fitness.zone_led.held` / `.released` | zone colors standing down |

## Games mapped

| Game | Sidecar | Verified |
|---|---|---|
| Super Mario Land | `gb/roms/SuperMarioLand.yml` — `underground`, `music` → `underground_lights` | 2026-11-20: pipe round trip in PyBoy; browser read → effect path in EmulatorJS |
| Pokémon Red | `gb/roms/PokemonRed.yml` — `battle`, `badges`, `money`, … (no bindings) | not yet against a live session |
