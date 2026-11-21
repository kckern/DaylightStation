# Sonic the Hedgehog (Genesis): RAM research notes

ROM: `SonicTheHedgehog.bin`, 524288 bytes, SHA-1 `6ddb7de1e17e7f6cdb88927bd906352030daa194`
(re-hashed locally, matches).

## Revision

REV00. Checked against the ROM header itself:
- serial at $180: `GM 00001009-00` (s1disasm `Revision=0`; REV01 is `GM 00004049-01`)
- header checksum at $18E: `$264A` (REV00) vs `$AFC7` (REV01)
- region `JUE`

s1disasm defaults to `Revision = 1`, so every address in this note was computed with
`Revision = 0`. In `_Variables.asm` the only revision-conditional RAM is $FFFFC0
(`v_scorecopy` REV00, `v_scorelife` REV01), so all the addresses below are the same in
both revisions. Behaviour that differs in REV00 and affects a state:
- LZ3 boss escape: REV01 adds `clr.b (f_lockscreen).w`; REV00 does not
  (`_incObj/77 Boss - LZ Main.asm`, `if Revision<>0`). On our ROM the screen-lock flag
  stays 1 from the LZ3 boss until the prison capsule.

## Sources

| Source | URL | Status |
|---|---|---|
| s1disasm | https://github.com/sonicretro/s1disasm (master) | fetched: `_Variables.asm`, `_Constants.asm`, `s1.sounddriver*.asm`, `sonic.asm`, selected `_incObj/` and `_inc/` files (in `raw/`) |
| Data Crystal | https://datacrystal.tcrf.net/wiki/Sonic_the_Hedgehog_(Genesis)/RAM_map | fetched (`raw/scrape_3339de.md`); agrees on every shared address |
| stable-retro | https://github.com/Farama-Foundation/stable-retro, `stable_retro/data/stable/SonicTheHedgehog-Genesis-v0/data.json` | fetched; agrees (zone FE10, act FE11, lives FE12, rings FE20, score FE26, x FFD008, y FFD00C, level_end_bonus FFF7D6) |
| RetroAchievements code notes | retroachievements.org game 1 | NOT reachable: Cloudflare bot check through Firecrawl |
| Sonic Retro SCHG RAM Editing | https://info.sonicretro.org/SCHG:RAM_Editing/Sonic_1 | NOT reachable: Anubis "Access Denied" |
| This ROM | MusicIndex at $071A9C (via Go_ table at $071990) | read with `tools/music.py`, output in `music_voiceptr_rev00.txt` |

How addresses were computed: `tools/layout.py` lays out `_Variables.asm` from
`v_snddriver_ram` ($FFF000, SMPS_RAM = $5C0 bytes) with Revision=0 / FixBugs=0. The layout
ends exactly at $1000000 and lands `v_gamemode` on $FFF600, `v_zone` on $FFFE10 and
`v_chunk0collision` on $FFFF00 (the disasm asserts that one), so the offsets are consistent.
Full table: `layout_rev00.txt`.

## Audit of the existing sidecar

