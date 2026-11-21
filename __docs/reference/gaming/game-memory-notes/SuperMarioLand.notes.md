# Super Mario Land: RAM research notes

ROM SHA-1 `418203621b887caa090215d97e3f509b79affd3e`. The Dropbox ROM hashes to this
(checked in `probe/levels.py`), and it is the ROM `kaspermeerts/supermarioland` builds
(`rom.sha1`). That repo's README labels it "(World) (Rev A)"; the live sidecar says
"rev 0". The two labels disagree, but the hash is the same, so every address applies.

Sources:
- **disasm**: https://github.com/kaspermeerts/supermarioland (`wram.asm`, `hram.asm`,
  `bank0.asm`, `bank1.asm`, `bank2.asm`, `sound_constants.asm`, `enemies.asm`). Copies are
  saved in this folder.
- **dc**: https://datacrystal.tcrf.net/wiki/Super_Mario_Land/RAM_map (oldid 67954). Saved
  as `datacrystal.json`.
- **pyboy**: headless runs on our ROM, 2026-11-21. Scripts are in `probe/`.
- **RetroAchievements** code notes (https://retroachievements.org/codenotes.php?g=504, 58
  notes) need a login, and the scrape returned none of them. Not used.

Validation: the draft passed `normalizeSidecar` from the repo. All 24 states were kept
with no warnings (`probe/validate.mjs`).

## Every address found

| Addr | Region | Meaning | Source | In draft |
|---|---|---|---|---|
| C000-C09F | WRAM | OAM buffer (sprite table) | disasm, dc | no |
| C0A0-C0A2 | WRAM | Score, 3-byte BCD, little-endian | disasm AddScore, dc | `score` |
| C0A3 | WRAM | Lives earned/lost request: FF = lose one, other = gain one. Lasts one frame (pyboy) | disasm, dc | no, too short |
| C0A4 | WRAM | Mode: 00 playing, 02 menu after game over, 03 title/demo, 39 game over | disasm, pyboy | `game_mode`, `playing`, `game_over` |
| C0A5 | WRAM | wGameOverWindowEnabled | disasm | no (stayed 00 in the game-over run) |
| C0A6 | WRAM | wNumContinues | disasm | `continues` |
| C0A8 | WRAM | wContinueWorldAndLevel. Written only at game over and power-on, so it is **not** a live world/level mirror (pyboy: stayed 0x11 in every level) | disasm, pyboy | no |
| C0A9 | WRAM | Superball time to live (ball in flight) | disasm, dc | no |
| C0AB | WRAM | Level "progress" in columns/2 (enemy spawn cursor) | disasm | no |
| C0AC | WRAM | Death-jump animation counter. Rises 0x0D to 0x26 and is **not reset** after respawn | disasm, dc, pyboy | no |
| C0AD | WRAM | wGameOverTimerExpired | disasm | no |
| C0C0-C0C2 | WRAM | Top score (BCD) | disasm | no |
| C0D3 | WRAM | Starman timer (F8 on pickup, counts down) | disasm, dc, pyboy | `star` |
| C0D7-C0DC | WRAM | Title/demo timers, demo ID | dc | no |
| C0E1 | WRAM | wWinCount, mirror of hWinCount FF9A (hard mode when non-zero) | disasm | `win_count` |
| C0E2 | WRAM | Coin collected this frame. Cleared every frame | disasm, pyboy | no, too short |
| C201/C202 | WRAM | Mario Y/X on screen | dc | no |
| C203 | WRAM | Mario animation index: upper nibble 1 = big; low nibble is the pose; 0A/0B sub, 0C/0D plane; 18 big crouch | disasm, dc, pyboy | `vehicle`, `mario_big` |
| C207/C208/C20A | WRAM | Jump state, Y speed, on-ground | dc | no |
| C600-C607 | WRAM | Backup of the world's animated background tile. C601 differs per world | disasm, pyboy | `world` |
| D007 | WRAM | $60 once Tatanga is dying/defeated; cleared at level init. KillMario also checks it (no death after Tatanga) | disasm | `tatanga_defeated` |
| D100-D19F | WRAM | Enemy table, 10 slots x 16 bytes, type at +0 (`enemies.asm` IDs: 08 King Totomesu, 1A Dragonzamasu, 60 Tatanga) | disasm, dc | no (needs a scan of 10 slots) |
| DA00 | WRAM | Timer subdivision (40 frames) | disasm, dc | no |
| DA01-DA02 | WRAM | Timer BCD: DA01 tens/ones, DA02 hundreds | disasm, dc, pyboy | `timer` |
| DA15 | WRAM | Lives, BCD | disasm, dc, pyboy | `lives` |
| DA17 | WRAM | Bonus-game prize: 01 none (already had flower), 02 1UP, 03 2UP, 04 3UP, 10 flower. Reset only in one init block; whether it resets per bonus game is unclear | disasm bank2 | no |
| DA1B-DA22 | WRAM | Bonus-game timers/flags | disasm | no |
| DA1D | WRAM | Time-out stage: 00, 01 <100, 02 <50, 03 zero, FF time up | disasm, dc, pyboy | `time_warning`, `time_low` |
| DFE0 / DFE1 | WRAM | Square-channel SFX request / currently playing | dc, disasm, pyboy | `sfx` (DFE1) |
| DFE8 / DFE9 | WRAM | Music request / currently playing | dc, disasm, pyboy | `music` etc. (existing) |
| DFF0 / DFF1 | WRAM | Wave SFX request / playing (boss cry only) | dc, disasm | `boss_hit` |
| DFF8 / DFF9 | WRAM | Noise SFX request / playing | dc, disasm | `sfx_noise` |
| FF99 | HRAM | hSuperStatus: 0 small, 1 growing, 2 big, 3 shrinking, 4 i-frames | disasm, dc, pyboy | unreadable: hram |
| FF9A | HRAM | hWinCount (hard mode) | disasm, dc | unreadable: hram (WRAM mirror at C0E1) |
| FF9F | HRAM | Demo/menu flag (0x28 in menu and demo) | disasm, pyboy | unreadable: hram |
| FFA6 | HRAM | hTimer, generic (grow/shrink/respawn countdown) | disasm, dc | unreadable: hram |
| FFB2 | HRAM | hGamePaused | disasm, pyboy | unreadable: hram |
| FFB3 | HRAM | hGameState, full 0x00-0x3D jump table in bank0 (00 play, 03/04 dying, 09-0C pipes, 0D autoscroll, 0E/0F menu, 11 level start, 12-1B bonus game, 1C-21 boss gate, 22-26 fake Daisy, 27-2D Tatanga/Daisy ending, 2E-38 credits, 39/3A game over, 3B/3C time up) | disasm | unreadable: hram |
| FFB4 | HRAM | hWorldAndLevel (BCD-like nibbles, 0x11-0x43) | disasm, pyboy | unreadable: hram |
| FFB5 | HRAM | hSuperballMario (02 = has flower) | disasm, dc | unreadable: hram |
| FFE4 | HRAM | hLevelIndex 0-11 | disasm, pyboy | unreadable: hram |
| FFF9 | HRAM | Underground flag (0A) | live sidecar | unreadable: hram |
| FFFA | HRAM | hCoins, BCD | disasm, dc | unreadable: hram |
| VRAM 9806/9829/982C/9831 | VRAM | HUD digits for lives, coins, world, timer | dc | unreadable: vram |

