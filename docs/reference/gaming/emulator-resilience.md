# Emulator Resilience — EmulatorJS Integration Contract

How the arcade keeps a gameplay session working, and why the boot sequence is
shaped the way it is.

## Launch resolution

The menu passes a compound content ID such as `retroarch:n64/mario-kart-64` to
the launch API. `LaunchService` resolves that ID through the application-facing
content catalog and reads the item's `launchIntent`; Android kiosk clients then
execute that intent directly through Fully Kiosk. The composition root must
inject `contentServices.contentCatalog`, not the underlying content registry.
`LaunchService` validates this contract during construction so a wiring error
fails at boot instead of leaving the arcade on a permanent Loading screen.

## The settle barrier

EmulatorJS is vendored (`media/emulation/_engine`, version in `version.json`) and
configured through private, minified internals. Its boot has two distinct phases,
and configuring during the first one silently fails.

`boot.ready` means *loaded*, not *ready to configure*. EmulatorJS then runs its own
start chain, which re-asserts its volume and rebuilds the gamepad slot array:

```js
…setupSettingsMenu(), loadSettings(), updateCheatUI(), updateGamepadLabels(),
this.muted || this.setVolume(this.volume), …
this.started = !0, this.paused = !1, …
```

`started` is set at the very END of that chain, so it is a precise settle barrier.
EmulatorJS guards its own input routing on the same flag (`if(!this.started)return`).

**Everything the app configures must happen after `started === true`, and must be
verified by reading it back.** `bootSettle.js` owns this: it waits for the barrier,
applies each setting, re-reads it, and re-asserts once on mismatch, emitting
`emulator.settle.reasserted` when drift occurs. That event is the early warning
that EmulatorJS behaviour has changed.

## Gamepad slot claiming

EmulatorJS routes gamepad input by looking the pad up in `gamepadSelection`:

```js
const e = this.gamepadSelection.indexOf(pad.id + "_" + pad.index);
if (e < 0) return;
```

That array is filled only by the `GamepadHandler` `"connected"` listener. The handler
polls **synchronously from its own constructor**, while the listener is registered on
the next statement — and `dispatchEvent` is a no-op when no listener is bound. So a
pad that is **already connected when the emulator boots** has its one and only
`connected` event discarded, and every button and axis is dropped for the life of
that instance. It never fires again, because the pad never disconnects.

`engine.claimGamepads()` assigns each connected pad the first free slot. It must run
on **every** boot — each game launch mints a fresh instance — and after the barrier,
because `setupSettingsMenu()` resets `gamepadSelection` to `[]`.

Power-cycling the pad after a game loads is the manual equivalent, and is the
workaround if this ever regresses.

## Volume

`EJS_volume` must carry the user's **persisted** level. EmulatorJS re-asserts
`config.volume` during its start chain, so a hard-coded default overwrites anything
the AudioMixer applied earlier — the game comes up at the wrong volume until the
volume panel is opened, which re-applies and sticks. `bootSettle` verifies the level
afterwards regardless.

## Picture shaders

Two unrelated things are called a shader in the arcade, and a system's manifest
picks whichever it needs.

`shader` is **our** layer: a CSS/canvas pass drawn over the picture. It can tint
and overlay, and nothing more. Two variants exist, both drawing the same pixel
grid on a canvas at integer device-pixel positions:

- `dotmatrix` — grid plus an olive wash. The Game Boy: a DMG's reflective
  screen really was that colour.
