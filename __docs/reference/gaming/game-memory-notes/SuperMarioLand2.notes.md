# Super Mario Land 2: 6 Golden Coins: RAM research notes

## Revision

| Field | Value |
|---|---|
| Our ROM SHA-1 | `d11d94fa3c36b9f72e925070b66bb4f16d31001e` |
| MD5 | `4bd6e929ec716a5c7fe7dc684860d551` |
| No-Intro name | Super Mario Land 2 - 6 Golden Coins (USA, Europe) **(Rev 2)**, i.e. V1.2 |
| Header | mask-ROM version `$014C = $02`, cart type `$03` MBC1+RAM+BATTERY, RAM size `$02` = 8 KiB (one bank) |

No-Intro hashes (libretro-database `metadat/no-intro/Nintendo - Game Boy.dat`):
Rev 0 `BBA40853…`, Rev 1 `96E3A314…`, Rev 2 `D11D94FA…`. Our file was copied read-only from
`media/emulation/gb/roms/SuperMarioLand2.gb` and hashed.

Source revisions:
- froggestspirit/marioland2 disassembly: V1.0 (header `db $00 ;Mask Rom Version`).
- mstan/SuperMarioLand2Recomp: V1.0 only (CRC `D5EC24E4`). It notes V1.2 shifts ROM code
  (SetScroll `$2062` to `$2065`). That is a ROM-address shift; RAM variables are unaffected.
- RetroAchievements game 540: our Rev 2 MD5 resolves to game 540 (`dorequest.php?r=gameid`),
  as does Rev 0, so RA's notes are maintained to work across the linked revisions.
- Data Crystal: "USA/Europe versions", revision unstated.

Rev 2 check: I scanned our ROM for absolute `ld a,[nn]` (`FA lo hi`) / `ld [nn],a` (`EA lo hi`)
on every SRAM address below. All are referenced, e.g. `$A216` 29 loads / 11 stores, `$A22C` 15/18,
`$A840` 74/41, `$A469` 3/2 (+2 `ld hl`), `$A468` 57 stores (music request). Two household saves
(two household `super-mario-land-2.srm` saves, copied read-only) decode sensibly at `addr-$A000`:
lives `05`, slot A levels completed `02` (BCD), overworld node `$3C` (Moon Course), song `$06` on
one save. The addresses match Rev 2.

## The blocker: this game lives in cartridge SRAM

SML2 uses the battery SRAM as its main work RAM:
- stack pointer is set to `$A8FF` at boot (disassembly home.asm),
- player/level vars `$A2xx`, sound driver `$A4xx-$A5xx`, block definitions `$A600`, VRAM write
  queue `$AA00`, actor tables `$A880+`, `$AD00`, `$AF00+`,
- the decompressed level block map runs `$B000-$DFFF` (recomp `sml2_map.h`), so WRAM
  `$C000-$DFFF` is only rows 16-47 of the level tile map. That data changes when a block breaks
  or a coin is collected, but it carries no game-state meaning.
- A byte scan of the Rev 2 ROM finds **zero** `FA/EA` absolute accesses to any `$C000-$DFFF`
  address (only a handful of `ld hl,$Cxxx/$Dxxx` hits, which are data-pattern noise or block-map
  pointers).
- The game mode lives in HRAM (`$FF9B`).

So under today's reader (WRAM + Genesis only, `browser/core/addressMap.js`) **no state is readable**.
`SuperMarioLand2.draft.yml` therefore has `states: {}`, with the full SRAM and HRAM maps
commented out, ready to enable.

What would unlock it: the patched core (`_extensions/emulator-checkpoint`) already exports the
libretro SYSTEM_RAM pointer as `daylight_memory_data_v1`. Exporting `RETRO_MEMORY_SAVE_RAM`
the same way would do it. In gambatte that pointer is the live cart-RAM array, which for SML2
*is* the running game state, not a save snapshot. Then add `$A000-$BFFF -> save_ram[addr-0xA000]`
in `addressMap.js`. SML2 has one 8 KiB RAM bank, so no bank switching is involved; the recomp
observed SRAM bank 0 on every frame. HRAM `$FF9B` needs the core's libretro memory map (the
existing core-rebuild item in `__docs/reference/gaming/emulator-game-hooks.md`).
I did not change any of this; it is outside this folder.

