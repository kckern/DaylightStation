# Wario Land: Super Mario Land 3 — RAM research notes

ROM: SHA-1 `ae65800302438e37a99e623a71d1c954d73c843e`, CRC32 `40BE3889`, 512 KiB.
No-Intro "Wario Land - Super Mario Land 3 (World)" v1.0, the only revision (confirmed via
romhacking.net hack pages citing this SHA-1 against No-Intro GB/GBC 20210227, and vimm.net
vault 3479). The Kak2X/wl disassembly builds bit-perfect against the GoodGB "(W) [!]" file,
which is the same dump. All addresses apply to our ROM.

## Headline: nothing useful is readable today

Wario Land uses its 8 KiB battery SRAM ($A000-$BFFF) as work RAM. `src/memory.asm` puts
every game variable there (save slots $A000, actors $A100-$A3FF, sound $A600, map $A790,
active save $A800, main state $A820-$A9FF, scroll buffers, OAM mirror $AF00, actor layout
$B000-$BFFF). WRAM $C000-$DFFF is `wLevelLayout`, the decompressed 256x32 block map, which
fills all of WRAM. A handful of "static screen" variables (title, heart/coin bonus games,
ending) are UNIONed over $C0A0-$C0F4 and hold level-layout bytes the rest of the time.

Datacrystal agrees: "A100-DFFF: cleared every time the game is started", "C000-DFFF: all
indexes of 16x16 blocks".

Our reader maps GB only to $C000-$DFFF (`__app_modules/games/emulator/browser/core/addressMap.js`),
so `states:` in the draft is empty. The full draft sits under `sram_states:` in the same schema.

**Unblocker:** read cartridge RAM. libretro exposes it as `RETRO_MEMORY_SAVE_RAM`; in
gambatte/mGBA/SameBoy that buffer is the live cart RAM the CPU writes, not a periodic copy.
It would need its own calibrated base in HEAPU8 (the WRAM calibrator's write-a-signature
approach would corrupt game state here, so a read-only fingerprint is needed, e.g. the save-slot
header magic `0x19643957` at $A000/$A040/$A080 per datacrystal) and an `sram` region
$A000-$BFFF in addressMap.js. Then rename `sram_states:` to `states:`.

A second hazard for this game even for WRAM: calibration `scratch` must sit in $C000-$DFFF,
and all of it is live level layout. A 32-byte signature write there would change level blocks.
Do not enable write-calibration for Wario Land.

## Sources

- [disasm] https://github.com/Kak2X/wl (master, pushed 2026-07-19). `src/memory.asm` (each
  symbol has an `EQU $xxxx` comment), `src/constants.asm`, `src/bank00.asm` (GetCourseNum),
  `src/bank01.asm` (BCD maths), `src/bank04.asm` (sound driver). Mirrors/forks:
  Lrs121/warioland, wxuefei/SuperMarioLand3_WarioLand (not checked separately).