- `lcdgrid` — the grid alone, for the Game Boy Color and Advance. Their screens
  were not olive, and tinting a Pokémon Crystal sprite green would misdescribe
  the hardware. The lines are lighter here (9% against the DMG's 20%), because
  without a wash over them the same 20% reads as a mesh laid on the game rather
  than as the gaps between pixels.

Both keep the integer screen-box lock, since a grid only lands correctly when
each game pixel is a whole number of device pixels.

`ejs_shader` is a preset run by the core inside its GL pipeline — either one of
**EmulatorJS's own** or one of **ours**. The Genesis declares `crt-geom.glslp`,
a built-in: real curvature, scanlines, an aperture mask and phosphor bloom. The
Game Boy and Game Boy Color declare `gameboy-harlequin.glslp` and
`gameboy-harlequin-color.glslp`, ours: Harlequin's five-pass dot matrix, the
same shader the Shield runs through RetroArch. Each dark pixel becomes a dot on
a paper background with a light gap around it, a drop shadow beneath it and a
short response-time trail; blank pixels draw nothing, so empty screen is plain
paper. Our canvas grid cannot do any of that, because it never sees the game
pixels — only a shader inside the core can. The files, their GPL-3.0 origin and
the local patches are in `frontend/src/modules/Emulator/shaders/gameboy/README.md`.

A manifest that declares `ejs_shader` keeps its `shader` too: the console
stands the canvas grid and CSS wash down when a core shader is declared, and a
frontend that does not know the preset (EmulatorJS switches shading off for an
unknown name) still has the grid to fall back on.

`engine.applyShader()` writes the preset into the core's filesystem through
`enableShader`. The built-ins are embedded in the vendored `emulator.min.js`
(`EJS_SHADERS`); ours are bundled with the frontend and registered at boot as
`EJS_shaders` (`engineConfig.shaders` → `loadEmulatorJS`). Only the shader
*text* is in the repo. Its PNG textures are bitmaps, so they live on the media
mount under `media/emulation/_engine/` and the console manifest names them:
`presentation.ejs_shader_textures` maps the file name the preset reads to a path
under the engine route (`GET /api/v1/emulator/engine/<path>`). `EmulatorSession`
fetches them before boot and attaches the bytes to the preset. If any texture
fails to arrive, it logs `emulator.shader.textures-missing` (error) and drops the
preset, so the picture runs unfiltered instead of sampling textures that are not
there. The bytes then take a side road: EmulatorJS's resource path `atob()`s a base64 value into a
string and `FS.writeFile` UTF-8-encodes strings, corrupting every byte ≥ 0x80,
so the engine writes texture bytes itself as a `Uint8Array` right before
`enableShader`. Preset parameter overrides (`parameters = "..."` in the
`.glslp`) work in the web core — with one trap, verified 2026-09-25: a
parameter whose `#pragma parameter` appears in more than one pass keeps its
pragma default and drops the override. Declare it in one pass; the uniform is
still set on every pass by name. An unknown name makes EmulatorJS switch
shading off rather than throw — a typo costs the effect, never the game.

It is applied **at the settle barrier**, as one of the verified settings above,
for the same reason the volume is: EJS's start chain runs `loadSettings()`,
which re-applies the stored shader choice through the same
`handleSpecialOptions('shader', …)` path and would overwrite an early call.
`engine.getAppliedShader()` is the read-back — the preset's presence in the
core's filesystem, not the fact that `enableShader` returned.

**An effect that warps the picture has to be `ejs_shader`, and cannot be built
outside the core.** The core's canvas is created with
`preserveDrawingBuffer: false`, so its drawing buffer is cleared the instant the
frame is presented. Sampling it from another WebGL context — the way the
Player's `crtRenderer` upscales a `<video>` — reads back transparent black while
the picture is plainly on screen. The reading is unambiguous: a `drawImage` of
the live canvas yields the single colour `0,0,0,0`. Forcing
`preserveDrawingBuffer: true` onto the context does not rescue it either. Do not
reach for the Player's renderer here; it is built for a `<video>` source, which
has no such barrier.

## Audio context

The live state is at `Module.AL.contexts[<id>].audioCtx.state`. It is only readable
after the barrier. Earlier builds documented `AL.currentCtx.ctx.state`; that path does
not exist in 4.2.3 and silently returns `null`.

A probe that always returns `null` is worse than no probe — it reports a permanent
false "unavailable" that masks a genuine audio failure. If this path breaks again,
fix it or delete the field; do not leave it reporting a constant.

Note the kiosk launch script gates on a working audio sink because a missing sink
makes EmulatorJS freeze on a white screen.

## The EJS contract

`ejsContract.js` declares every internal the app reaches into and asserts it at boot.
A vendored dependency is invisible to `git log` and `npm audit`, so without this an
engine upgrade breaks gameplay with no error anywhere. A missing path raises
`emulator.contract.broken` and a fault state. Keep the list in sync with real usage,
and log the version (`emulator.boot.provenance`).

## Fault handling

`sessionSupervisor.js` watches session invariants and classifies faults by whether
recovery costs the player anything.

| Fault | Detection | Tier | Action |
|---|---|---|---|
| `input-gap` | ≥3 consecutive windows with pings and zero consumes | safe | re-claim pads, silently |
| `audio-suspended` | context state `suspended` | safe | resume the context |
| `contract-broken` | missing internal, or `started` never true | risky | fault state + alert |
| `frozen` | frame counter static while unpaused | risky | prompt a restart |
| `no-pad` | zero pads | info | keyboard hint |

Safe faults self-heal with no UI, bounded to 3 attempts per session so a flapping pad
cannot thrash; exhausting the budget promotes the fault to risky. Risky faults never
auto-act, because recovering them discards unsaved progress.

`no-pad` is deliberately not a fault — the keyboard mapping always works.

## Reading the input telemetry

`emulator.input.summary` carries `browserPings`, `emulatorConsumes`, and `gap`.

**The two counters are not comparable.** `browserPings` counts deduplicated signature
changes; EmulatorJS emits multiple `simulateInput` calls per event (two per axis
change), so consumes routinely exceeds pings in a healthy session. `gap` is
directional only — `pings > 0 && consumes === 0` — and must never become a ratio.

When `gap` is true the event also carries `gamepadSelection` and `padCount`: a
selection of `["","","",""]` with a pad present is the slot-claim failure above.

## Indicator

The chrome indicator shows pad-connected and input-activity separately, plus an amber
healing state and a loud fault state carrying a Fix action. Faults must **appear**;
an earlier design signalled failure by a dot failing to light, and a dead controller
went unnoticed for an entire evening.

## Verification

Three layers, because unit tests alone cannot see this class of bug:

1. **Unit** — `ejsContract`, `bootSettle`, `sessionSupervisor`, all with injected deps.
2. **Runtime** — the contract assert and settle verification run on every real boot.
3. **Smoke** — `tests/live/flow/fitness/emulator-gamepad-routing.runtime.test.mjs`
   drives a real EmulatorJS boot with a synthetic pad installed via `addInitScript`,
   so the pad is present before any page script runs.

Unit tests all mock the EmulatorJS instance, so they pass whether or not the real
integration works. Only the smoke test observes the actual contract. When changing
anything in this document, run it.