## Searches for WRAM mirrors of HRAM values

- **World/level (FFB4)**: no WRAM mirror. `probe/levels.py` loaded all 12 levels and
  diffed WRAM. No byte maps one-to-one to the level. C601 (the tile backup) separates the
  4 worlds. The music separates some stages, but not all: 1-1, 1-2 and 3-1 all play
  Birabuto. **The stage within a world cannot be read today.**
- **Game state (FFB3)**: no mirror. C0A4 gives title/demo, playing and game over. Music
  gives death, level clear, bonus game, boss and ending.
- **Power-up (FF99)**: C203 bit 4 tracks big vs small. Superball/flower (FFB5) has no
  WRAM trace.
- **Coins (FFFA)**: no mirror. The game draws the count straight to VRAM. DFE1 == 05 (coin
  sound, about 28 frames) marks each coin. Every 100th coin also gives `lives` +1.
- **Pause (FFB2)**: no WRAM change except stack bytes CFEB-CFFD and the DA00 subdivision
  freezing. Pause is unreadable.

## Conflicts and caveats

- dc says C0A4 "? (0x39 = Game Over)". The disasm and pyboy fill in the rest: it is 03 at
  title/demo, 02 at the menu after game over, and 00 in play.
- dc lists FF9A as "Hard Mode Flag". The disasm calls it hWinCount, mirrored at C0E1.
  These agree.
- dc calls DFF9 the "channel 4 SFX currently playing". The live sidecar's underground flag
  is **FFF9** (HRAM), a different address. Don't mix them up.
- `mario_big` flickers during the grow and shrink animations. In the sub/plane stages the
  bit is frozen at its value from level start. `vehicle` values 0x1C/0x1D (big Mario in
  the plane) are inferred from the code and were not observed.
- `world` (C601) is a byte of tile graphics, not a variable. It is stable across all 12
  levels and through bonus-game entry, and reads 00 on the power-on title.
- `dying` (music 02) covers hits, pits and time-up. After the jingle ends the music goes
  to 00 until respawn. A lost life shows most reliably as `lives` dropping by one (BCD),
  checked on respawn.

## Household trigger ideas

1. **Boss fight**: `music == boss` / `final_boss_fight`. Red pulse or dim lights. Exit on
   `level_complete`. `boss_hit` (DFF1) can flash once per hit.
2. **Star power**: `star` (C0D3 > 0). Rainbow lights for about 16 s, cleaner than the
   star music because it ends exactly when invincibility does.
3. **Lost a life / game over**: `dying` flashes red briefly. `game_over` (C0A4 == 39)
   gives a longer "sad" scene, cleared when the menu returns.
4. **Submarine / airplane stages**: `vehicle == submarine` gives blue/underwater
   lighting; `vehicle == airplane` gives sky blue. More stable than the autoscroll music,
   which switches to boss music at the end of the stage.
5. **Running out of time**: `time_low` (DA1D > 0) gives an amber pulse under 100 s;
   `time_warning == under_50` makes it faster.
6. Optional: `sfx == one_up` chime, `world` scene per kingdom (Birabuto desert, Muda sea,
   Easton stone, Chai bamboo), `mario_big` (debounced) for a brighter room.

## Gaps

- Stage number within a world: not in WRAM.
- Coin count and the pause flag: HRAM only.
- Superball/flower status: HRAM only.
- Exact game state (pipe transitions, gate sequences, credits): HRAM only.
- RetroAchievements notes could not be read without a login.
- Not played to in pyboy, so these rest on the disasm only: a real boss fight, Tatanga's
  defeat (D007), a real bonus game, and hard mode (C0E1).