- [dc] https://datacrystal.tcrf.net/wiki/Wario_Land:_Super_Mario_Land_3/RAM_map (oldid 66022).
- RetroAchievements game 739 (https://retroachievements.org/game/739): code notes page is behind
  a Cloudflare bot check; not read. RA addresses for GB use the CPU map, so its notes would also
  be SRAM addresses.
- Raw downloads in `raw/` (memory.asm, constants.asm, bank*.asm, dc.json).

## Address table (all `unreadable: sram` unless marked)

| Addr | Symbol | Meaning | Source |
|---|---|---|---|
| $A000-$A0BF | sSave1..3 (+Bak) | 3 save slots ×2 copies, $20 each; header magic 0x19643957 | disasm, dc |
| $A0C0-$A0C2 | sSave?Checksum | slot checksums | disasm, dc |
| $A0C3 | sLastSave | last pipe entered on save select | disasm, dc |
| $A0C4 | sDemoId | demo index 0-6 | disasm, dc |
| $A100-$A11F | (current actor) | working copy of actor slot | disasm, dc |
| $A200-$A2FF | actor slots | 8 × 32 bytes; +0 status 0/1/2 | dc, disasm |
| $A375 | | end-of-level event: 01 boss defeated, 02 big ! switch, 03 final boss defeated | dc only |
| $A376 | | level exit skull door: 00 closed, 01 rising, 02 open | dc only |
| $A377 | | treasure skull door open | dc only |
| $A382 | | treasure ID during warp (00-0F) | dc only |
| $A3B6 | | huge block gives coin (00) / heart (01) | dc only |
| $A5E0-$A5F5 | sMap*Blink | per-world lists of courses still holding treasure | disasm, dc |
| $A600/$A601 | sSFX1Set/sSFX1 | SFX channel 1 request/current | disasm, dc |
| $A607/$A608 | sSFX2Set/sSFX2 | SFX2 (coin, time-up beeps, hurry-up) | disasm |
| $A615/$A616 | sSFX4Set/sSFX4 | SFX4 (dash, ground pound, water enter $0C / exit $0D, jet $0F) | disasm, dc |
| $A61C | sBGMSet | BGM request (0 = no change, $FF = stop) | disasm, dc |
| $A61D | sBGM | **current BGM** (0 = stopped) | disasm, dc |
| $A790-$A7F5 | map vars | map screen state | disasm |
| $A793 | sMapWorldClear | world-clear sequence | disasm |
| $A794 | sMapLevelClear | path-reveal after a course clear active | disasm |
| $A795-$A79B | sMap*CompletionLast | completion copies | disasm, dc |
| $A79C | sMapId | **map mode** (overworld / which world map / cutscene) | disasm, dc |
| $A79E | sMapLevelId | Wario's position on current world map (LVL id) | disasm, dc |
| $A79F | sMapWorldId | position on Kitchen Island overworld | disasm, dc |
| $A7A0 | sMapLevelIdSel | selected course | disasm |
| $A7D1/$A7D2, $A7D9/$A7DE, $A7E5 | | map scroll, Wario map X/Y, map anim | dc |
| $A804 | sLevelId | **current level slot** (LVL_* enum) | disasm, dc |
| $A805-$A807 | sTotalCoins | bank, BCD, big-endian | disasm, dc |
| $A808 | sHearts | BCD | disasm, dc |
| $A809 | sLives | BCD | disasm, dc |
| $A80A | sPlPower | 0 small, 1 normal (garlic), 2 bull, 3 jet, 4 dragon | disasm, dc |
| $A80B,$A80C,$A810-$A814 | sMap*Completion | per-world course bitmask, top bit = world flag | disasm, dc |
| $A80D | sLevelsCleared | BCD count | disasm, dc |
| $A80E-$A80F | sTreasures | 15-bit treasure bitmask | disasm, dc |
| $A815/$A816 | sCheckpoint / sCheckpointLevelId | checkpoint skull hit | disasm, dc |
| $A817 | sGameCompleted | | disasm, dc |
| $A8C3 | sGameMode | **game mode** (GM_*) | disasm |
| $A8C4 | sSubMode | per-mode submode | disasm, dc |
| $A8C6 | sDemoMode | attract demo | disasm, dc |
| $A8C7 | sDebugMode | hidden debug mode | disasm, dc |
| $A905 | sTimer | global frame timer | disasm, dc |
| $A908 | sPaused | | disasm, dc |
| $A911-$A914 | sPlY / sPlX | Wario position (16-bit each) | disasm, dc |
| $A91A | sPlAction | **player action** (swim $04, dead $09, treasure-get $12 …) | disasm |
| $A93D | sPlInvincibleTimer | star invincibility | disasm |
| $A93E | sPlCrouch | | disasm, dc |
| $A94B | sPlPostHitInvulnTimer | post-hit blink (dc: "invincibility countdown") | disasm, dc |
| $A94C | sPlHatSwitchTimer | power-up hat-change sequence running | disasm |
| $A956 | sSmallWario | 1 = small | disasm, dc |
| $A958 | sPlPowerSet | power-up being switched to | disasm |
| $A95C | sHurryUpBGM | | disasm |
| $A964-$A965 | sLevelTime | course timer, BCD | disasm, dc |
| $A97A-$A97B | sLevelCoins | course coins, BCD | disasm, dc |
| $A985 | sTimeUp | dying → time-up screen | disasm |
| $A986 | sGameOver | dying → game-over screen | disasm |
| $A995 | sBossRoom | **boss room** | disasm |
| $A998 | sPlJetDashTimer | jet hat flying | disasm, dc |
| $A9A4 | sPlDragonHatActive | dragon flame | disasm |
| $A9A8 | sPauseActors | | disasm, dc |
| $A9DD | sTreasureId | treasure just collected | disasm |
| $A9E4 | sCourseNum | displayed course number, BCD 01-40 | disasm |
| $A9E5 | sAltLevelClear | alternate-exit clear | disasm |
| $A9E8 | sPlIce | on ice | disasm |
| $A9EB | sHurryUp | 0/1/2 | disasm |
| $A9FA | sStatusEdit | debug status editor | disasm |
| $AC87 | | previous Wario status before hit | dc only |
| $C000-$DFFF | wLevelLayout | **readable** but it is level block data | disasm, dc |
| $C0A0 | wStaticMode | **readable**; submode of title / heart bonus / coin bonus / ending. Level data otherwise | disasm |
| $C0D7 | wHeartBonusRoundNum | readable; heart-bonus round, only valid in that minigame | disasm |
| $C0EA | wCoinBonusRound | readable; coin-bonus round (dc says $C03A, looks like a typo; disasm EQU is $C0EA) | disasm vs dc |
| $C0F3/$C0F4 | wCoinBonusItemTypeR/L | readable; bucket contents (0 moneybag, 1 ten-ton weight) | disasm, dc |
| $FF80/$FF81 | hJoyKeys/hJoyNewKeys | input; unreadable: hram | disasm, dc |

None of the readable WRAM bytes can be used safely: nothing readable tells us *when* the
static-screen union is active, so $C0A0 and friends read random level blocks during play.

## Conflicts between sources

- $C0EA (disasm) vs $C03A (dc) for coin-bonus round: trust disasm (bit-perfect build).
- dc names power 03 "eagle"; disasm `PL_POW_JET`. Same thing (the jet hat has an eagle emblem).
- dc describes $A94B as the invincibility timer; disasm splits $A93D (star invincibility) from
  $A94B (post-hit invulnerability). Trust disasm.
- dc "A79C current world" list stops at $12; disasm adds cutscene/ending modes $13-$21.

## Trigger ideas (all need SRAM reads)

1. **Boss fight starts**: `music_track` → $11 (boss) or $28 (final boss), or `boss_room` rising
   edge. Dim the lights red; `bossclear` ($12) brings them back.
2. **Lost a life**: `dying` (sPlAction == $09) rising edge, or `music_track` → $08 lifelost;
   `game_mode` → $08 game over for the bigger version.
3. **Treasure found**: `game_mode` → $0B treasure_get, or `treasures` value changes. Gold flash.
4. **Entered water**: `underwater` (sPlAction == $04); also `music_track` $03 water. Blue lights.
5. **Hurry up**: `hurry_up` → 1 (timer low): pulse lights. **Power-up change**: `wario_power`
   (bull/jet/dragon colours), **world colour** from `level_id`/`map_screen`, course clear via
   `game_mode` $04, invincibility star via `music_track` $06.

Gate everything on `demo_mode == 0` so the attract demo does not fire triggers.

## What I could not find / did not verify

- RetroAchievements code notes (Cloudflare-blocked).
- Bit order of `sTreasures` (which bit is treasure A..O). The TREASURE_* IDs are $01-$0F in
  constants.asm; a value-change trigger avoids needing the mapping.
- A boss HP byte. Boss actors keep their state in actor slots ($A200+) with no named HP field.
- No CPU-address-only verification in a running emulator was done; everything is from the
  disassembly's EQU comments and datacrystal.