| State | Address | Verdict |
|---|---|---|
| game_mode | $FFF600 | Correct. Value table missing `0x88` (demo loading: GM_Level does `bset #7` for both demo and level). Added. |
| special_stage | $FFF600 == 0x10 | Correct. |
| zone | $FFFE10 | Correct. Value 7 is only the level-select dummy; in a Special Stage `v_zone` keeps the zone you entered from. |
| act | $FFFE11 | Correct, comment right (SBZ3 = zone 1 act 3; FZ = zone 5 act 2). |
| lives | $FFFE12 | Correct. |
| rings | $FFFE20 w | Correct. |
| score | $FFFE26 l | Address correct. Value is binary and the HUD shows value x 10 (AddPoints: "rightmost digit in HUD is a fake 0"). Comment added. |
| underwater | $FFD022 mask 0x40 | Correct (`status_underwater_bit = 6`). Only meaningful when slot 0 is the level Sonic object. |
| air | $FFFE14 w | Correct. Set to 30 at level load (Level_LoadPal) and on leaving water (ResumeMusic). Wraps to $FFFF when Sonic drowns (`subq.w` then `bhs`). |
| drowning | $FFFE14 lt 13 | Correct: countdown music queued when air is exactly 12. `lt 13` also excludes the $FFFF wrap. |
| dying | $FFD024 == 6 | Correct (Sonic_Index: 0 init, 2 control, 4 hurt, 6 death, 8 reset level). |
| boss_fight | $FFF7AA == 1 | Address right, meaning overstated. `f_lockscreen` is also set for the SBZ2 Eggman scene, stays 1 after a boss explodes, is cleared only by the prison capsule, and in REV00 stays set through the LZ3 escape. Renamed `boss_screen_lock` in the draft; use `music == boss` for "boss fight in progress". |
| boss_defeated | $FFF7A7 | Correct (1 set by boss code, verified in the GHZ boss; 2 set by the prison capsule). Renamed `boss_status`. |
| act_clear | $FFF7D6 gt 0 | **Wrong signal.** `f_endactbonus` is a HUD redraw flag: GotThroughAct and Got_Bonus set it, and HUD_Update (run from VBlank) clears it the same frame. It is 1 for a sliver of a frame, so a once-per-frame reader will mostly see 0 or flicker. stable-retro uses it as a reward tick, which is a different use. Replaced by the results-card object test ($FFD5C0 == 0x3A), which stays set for the whole tally. |
| shield / invincible / speed_shoes | $FFFE2C/2D/2E | Correct. Note GotThroughAct clears `v_invinc`. |
| emeralds | $FFFE57 | Correct. |
| header comment "the sound driver keeps no now-playing byte" | | True for an ID byte (`v_sound_id` is reset to $80 after dispatch), but `v_voice_ptr` ($FFF018) works as a per-song fingerprint. See Music. |

## Every address found

All from s1disasm `_Variables.asm` / `_Constants.asm` / `_inc/Object Pointers.asm` unless
noted; DC = also on Data Crystal; SR = also in stable-retro. All are 68k work RAM, readable.

### Game / level
| Addr | Size | Name | Meaning |
|---|---|---|---|
| $FFF600 | b | v_gamemode | 00 Sega, 04 Title, 08 Demo, 0C Level, 10 SS, 14 Continue, 18 Ending, 1C Credits; +$80 while loading (DC) |
| $FFF602-05 | b | v_jpadhold2/press2/hold1/press1 | joypad held/pressed |
| $FFF614 | w | v_generictimer | generic VBlank countdown |
| $FFF63A | w | f_pause | 1 = paused |
| $FFF646 | w | v_waterpos1 | water height |
| $FFF64C | b | f_water | level has water |
| $FFF64E | b | f_wtr_state | 01 = whole screen underwater |
| $FFF700 / $FFF704 | l | v_screenposx / y | camera (DC, SR) |
| $FFF742 | b | v_dle_routine | dynamic level event routine (boss arena stages) |
| $FFF760-65 | w | v_sonspeedmax/acc/dec | (DC) |
| $FFF7A7 | b | v_bossstatus | 1 boss beaten, 2 capsule opened |
| $FFF7AA | b | f_lockscreen | boss arena lock (DC "screen lock") |
| $FFF7C8 | b | f_playerctrl | player control override (DC calls it control lock); $81 on drowning |
| $FFF7CC | b | f_lockctrl | controls locked (signpost run-off, capsule, ending) |
| $FFF7CD | b | f_bigring | Sonic jumped into the giant ring |
| $FFF7D0/D2/D4 | w | v_itembonus/v_timebonus/v_ringbonus | end-of-act bonuses being tallied |
| $FFF7D6 | b | f_endactbonus | one-frame HUD redraw flag (SR level_end_bonus) |
| $FFFE02 | w | f_restart | restart-level flag (DC) |
| $FFFE04 | w | v_framecount | frame counter (DC calls it level timer) |
| $FFFE08 | w | v_debuguse | debug placement mode active |
| $FFFE10 / 11 | b | v_zone / v_act | (DC, SR) |
| $FFFE12 | b | v_lives | (DC, SR) |
| $FFFE14 | w | v_air | air seconds (DC) |
| $FFFE16 | b | v_lastspecial | next Special Stage index (DC "last special stage entered") |
| $FFFE18 | b | v_continues | (DC) |
| $FFFE1A | b | f_timeover | time over |
| $FFFE1C-1F | b | f_lifecount/ringcount/timecount/scorecount | HUD flags; `f_timecount` doubles as "clock running" and is NOT cleared by the HUD (only on time over), so it is usable |
| $FFFE20 | w | v_rings | (DC, SR) |
| $FFFE22 | l | v_time | 00 MM SS FF, binary (DC has a typo listing $FFFE23 twice) |
| $FFFE26 | l | v_score | binary, x10 on screen (DC, SR) |
| $FFFE2C/2D/2E | b | v_shield / v_invinc / v_shoes | (DC) |
| $FFFE30 | b | v_lastlamp | last lamppost number (DC) |
| $FFFE32.. | | v_lamp_* | lamppost respawn snapshot |
| $FFFE57 | b | v_emeralds | count (DC) |
| $FFFE58 | 6 b | v_emldlist | which Special Stage gave each emerald |
| $FFFFC0 | l | v_scorecopy | REV00 only: high-water score copy, survives soft reset (REV01: v_scorelife) |
| $FFFFE0-E3 | b | f_levselcheat/slomocheat/debugcheat/creditscheat | cheat codes entered |
| $FFFFF0 | w | f_demo | 0 / 1 demo / $8001 ending demo |
| $FFFFF2 / F4 | w | v_demonum / v_creditsnum | (DC has F4) |
| $FFFFF8 | b | v_megadrive | console region/version byte |
| $FFFFFA | w | f_debugmode | debug mode on |