## Every address found

Region: S = cart SRAM (unreadable: sram), H = HRAM (unreadable: hram). Sources:
RA = https://retroachievements.org/codenotes.php?g=540 (fetched via `dorequest.php?r=codenotes2&g=540`),
DIS = https://github.com/froggestspirit/marioland2/blob/master/ram.asm,
DC = https://datacrystal.tcrf.net/wiki/Super_Mario_Land_2:_6_Golden_Coins/RAM_map,
REC = https://github.com/mstan/SuperMarioLand2Recomp/blob/master/sml2_map.h (+ sml2_adaptive.c).

| Addr | R | Meaning | Source(s) | Notes |
|---|---|---|---|---|
| `$A042` / `$A092` / `$A0E2` | S | Slot A / B / C levels completed (BCD) | RA | saved copies, stride `$50` |
| `$A200` / `$A201` | S | H / V velocity index | DIS | |
| `$A20E` | S | pipe/door transition in flight | REC | |
| `$A212` | S | (actor) direction, `$FF` = left | REC | |
| `$A214` / `$A215` | S | Mario on ground / in air | DIS | |
| `$A216` | S | Power-up: 00 small, 01 super, 02 bunny, 03 fire (04+ reads as super) | RA, DIS, DC | all agree |
| `$A221` | S | pipe travel direction | DIS | |
| `$A224` | S | (unnamed; gates music restart, set to 2 on Start+Select exit) | DIS code | meaning unconfirmed |
| `$A227-$A22A` | S | Mario X / Y (16-bit) | DIS | |
| `$A22B` | S | Facing: 01 right, FF left | DIS, DC | |
| `$A22C` | S | Lives (BCD) | RA, DC | DC doesn't say BCD; RA does |
| `$A23B` / `$A23C` | S | Mario screen Y / X | DIS | |
| `$A24E` | S | saved ROM bank | REC | |
| `$A254` (2) | S | Level timer (16-bit BCD) | RA, DIS, DC | |
| `$A258` | S | level bank | DIS | |
| `$A262` (2) | S | Coins (16-bit BCD) | RA, DIS, DC | |
| `$A268` | S | spin jump | DIS | |
| `$A269` | S | current level / tileset index | DIS, REC | value table unsourced (one real save reads `$12`) |
| `$A271` (2) | S | Star / invincibility timer | RA (8-bit), DC (2 bytes), DIS code | high byte at `$A271`, low at `$A272` per code |
| `$A27D` | S | bit 7 = level may be exited with Start+Select | DIS code | |
| `$A27E-$A280` | S | BG / OBJ palettes | DIS | |
| `$A287` | S | Gravity: 00 normal, +01 space fly, +02 water, +04 bubble, +08 space low-g | DC, DIS (`sMoonPhysics`) | bitfield |
| `$A28B` | S | `& $F0` = bonus / minigame engine | REC | |
| `$A28D` | S | Enemy kill streak (BCD; star at 99) | RA, DC | |
| `$A292` | S | level's music ID (restored after star) | DIS code | |
| `$A2A0` | S | Checkpoint in current stage: 00 / FF | RA | |
| `$A2A3` | S | Save slot 00/01/02 | RA | |
| `$A2B0` / `$A2B1` | S | scroll Y / X | DIS | |
| `$A2C5` | S | Levels completed, active slot (BCD) | RA | |
| `$A2C8` | S | Autoscroll flag | DIS, DC | |
| `$A2CE` | S | Demo playing: 00 no, 0F demo | RA; DIS calls it `sSoundDisabled` | same effect: demo is muted |
| `$A2D0` | S | Input bitmap | RA | |
| `$A2D5` | S | Ending trigger flag | DC | |
| `$A2E4` | S | Easy mode | RA, DIS | |
| `$A41B` | S | Totaka's Song playing | RA | |
| `$A468` | S | music request (write = start song) | DIS code | 57 stores in ROM |
| `$A469` | S | Current song | DIS | 00 = none, 09 = star music (from code); full ID table not found |
| `$A50D` | S | Fast (hurry-up) music | DIS | |
| `$A600-$A7FF` | S | block definitions | REC | |
| `$A840` | S | Overworld node / course (35-value table) | RA, DC ("Map tile") | |
| `$A848-$A871` | S | Per-course progress: bit 7 normal exit, bit 3 checkpoint, bit 0 secret exit | RA | boss courses below |
| `$A84D` `$A851` `$A856` `$A859` `$A85F` `$A865` | S | Tree / Pumpkin / Macro / Space / Turtle / Mario Zone boss beaten (bit 7) = golden coins | RA | |
| `$A8FF` | S | top of stack | DIS | |
| `$AA00` | S | VRAM write queue | REC | |
| `$B000-$DFFF` | S + WRAM | decompressed level block map | REC | only `$C000-$DFFF` readable; no state meaning |
| `$FF80` / `$FF81` | H | keys held / pressed | DIS | |
| `$FF9B` | H | **Game mode** (20 values, see draft) | RA | playing 04, paused 08, dying 09, overworld 0C, game over 07, boss-coin scene 1F, ending 13 |
| `$FFC0-$FFCB` | H | Mario Y/X, camera Y/X (16-bit) | REC | |

