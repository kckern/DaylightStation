# Mario Kart: Super Circuit (GBA) RAM research notes

ROM: SHA-1 `9d327c030c3e2d9007990518594f70c3340ac56f`, 4 MiB, CRC32 `ed316e37`, MD5 starts `784a036f`.
Identity: **Mario Kart - Super Circuit (USA)**, AGB-AMKE-USA, revision 0
(MAME softlist / No-Intro: https://data.spludlow.co.uk/mame/software/gba/mariokrtu). Every source below
targets USA/AMKE, so no revision mismatch.

## Sources

| Tag | Source | Notes |
|---|---|---|
| RA | RetroAchievements code notes, game 533. Web pages are behind Cloudflare; the client endpoint `https://retroachievements.org/dorequest.php?r=codenotes2&g=533` answered with a RetroArch user agent. Raw: `raw/ra_codenotes.json`, `raw/ra_codenotes.txt` (178 notes). | RA GBA addressing: RA `0x000000-0x007FFF` = IWRAM `0x03000000+`; RA `0x008000-0x047FFF` = EWRAM `0x02000000 + (RA - 0x8000)`. Achievement logic and rich presence need a login (401), not pulled. |
| DC | https://datacrystal.tcrf.net/wiki/Mario_Kart:_Super_Circuit/RAM_map (raw `raw/1434ed.json`) | "Addresses are for USA version." |
| DEC | jellees/mksc decomp, commit `3df8932105` (https://github.com/jellees/mksc). Raw headers in `raw/jellees/`. | Builds our exact SHA-1 (per mstan/MarioKartSuperCircuitRecomp `symbols/README.md`). Early-stage: few named RAM symbols, but `gSceneState = 0x03002E20` and its struct layout are enough to anchor several RA/DC addresses. |
| ADH | ShoshinFauteux/GBAdhoc `gpsp/tools/gbamirror/multigame/gen_msc.py` and `gpsp/docs/GBA-LINK-MIRROR.md` section 16.7 (raw `raw/gbadhoc_*`) | RAM found by dumps on AMKE; used to drive karts closed-loop through a real lap on two emulators, so these addresses are runtime-proven. |
| XOL | XOlifreX/mksc-decompilation (older, abandoned 2021) | Only EWRAM symbols; nothing game-state related. |

Not reached: gamehacking.org (scrape timed out), TASVideos (no MKSC resource page found), RA rich-presence script (login).

## Memory layout anchors (from DEC)

- IWRAM `0x03002E20` `gSceneState` (scene_state_t):
  - `+0x00` `sceneMainFunc` (u32 function pointer) -> drafted as `scene`.
  - `+0x14` `field14`, incremented every VBlank. RA independently notes `0x03002E34` as "[32 Bit] Frame Timer". This match confirms the base address.
  - `+0x20` `raceState` (race_state_t) = `0x03002E40`:
    - `+0x14` `nrCheckpoints` (u16) = `0x03002E54`
    - `+0x6E0` frame heap descriptor (head/ptr/size) = `0x03003520`; the heap itself is EWRAM `gMainFrmHeap` `0x0202A400`, 0x8000 bytes (menus and title data are allocated here, so EWRAM state in that range is not fixed).
    - `+0x7DA` `curRaceStateUnknown` (u16) = `0x0300361A`; bit `0x100` = "GP mode", bit `0x800` = "MG mode" (collision code skips checkpoint sorting in MG mode, so MG is probably Battle). Not drafted; verify first.
    - `+0x7E0` cc (RA) = `0x03003620`; `+0x7E1` track ID (RA) = `0x03003621`.
    - `+0x7F8` `drivers[8]` pointers (computed, struct has a 2-byte pad) = `0x03003638`; `playerDriver` pointer = `0x03003658`. Unverified offsets.
- Kart structs: 8 x 0x1A0 bytes, inline in IWRAM, kart 0 base `0x03003B98` (actor_t: posX int at +0, posY int at +4, so pixel X at `0x03003B9A` and pixel Y at `0x03003B9E`, matching RA and ADH). Kart k = base + k*0x1A0. Kart 0 is player 1. CPU karts are 2-7 in multi-pak; in single player, karts 1-7 are CPUs. No pointer chain needed.

## Every address found

IWRAM unless stated. "Draft" = included in `mksc.draft.yml`.

| Address | Size | Meaning | Source | Draft |
|---|---|---|---|---|
| 0x03000008 | 1 | Track slot 0-19 (Mushroom 0-3 ... Special 16-19) | RA | yes `cup_track_index` |
| 0x0300000C | 1 | Retries left | RA, DC | yes |
| 0x03000010 | 1 | Game mode 0 GP / 1 Time Trial / 2 Quick Run | RA | yes |
| 0x03000014 | 1 | Mario GP cc 0/1/2 | RA | yes |
| 0x03000018 | 1 | Quick Run cc 0/1/2 | RA | no (race_cc covers it) |
| 0x0300001D | 1 | Cup ID 0-4 | RA | yes |
| 0x03000038 | 1 | Character on the select screen, menu order: 0 Mario, 1 Luigi, 2 Peach, 3 Toad, 4 Yoshi, 5 DK, 6 Wario, 7 Bowser | RA | no (different enum from the in-race ID; DEC `spm_menuCharIdxToCharId` converts) |
| 0x030023B4 | 1 | Current race position, 0-based | RA | yes |
| 0x03002C6E | 1 | Quick Run laps 0=3, 1=5 | DC | yes |
| 0x03002C70 | 1 | Quick Run items on/off | DC | no |
| 0x03002C72 | 1 | Quick Run coins on/off | DC | no |
| 0x03002E20 | 4 | sceneMainFunc | DEC | yes `scene` |
| 0x03002E34 | 4 | VBlank frame counter | RA, DEC | no |
| 0x0300361A | 2 | race flags (GP 0x100, MG 0x800) | DEC | no |
| 0x03003620 | 1 | cc in race | RA | yes |
| 0x03003621 | 1 | Track ID (full table) | RA | yes |
| 0x03003634 | 1 | "In Race Check", no values given | RA | no (polarity unknown) |
| 0x030039EE | 1 | "Respawn Section?" | RA | no |
| 0x03003A28 | 2 | "Camera related": 00 menu, 06 fade in, 07 normal, 0A completed, 0F results, 12 intro | RA | yes `race_phase` |
| 0x03003AD0-0x03003AD8 | 2 each | GP skill points per track + average (rank) | RA | no |
| 0x03003ADC / 0x03003AE0 | 3 | Frames off the gas / on the brakes | RA | no |
| 0x03003AE4 | 1 | Triple red shells used | RA | no |
| 0x03003AE5 | 1 | Stars used | RA | no |
| 0x03003AE6 | 1 | Lightning used | RA | no |
| 0x03003AE7 | 1 | Lakitu rescues | RA | yes |
| 0x03003AE8 | 1 | Kart bumps | RA | yes |
| 0x03003AE9 | 1 | Wall bumps | RA | yes |
| 0x03003AEA | 1 | "Hit" | RA | yes `times_hit` |
| 0x03003AEB | 1 | Rocket starts | RA | yes |
| 0x03003AEC | 1 | Mini-turbos | RA | yes |
| 0x03003AF0 | 3 | Out-of-bounds frames | RA | no |
| 0x03003AF4 | 1 | Item boxes hit while holding an item | RA | no |
| 0x03003AF6-0x03003B6E | 2 each | Per-track ranking point breakdown (4 tracks x 0x20) | RA | no |
| 0x03003B9A / 0x03003B9E | 2 | Kart 0 pixel X / Y | RA, ADH, DEC | no |
| 0x03003BE0 | 1 | Kart 0 progress bits: 0x04 lap 1 done, 0x0C after lap 2, 0x20 finished (0x34/0x3C) | ADH, DC, DEC | yes |
| 0x03003BE1 | 1 | Set to 0xA0 for auto-drive | DC | no |
| 0x03003BE4 | 1 | Character ID (in-race order, + Bob-omb 08-0F) | DC, RA | yes |
| 0x03003BE6 | ? | Directional speed | RA | no |
| 0x03003BEE | 2 | Kart 0 heading (0 = north) | ADH | no |
| 0x03003BFE | 2 | Invulnerability timer | DC | yes |
| 0x03003C00 | 2 | Shrunk timer | DC | yes |
| 0x03003C02 | 2 | Star timer | DC | yes |
| 0x03003C06 | 2 | Bob-omb transform timer | DC | no |
| 0x03003C10 | 2 | Kart status (normal/airborne/falling/Lakitu/water/respawn/sinkhole) | RA | yes |
| 0x03003C1B | 1 | Understeer | RA | no |
| 0x03003C1C | 1 | Speed mode (0x09 with Star) | DC | no |
| 0x03003C1D | 1 | Terrain under kart | DC | yes |
| 0x03003C1E | 1 | Off-road slowdown | DC | no |
| 0x03003C2A | ? | Acceleration | RA | no |
| 0x03003C34 | 2 | Lakitu timer | RA | no |
| 0x03003C56 | 2 | Speed | DC, RA, ADH | yes |
| 0x03003C5C | ? | GP score (points) | RA | no (size unknown; add after a live check) |
| 0x03003C74-0x03003C7C | 2 each | Lap 1-5 times | RA | no |
| 0x03003C80 | 2 | Total race time | RA | no |
| 0x03003D10 | 1 | Coins | DC, RA | yes |
| 0x03003D12 | 1 | Item held | DC, RA | yes |
| 0x03003D13 | 1 | Has item (0x10) | DC, RA | yes |
| 0x03003D14 | 1 | Triple-item uses left | RA | no |
| 0x03003D2E / 0x03003D30 | 2 | Kart stretch (squash animation) | DC | no |
| 0x03005C80 | 3-4 | Race timer (frames) | RA (4), DC (3) | yes |
| EWRAM 0x02032BA8-0x02032BC5 | 1 each | Cup trophies, 30 cups x cc: 00 gold, 01 silver, 02 bronze, 03 beaten, FF none | RA (0x03ABA8+) | no (save mirror) |
| EWRAM 0x02032BC6-0x02032BE3 | 1 each | Cup rank: 00 3-star ... 07 E, 08 none | RA | no |
| EWRAM 0x02033100-0x0203310F | 4 x 4 | Per-track result in the current cup: time (2), position 0-based (1), coins (1) | RA (0x03B100+) | no (can draft `last_finish_position`-style states after a live check) |
| EWRAM 0x0203376C | ? | Extra-tracks unlock flag | RA | no |

## Conflicts and caveats

- Character IDs: two enums. `0x03000038` (select screen) is menu order; `0x03003BE4` (kart struct) is the internal order Mario, Luigi, Bowser, Peach, DK, Wario, Toad, Yoshi. RA and DC agree on the internal order.
- Item 0x0D/0x0E/0x0F: DC says 0x0D fake item box (acts as banana), 0x0E infinite golden mushroom (unused); RA says 0x0F double mushroom. Not contradictory.
- Race timer width: RA says 4 bytes, DC 3 bytes. 4-byte read is safe either way while the race is shorter than ~77 hours.
- `race_progress`: ADH saw both 0x34 and 0x3C at the finish and only proves the 0x04 (lap 1) and 0x20 (finished) bits. The lap-2 bit (0x08) is inferred from "12 after lap 2". The 0x10 bit (lap 3) is a guess and was not drafted. In Battle mode the bits are probably unused.
- `race_position` (0x030023B4) sits in a decomp bss region labelled for dmaQueue/libunk; only RA documents it. Highest-value address that most needs a live check.
- `scene` values assume GCC stores thumb function pointers with bit 0 set (standard). If the reader sees even values, drop the +1.
- Kart 0 = human player is solid for single player and for player 1 in multi-pak. In single-pak link the receiving console runs different code; not covered.

## Trigger ideas

1. **Race start / race end**: `race_phase` 0x12 (intro flyover) -> 0x07 (racing) -> 0x0A (completed) -> 0x0F (results). Dim lights at intro, lights up at 0x07, celebration at 0x0A.
2. **Finished race and placed**: on `race_finished` rising, read `race_position`: 0 = gold flash, 1-2 = silver/bronze, 3+ = sad trombone.
3. **Final lap**: `lap2_complete` rising in a 3-lap race (the game plays SONG_FINAL_LAP_JINGLE here) -> pulse lights.
4. **Fell off the track**: `kart_status` -> 0x02 falling / 0x08 sinkhole / 0x04 water, or `lakitu_rescues` incrementing -> short "splash" or red flash.
5. **Star power**: `star_timer` > 0 -> rainbow lights for the duration. Also `shrunk_timer` > 0 (hit by Lightning) and `times_hit` incrementing.
6. **Track theme**: `track_id` sets room colour (Rainbow Road, Boo Lake, Bowser Castles, Snow Land, Cheese Land).
7. **Coins**: `coins` reaches its cap (50 in GP, not verified) -> chime.

## Not found

- Current lap as a plain counter (derive from `race_progress` bits or the count of nonzero lap times at 0x03003C74+).
- Countdown (3-2-1) as its own state.
- Music track ID: the m4a player stores song header pointers, not IDs; the decomp's `songs.h` has the song enum (SONG_FINAL_LAP_JINGLE = 19, SONG_BATTLE = 18, title 51-53) but no RAM variable.
- Battle mode: balloons remaining, battle winner.
- Paused flag.
- Total laps for the current race (only the Quick Run option; GP and Time Trial are fixed at 3).