### Object slots ($FFD000, $40 bytes each)
| Addr | Meaning |
|---|---|
| $FFD000 | slot 0 Sonic: ID +0 (01 in level, 09 in SS), x +8 (SR), y +$C (SR), status +$22, routine +$24, flashtime +$30, invtime +$32, shoetime +$34, restartime +$3A |
| $FFD040 | slot 1 HUD |
| $FFD080 | slot 2 title card at level start; id $39 GameOverCard for GAME OVER / TIME OVER; frame at $FFD09A (0 GAME, 2 TIME) |
| $FFD180 | slot 6 shield object |
| $FFD200-$FFD2C0 | slots 8-11 invincibility stars |
| $FFD340 | slot 13 Sonic's bubbles / drowning countdown object |
| $FFD5C0 | slot 23 results card: $3A GotThroughCard (act clear), $7E SSResult (Special Stage results) |
| $FFD800+ | level objects (bosses are loaded here; slot not fixed, so boss hit points are not addressable without a scan) |

### Sound driver (SMPS, base $FFF000)
| Addr | Name | Meaning |
|---|---|---|
| $FFF000 | v_sndprio | current SFX priority |
| $FFF003 | f_pausemusic | 1 when paused, $80 on unpause |
| $FFF009 | v_sound_id | request being dispatched; reset to $80 right after, not a now-playing byte |
| $FFF00A-0C | v_soundqueue0-2 | sound queue, cleared each driver tick |
| $FFF018 | v_voice_ptr (long) | song voice table pointer, unique per song (below) |
| $FFF020 | v_special_voice_ptr | special SFX ($D0 waterfall) voices |
| $FFF027 | f_1up_playing | $80 during the 1-up jingle |
| $FFF02A | f_speedup | $80 when speed-shoes tempo is on |
| $FFF040 | v_music_dac_track | then FM1-6, PSG1-3 at +$30 each; byte +0 bit 7 = track playing |
| $FFF3A0 | v_1up_ram_copy ($220 bytes) | saved music state during a 1-up |

## Music: how `music` works

