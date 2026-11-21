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
    type: flag              # flag | enum | count (= set bits, for badge/dex bitfields) | number (the value; use with decode: bcd for lives/coins)
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

## Memory regions

Addresses are the game's own. The reader (`addressMap.js`) routes each to a region
of the patched core: `ram` (SYSTEM_RAM: Game Boy `$C000-$DFFF`, Genesis `$FF0000+`,
GBA EWRAM), `sram` (cartridge save RAM `$A000-$BFFF`, libretro memory type 0), and
`mapped` regions (Game Boy HRAM `$FF80-$FFFE`, GBA IWRAM) found through the core's
published memory map. A state in a region the running core does not export is
warned once (`state-read-failed`, code `EUNAVAILABLE`) and skipped; the rest keep
sampling. Super Mario Land 2 and Wario Land keep nearly all state in `sram`.

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

- **Every game with states boots the patched core** (`emulation/_engine/cores/
  <core>-<variant>.protected-v1.data`, built by `_extensions/emulator-checkpoint`).
  It exports the libretro system RAM pointer (`daylight_memory_data_v1`); no
  writes, no frames, all systems (`emulator.calibration.native`, `source`).
  - A saved game boots it with checkpoint provenance and save protection on.
  - Anonymous "just play" boots it with protection off (`memoryCore` in
    `loadEmulatorJS`): it plays, resets, and save-states like the stock core.
    EJS asset databases are off for that boot so a cached stock core of the
    same name cannot stand in. Verified headless on 2026-11-21 for Super Mario
    Land, Pokémon Crystal (title `wMusicID` `0x01`, menu `0x54`) and Sonic
    (`game_mode` SEGA → title → level, lives 3).
  - If the patched core fails to boot (`emulator.memory-core.boot-failed`),
    the session plays on the stock core and falls back to the cheat ping below.
  - A game without states always boots the stock core.
- **Fallback, stock core only:** `WramCalibrator`
  writes a 32-byte signature into WRAM with GameShark cheats, lets frames run,
  and searches the heap. A game that copies the scratch page into OAM every
  frame (Super Mario Land's sprite table at `$C000-$C09F`) makes the signature
  appear twice; `calibration.scratch` lists further addresses on other pages,
  and the calibrator keeps the base every ping agrees on and puts back the bytes
  under the later pings. Scratch addresses must be safe for the game to have
  overwritten for a few frames: say in the sidecar why each one is.
- The cheat ping writes Game Boy GameShark codes, so it runs only for `gb` and
  `gbc`. On the stock core, any other system (Genesis) has no state map
  (`emulator.calibration.skipped`, `no-memory-export`).
- `calibration: { cheat: false }` forbids the ping for one game: use it when no
  32 safe bytes are known. Pokémon Crystal's `$C000-$C0FF` is its stack and
  Pokémon Red's `$C080` is audio state, so writing there can crash or garble
  the game. Such a game has states only on the patched core.
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
| `emulator.calibration.native` | RAM read through the patched core's export (`source`: `checkpoint-core` / `memory-core`) |
| `emulator.memory-core.boot-failed` | patched core would not boot; playing on the stock core |
| `wram-calibrate-ok` / `wram-calibrate-ambiguous` | cheat-ping fallback result (`pings`) |
| `emulator.statemap.started` | states are being read |
| `emulator.state.change` (debug) | a state changed value |
| `emulator.effect.enter` / `.exit` | the browser asked for an effect |
| `emulator.effects.requested` / `.applied` | the server ran it |
| `emulator.effects.step_failed` | a Home Assistant step failed |
| `fitness.zone_led.held` / `.released` | zone colors standing down |

## Games mapped

Per-game research (sources, every address including unreadable ones, trigger ideas, gaps) is in `game-memory-notes/<Game>.notes.md`. Drafts were gathered 2026-11-21 from disassemblies and wikis; only Super Mario Land (and parts of Crystal, Sonic, Red) have been watched live.

| Game | Sidecar | Readable today |
|---|---|---|
| Super Mario Land | `gb/roms/SuperMarioLand.yml`: 24 states; `underground` → `underground_lights` | yes (WRAM); world/level/coins/pause are HRAM-only |
| Pokémon Red | `gb/roms/PokemonRed.yml`: 36 states (HP now big-endian) | yes; not yet against a live session |
| Pokémon Yellow | `gbc/roms/PokemonYellow.yml`: 38 states, addresses from pokeyellow.sym | yes; not live-checked |
| Pokémon Crystal | `gbc/roms/PokemonCrystal.yml`: 43 states | WRAM banks 0-1 only; bank 2-7 offsets in notes |
| Sonic the Hedgehog (REV00) | `genesis/roms/SonicTheHedgehog.yml`: 40 states | yes; `music` fingerprint needs a live check |
| Super Mario Land 2 (V1.2) | `gb/roms/SuperMarioLand2.yml`: no states, map commented | no: state is in cartridge SRAM; game mode in HRAM |
| Wario Land | `gb/roms/WarioLand.yml`: `sram_states:` inactive | no: state is in cartridge SRAM |
| Mario Kart Super Circuit | `gba/roms/MarioKartSuperCircuit.yml`: `pending_states:` inactive | no: reader has no GBA support (IWRAM/EWRAM) |

Two reader changes would unlock the rest: export libretro `RETRO_MEMORY_SAVE_RAM` from the patched core (SML2, Wario Land) and a GBA address map (Mario Kart). HRAM needs the memory-map export noted above.
