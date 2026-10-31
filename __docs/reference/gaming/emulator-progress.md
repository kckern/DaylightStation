# Arcade save progress

How the browser arcade loads, saves, restarts and recovers a player's game.
Code: `__app_modules/games/emulator/browser/core/` (`resumeSource.js`,
`checkpointSession.js`, `recoveryChoices.js`) and
`__app_modules/games/emulator/browser/EmulatorConsole.jsx`; server contract in
`__app_modules/games/emulator/server/` (unchanged by this behaviour).

## The rule above all others

**An in-game save the player made is never deleted and never overwritten by
anything they didn't do in the game.**

A game has two kinds of progress:

| | In-game save (battery, `.srm`) | Snapshot (save state) |
|---|---|---|
| Made by | the player choosing SAVE in the game | the console, every `autosaveSeconds` (15s) and on exit |
| Means | "I meant to keep this" | "where the machine happened to be" |
| Loaded by | the game's own Continue | the console, restoring the exact moment |

A snapshot carries **its own copy of the in-game save from when it was
taken**. Loading an old snapshot puts that older in-game save back, and the
next capture would then store it over the real one. So a battery game never
loads a snapshot over an existing in-game save unless the player picks it.

## Save modes (`save_mode` in the system manifest)

| Mode | Resumes from | Notes |
|---|---|---|
| `none` | nothing | always boots fresh |
| `state` | the snapshot | no in-game save exists for these games |
| `battery` | the in-game save | the snapshot only when no in-game save exists yet (a legacy `auto.state` with no `.srm`) |

`resumeSource(saveMode, record)` is the single rule; launch, restore
verification and recovery all use it.

## Launching

A battery game whose current save has both artifacts **from one console
capture** (`kind: 'save'`) opens a launch card:

- **Continue your save** (default, focused): boots the ROM with the in-game
  save; the game's title screen Continue loads it.
- **Back to where you stopped · {time}**: restores the snapshot.

No card when only one exists, after a reset, on a recovery hand-off, or on a
Restart. A migrated (`baseline`), `import`ed or `recover`ed pair is never
offered as "where you stopped": its snapshot may be older than its in-game
save. `resumeChoices()` decides this.

## Saving

The console captures snapshot + in-game save every 15s and on exit, as one
revision. Captures are not deduplicated: games such as Pokémon Crystal use
cartridge SRAM as scratch during play, so the captured bytes change between
real saves and their hash says nothing about whether the player saved. The
game's own checksummed save slots decide what Continue loads.

## Restart vs Erase (the power switch)

For a battery game with a player:

- **Keep playing** (focused) closes the dialog.
- **Restart game** stores the latest capture, then reboots to the title screen
  from the in-game save. No reset is written.
- **Erase saved game** opens a second confirmation, "Erase {name}'s saved
  game?". Only **Erase and start new** writes a `reset` record. The erased
  save is not deleted: it stays in the history and in recovery.

State games and anonymous games keep the single **Start over**.

## Recovery

For a battery game the recovery dialog lists **one entry per distinct in-game
save** ("In-game save N · {date it first appeared}") and "New game started"
for resets, newest first, instead of one entry per autosave
(`recoveryChoices()`). Restoring an entry restores that in-game save.

## Legacy files

`media/emulation/{system}/saves/{user}/{game}.srm` and
`states/{user}/{game}/auto.state` are migrated once, on first launch, into a
`baseline` revision under `_checkpoints/`. After that the save resource
prefers the checkpoint artifact and the legacy files are inert. They are not
deleted.

## Restoring an in-game save by hand (operator)

When a player needs a specific in-game save back and the recovery dialog is
not an option, publish it as a battery-only head. With no snapshot, the next
launch boots straight to that save.

1. `GET /api/v1/emulator/checkpoint/{system}/{game}?user={user}&variant=wasm`
   gives `head.revision` and `provenance`.
2. Take the wanted battery bytes from
   `_checkpoints/{system}/{user}/{game}/blobs/{hash}.bin` (read via the
   container), base64-encoded.
3. `POST /api/v1/emulator/checkpoint/{system}/{game}/import?user={user}` with
   `{ expectedRevision: head.revision, captureId: <uuid>, sessionId: <uuid>,
   sequence: 0, provenance, snapshot: null, battery: <base64> }`.

Do it while the game is closed: a running console's next autosave would
conflict with the new head. Confirm with `emulator.progress.restored`, whose
`artifactHash` should equal the imported battery hash.