The driver has no "current BGM id" byte. `Sound_PlayBGM` loads the song header and writes
`song_base + header_word0` (the voice table address) to `v_voice_ptr` ($FFF018). Each song
in Sonic 1 has its own voice table, so that long is a fingerprint for the song. Values read
from this ROM's MusicIndex ($071A9C, which is also s1disasm's REV00 address):

| ID | Song | voice ptr |
|---|---|---|
| 81 | GHZ | $074C63 |
| 82 | LZ | $075117 |
| 83 | MZ | $075575 |
| 84 | SLZ | $0759C9 |
| 85 | SYZ | $075E15 |
| 86 | SBZ | $07634D |
| 87 | Invincibility | $0765B0 |
| 88 | Extra life | $076684 |
| 89 | Special Stage | $076998 |
| 8A | Title | $076B5D |
| 8B | Ending | $076DDE |
| 8C | Boss | $076FC7 |
| 8D | Final Zone | $077216 |
| 8E | Act clear | $077352 |
| 8F | Game over | $0774BB |
| 90 | Continue | $077619 |
| 91 | Credits | $078612 |
| 92 | Drowning | $078A12 |
| 93 | Chaos emerald | $078B12 |

Behaviour, from the driver code:
- SFX never write it (they use per-track voice pointers).
- 1-up: the driver backs up $220 bytes of state, plays the 1-up tune (pointer = extra_life),
  then `cfFadeInToPrevious` restores the backup, so the pointer returns to the zone song.
- `StopAllSound` ($E4, and the boot clear) zeroes it -> `none`.
- A song that ends on its own (act clear, game over, 1-up before restore) leaves its value
  in place. Treat `music` as "last song started", not "audible now".
- Fade-out ($E0) keeps the pointer until the next song.
- Not checked live. The Go_ table detection and the voice pointers are consistent (one per
  song, each just past its song's track data), but a live read is the real test.

## Trigger ideas

1. **Boss music starts**: `music` changes to `boss` (GHZ3/MZ3/SYZ3/LZ3/SLZ3). Flash red,
   dim the room; `music` leaving `boss` (back to the zone song) = boss beaten.
2. **Drowning countdown**: `drowning` goes true (air 12 s) in LZ/SBZ3. Pulse lights blue/red
   in time with the countdown; `air` gives the seconds left.
3. **Lost a life / game over**: `lives` decreases, or `dying` goes true for the moment of
   death; `game_over_card` + `lives == 0` = GAME OVER, `game_over_text == time` = TIME OVER.
4. **Act clear**: `act_clear` goes true (results card), or `music == act_clear`. Celebrate;
   `giant_ring` the same moment means a Special Stage is next.
5. **Power-ups**: `invincible` true (rainbow lights for its ~20 s; `invincibility_timer` gives
   frames left), `shield` true/false (shield lost = took a hit), `emeralds` increasing
   (chaos emerald won).
6. Zone ambience: `zone` while `game_mode` is level (green, blue/aqua, orange, purple night,
   pink, industrial grey). `underwater` flips at the water surface.

## Gaps / could not find

- RetroAchievements code notes and Sonic Retro SCHG pages: both blocked to automated
  fetches, so nothing here is RA-corroborated. Data Crystal and stable-retro agree on every
  address they list.
- Boss hit points: bosses live in the dynamic level-object area ($FFD800+), no fixed slot.
  `obBossHits` is +$21 of whichever slot the boss occupies.
- Last SFX played: no persistent byte (queue and `v_sound_id` are cleared within the frame).
- "Signpost touched" moment: no dedicated flag. `timer_running` dropping to 0 while Sonic is
  alive in a level is the closest (it also drops on death and capsule).
- `f_bigring` setter was not read (giant ring object file not fetched); only its reader
  (Got Through Card) was checked. Marked single-source.
- `v_bossstatus = 1` was verified only in the GHZ boss code; the other bosses were not read.
- Combined conditions ("in level AND underwater") are not expressible in this schema;
  object-slot states (sonic_routine, underwater, act_clear, game_over_card) should be gated
  on `game_mode` by the consumer.