## Conflicts
- `$A271` star timer: RA says 8-bit, DC says 2 bytes. The disassembly decrements `$A272` then
  borrows into `$A271` and tests `$A271` for zero, so it is 16-bit big-endian-ordered and "nonzero
  at `$A271`" is a coarse "star active" test. `gt: 0` on `$A271` could drop a few frames at the
  tail; reading both bytes would be exact.
- `$A2CE`: RA "Demo check" vs DIS `sSoundDisabled`. Compatible (demo runs muted).
- `$A840` value `0x20` and `0x26` are both "Owl Course" in RA: likely two nodes for the same
  course, or one is mislabeled.
- `$A22C`: DC lists lives without BCD; RA marks BCD. RA is the more specific source.

## Trigger ideas (all need SRAM, the first needs HRAM)
1. **Lost a life**: `$A22C` decreases (or `$FF9B` = `09`). Flash red, sad trombone.
2. **Golden coin won**: any of the six boss bytes gains bit 7 (or `$FF9B` = `1F`). Gold light
   sweep. Six bits = progress bar toward Wario's Castle.
3. **Star power**: `$A271` nonzero. Rainbow cycle for its duration.
4. **Underwater / space**: `$A287` bit 1 = blue/aqua room lights (Turtle Zone);
   bits 0/3 = dark purple with twinkle (Space Zone).
5. **Form change**: `$A216` 02 bunny = soft green, 03 fire = orange, 00 small after a hit = dim.
6. Hurry-up: `$A50D` set = lights pulse faster. Attract-mode suppression: ignore everything
   while `$A2CE` = `0F`.
7. Zone theming from `$A840` (Pumpkin Zone courses `0x28-0x2B` = Halloween orange, Mario Zone
   `0x50-0x53`, Wario's Castle `0x5A-0x5C` = red/dark).

## Not found
- **Boss fight active**: no documented flag. Candidates: the boss-course node values in `$A840`
  are not distinguished in RA's table, and the boss music ID in `$A469` is unknown.
- **Music ID table** for `$A469`: only `00` none and `09` star are sourced. GBS rip track order
  was not used (it is not proof of driver IDs).
- **Game mode in SRAM**: none documented; the only mode byte is HRAM `$FF9B`.
- **`$A269` level value table**: not tabulated anywhere I found.
- TCRF's SML2 page was behind a Cloudflare challenge and could not be read; it may list
  revision differences, but the Rev 2 byte scan above covers the RAM question.

## Raw files in this folder
`ra_codenotes2.json` / `ra_codenotes.txt` (all 49 RA notes), `fs_ram.asm`, `fs_home.asm`,
`fs_main.asm`, `fs_research.txt` (disassembly), `ms_*` (recomp), `dc_*.md` (Data Crystal),
`nointro_gb.dat`, `rom/` (read-only copies of the ROM and two saves).
