# Pokémon Crystal — RAM research notes

## ROM revision

- Our ROM SHA-1 `f2f52230b536214ef7c9924f483392993e226cfb` = **US Rev 1 ("1.1")**, pret's
  `pokecrystal11.gbc` (https://github.com/pret/pokecrystal/blob/master/roms.sha1).
  US 1.0 is `f4cd194bdee0d04ca4eac29e09b8e4e9d818c133`.
- `pokecrystal.sym` (1.0) and `pokecrystal11.sym` (1.1) from the `symbols` branch were diffed for every
  WRAM symbol (`0x:C000-DFFF`, all banks): **identical**. 1.0 and 1.1 differ only in ROM code, so every
  address here holds for both revisions.

## Sources

| Source | URL | Used for |
|---|---|---|
| pret symbols (1.1) | https://github.com/pret/pokecrystal/blob/symbols/pokecrystal11.sym | every address |
| pret WRAM layout | https://github.com/pret/pokecrystal/blob/master/ram/wram.asm | unions, byte comments |
| pret constants | https://github.com/pret/pokecrystal/tree/master/constants (music, map, trainer, pokemon, landmark, sfx, battle, ram, map_data, script, gfx, audio) | every enum table |
| pret engine code | engine/battle/core.asm, engine/overworld/{events,scripting,time}.asm, engine/phone/phone.asm, engine/events/whiteout.asm, engine/menus/{menu,start_menu}.asm, engine/pokegear/pokegear.asm, home/{audio,time,map,window}.asm, engine/rtc/rtc.asm | what each byte does at runtime |
| DataCrystal RAM map | https://datacrystal.tcrf.net/wiki/Pok%C3%A9mon_Crystal/RAM_map | cross-check only (see conflicts) |
| Existing sidecar | media/emulation/gbc/roms/PokemonCrystal.yml (read-only) | audited below; its live checks carried over |

Raw downloads are in `raw/`; enum generators in `gen/`.

## Audit of the existing sidecar

All 18 addresses match the 1.1 symbols. Problems found:

| State | Problem | Fix in draft |
|---|---|---|
| `trainer_class` | **Wrong value: `12: koga`.** Class 12 (0x0C) is CAL; KOGA is 15 (0x0F). Also only 20 of 68 classes listed (no Sabrina 0x23, Blaine 0x2E, Blue 0x40, Red 0x3F, rival2 0x2A, Rocket grunts/executives). | Full 68-entry table from constants/trainer_constants.asm |
| `battle_type` | Missing 2 debug, 9 trap, 10 force_item. force_item is the Lugia / Ho-Oh / Snorlax battle (maps/WhirlIslandLugiaChamber.asm, TinTowerRoof.asm, VermilionCity.asm), so the legendary encounters read `unknown_10`. | Full 13-entry table |
| `battle_result` | Bits 6 (caught Celebi) and 7 (box full) are OR'd in, so a catch with a full box reads `unknown_128`. Value 2 is DRAW (player ran or foe fled), not only "fled". | Added 0x40/0x80/0x81/0x82 |
| `low_health_alarm` | `gt: 0` is wrong: bits 0-4 are a counter/pitch; only bit 7 (DANGER_ON_F) is on/off. | `mask: 0x80` |
| `music` | 23 of 103 tracks. | Full table (0x00-0x66) |
| `map_group`/`map_number` | Plain numbers; town list only in a comment (all 29 comment pairs verified correct). | Added `map` = one 2-byte BE read of group:number, full 388-map enum; `map_group` enum |
| header | Says "Cross-checked against DataCrystal; money disagrees": confirmed (DataCrystal has $D84F-D850, 2 bytes). | kept symbol value |

Nothing in the old sidecar is in WRAM banks 2-7.

## Addresses (all readable: bank 0/1)

Buffer offset = `addr - $C000`. "BE" = big-endian.

| Symbol | Addr | Size | Meaning / values | Notes |
|---|---|---|---|---|
| wBattleMode | D22D | 1 | 0 none, 1 wild, 2 trainer | live-checked (old sidecar) |
| wBattleType | D230 | 1 | BATTLETYPE_* 0-12 | stale between battles |
| wOtherTrainerClass | D22F | 1 | trainer class, 0 = wild | |
| wOtherTrainerID | D231 | 1 | which trainer of the class | not drafted (needs per-class table) |
| wEnemyMonSpecies | D206 | 1 | active foe species (1-251) | union with link-battle RN data; valid in battle |
| wTempEnemyMonSpecies | D204 | 1 | species at battle setup | alternative to D206 |
| wTempWildMonSpecies | D22E | 1 | wild species about to appear | |
| wBattleResult | D0EE | 1 | 0 WIN, 1 LOSE, 2 DRAW; bit6 Celebi, bit7 box full | |
| wLowHealthAlarm | C2A6 | 1 | bit7 on | danger beep |
| wBattleLowHealthAlarm | C6FD | 1 | nonzero suppresses the beep | |
| wPlayerHPPal | CD99 | 1 | 0 green 1 yellow 2 red | battle HP bar; stale outside battle |
| wEnemyHPPal | CD9A | 1 | same for foe | "almost caught it" cue |
| wBattleMonHP | C63C | 2 BE | your active mon HP | battle-only union |
| wBattleMonSpecies | C62C | 1 | your active species | battle-only union |
| wBattleMonLevel | C639 | 1 | | |
| wEnemyMonHP / MaxHP | D216 / D218 | 2 BE | foe HP | |
| wEnemyMonLevel | D213 | 1 | | |
| wBattleWeather | C70A | 1 | 0 none 1 rain 2 sun 3 sandstorm | battle-only union |
| wCurBattleMon | D0D4 | 1 | party slot in battle | |
| wMapGroup / wMapNumber | DCB5 / DCB6 | 1+1 | read as BE word = (group<<8)\|number | 388 maps, 26 groups |
| wCurLandmark / wPrevLandmark | C2D9 / C2D8 | 1 | LANDMARK_* (96) | Kanto = 0x2F-0x5E, 0x5F Fast Ship |
| wEnvironment | D19A | 1 | 1 town 2 route 3 indoor 4 cave 5 env5 6 gate 7 dungeon | |
| wMapTileset | D199 | 1 | tileset id | not drafted |
| wPlayerState | D95D | 1 | 0 walk 1 bike 2 skate 4 surf 8 surf-Pikachu | |
| wPlayerDirection / wPlayerFacing | D4DE / D4E3 | 1 | | not drafted |
| wMusicID | C29D | 2 LE | MUSIC_* 0x00-0x66 | live: title 0x01, menu 0x54 |
| wMapMusic | C2C0 | 1 | the map's own song | |
| wCurSFX | C2BF | 1 | last SFX id started (never cleared) | phone ring 0x6A, hang-up 0x6B |
| wMusicFade | C2A7 | 1 | nonzero while fading | |
| wPokegearRadioMusicPlaying | C6DC | 1 | radio station music | union; Pokégear-only |
| wTimeOfDay | D269 | 1 | 0 morn 1 day 2 nite 3 darkness | updated every overworld frame (HandleMapTimeAndJoypad → UpdateTime) |
| wCurDay | D4CB | 1 | wStartDay + RTC day; weekday = mod 7 | 0..146 |
| wStartDay | D4B6 | 1 | weekday at new game | |
| wGameTimeHours/Min/Sec | D4C4 (2) / D4C6 / D4C7 | | play time (not wall clock) | |
| wPartyCount | DCD7 | 1 | | |
| wPartySpecies | DCD8 | 6 | species list, FF-terminated | |
| wPartyMon1Species | DCDF | 1 | | |
| wPartyMon1Level | DCFE | 1 | | |
| wPartyMon1Status | DCFF | 1 | bits0-2 sleep, 3 psn, 4 brn, 5 frz, 6 par | not drafted |
| wPartyMon1HP / MaxHP | DD01 / DD03 | 2 BE | | party struct stride 0x30 (Mon2 HP DD31, Mon3 DD61) |
| wJohtoBadges / wKantoBadges | D857 / D858 | 1 | bit0 Zephyr/Boulder … bit7 Rising/Earth | `wBadges` = D857 (2 bytes) |
| wMoney | D84E | 3 BE | binary, max 999999 | |
| wMomsMoney | D851 | 3 BE | | |
| wCoins | D855 | 2 BE | Game Corner coins | |
| wStatusFlags | D84C | 1 | bit0 Pokédex, 2 Flash, 3 Pokérus, 4 Rocket signal, 5 no wild encounters, 6 Hall of Fame | |
| wStatusFlags2 | D84D | 1 | bit0 Rockets in Radio Tower, 1 safari, 2 bug-contest timer, 4 bike-shop call, 6 reached Goldenrod, 7 Rockets in Mahogany | |
| wBugContestMinsRemaining / Secs | D46C / D46D | 1 | contest clock (20:00) | |
| wParkBallsRemaining | DC79 | 1 | | shared with wSafariBallsRemaining |
| wDailyFlags1 | DC1E | 1 | bit1 bug contest done today, 2 fish swarm, 7 trainer house | |
| wSpecialPhoneCallID | DC31 | 1 | pending scripted call (Elm, Bill…) | nonzero = a special call is queued |
| wCurCaller | DBF9 | 2 | contact index of the last caller | persists after the call |
| wReceiveCallDelay_MinsRemaining | D465 | 1 | minutes until a random call may arrive | |
| wPokegearFlags | D957 | 1 | cards obtained | not "open" |
| wPokegearCard | CF64 | 1 | 0 clock 1 map 2 phone 3 radio | **union**: only meaningful while the Pokégear is up |
| wWindowStackSize | CF78 | 1 | saved-window count (menus open) | |
| wScriptRunning | D438 | 1 | PLAYEREVENT_*: 0 none, 1 seen by trainer, 2 talk to trainer, 3 item ball, 4 connection, 5 warp, 6 fall, 7 whiteout, 8 egg hatch, 9 change facing, FF map script | |
| wScriptMode | D437 | 1 | 0 off 1 read 2 wait movement 3 wait | |
| wRoamMon1/2/3 | DFCF / DFD6 / DFDD | 7 each | species, level, map group, map number, HP, DVs | Raikou, Entei; slot 3 unused in Crystal |
| wRoamMon1MapGroup/Number | DFD1 / DFD2 | | Raikou's location | |
| wRepelEffect | DCA1 | 1 | repel steps left | |
| wPokedexCaught / Seen | DE99 / DEB9 | 32 each | bit arrays | too wide for `count` (max 4 bytes) |
| wEventFlags | DA72 | 0x100 | story event bits | individual flags addressable with mask |

## Unreadable addresses

### WRAM banks 2-7 (not addressable by CPU address; buffer offset = bank*0x1000 + addr-0xD000)

| Symbol | Bank:addr | Buffer offset | Why it would matter |
|---|---|---|---|
| wTempTilemap | 02:D000 | 0x2000 | screen copy |
| wPokeAnimSpecies | 02:D16B | 0x216B | species in a cry/intro animation |
| wBT_OTName / wBT_OTTrainerClass | 03:D100 / 03:D10A | 0x3100 / 0x310A | Battle Tower opponent |
| wBGPals1 / wOBPals1 | 05:D000 / 05:D040 | 0x5000 / 0x5040 | live palettes: actual screen colours (time-of-day tint, flash) — an ambient-light colour source |
| wBGPals2 | 05:D080 | 0x5080 | |
| wLYOverrides | 05:D100 | 0x5100 | |
| wMagnetTrain | 05:D191 | 0x5191 | Magnet Train ride |
| wActiveAnimObjects | 05:D30A | 0x530A | battle animation objects |
| wBattleAnimFlags | 05:D40F | 0x540F | battle animation running |
| wScratchTilemap | 06:D000 | 0x6000 | |
| wDecompressEnemyFrontpic | 06:D800 | 0x6800 | |
| wWindowStack | 07:D000 | 0x7000 | saved menu windows (size counter is readable at CF78) |

1220 bank 2-7 symbols in total (913 in bank 3, mostly Battle Tower / mobile). If the reader ever
accepts a raw buffer offset (e.g. `offset:` instead of `addr:`), wBGPals1 at 0x5000 is the most
useful of these.

### HRAM (unreadable)

| Symbol | Addr | Meaning |
|---|---|---|
| hHours / hMinutes / hSeconds | FF94 / FF96 / FF98 | in-game clock: **the hour is HRAM-only**; WRAM has only time-of-day and wCurDay |
| hRTCDayLo / hRTCDayHi | FF8E / FF8D | raw RTC day |
| hInMenu | FFAA | 1 while Pokégear / menus are up (the clean "Pokégear open" signal) |
| hMapEntryMethod | FF9F | MAPSETUP_* (warp, fly, door, whiteout reload) |
| hJoyPressed / hJoyDown | FFA7 / FFA8 | buttons |
| hBattleTurn | FFE4 | whose turn |

### SRAM

Save data ($A000-$BFFF) is not read; nothing above needs it.

## Conflicts between sources

- **Money:** DataCrystal $D84F-$D850 (2 bytes) vs pret wMoney $D84E (3 bytes BE). pret wins: money is
  3 bytes up to 999,999. Same off-by-one for Mom's money (DC $D852 vs pret $D851).
- **Battle HP:** DataCrystal lists battle HP at $C62A; pret has wBattleMonHP at $C63C ($C62C is
  wBattleMonSpecies). DataCrystal's battle block is labelled unverified.
- **Stack:** DataCrystal says "C000-CFFF stack"; pret's stack is $C000-$C0FF (wStack). The
  sidecar's `cheat: false` stands either way.
- Badge bit orders agree.
- **Trainer class 12** (old sidecar "koga") contradicts pret (CAL). Fixed.

## Requested targets: status

| Target | Draft state(s) | Confidence |
|---|---|---|
| Battle state + wild/trainer | `battle` | symbol + live |
| Legendary / roaming | `battle_type` (roaming 5, force_item 10, celebi 11, suicune 12), `scripted_legendary_battle`, `enemy_species` | symbol; legendary mapping from map scripts |
| Map group+number enum | `map` (388), `map_group` (26), `map_number`, plus `landmark` (96), `in_kanto`, `environment` | symbol |
| Music ID enum | `music` (103), `map_music` | symbol + live |
| Time of day / day of week | `time_of_day`, `day_of_week` (wCurDay mod 7 spelled out as a 147-entry enum) | symbol; hour itself is HRAM |
| Party lead HP | `lead_hp`, `lead_max_hp`, `lead_fainted`, `lead_species`, `lead_level`, `battle_mon_hp` | symbol |
| Badges | `johto_badges`, `kanto_badges`, `badges_total` (popcount over 2 bytes) | symbol |
| Phone call ringing | `phone_ringing` (wCurSFX == SFX_CALL) | derived from code; **verify live** |
| Bug-catching contest | `bug_contest` (wStatusFlags2 bit 2), `bug_contest_minutes_left`, `park_balls_left`, `battle_type == contest` | symbol |
| Pokégear / menu open | `menu_open` (wWindowStackSize > 0), `full_screen_menu` (> 1: Pokégear, Pack, Pokédex, party…) | derived; **verify live**. No byte that singles out the Pokégear (hInMenu is HRAM; wPokegearCard is a union byte) |
| Money | `money`, `coins` | symbol + live |
| Whiteout | `whiteout` (wBattleResult == LOSE), `player_event == whiteout` (overworld path, unreferenced in Crystal) | derived from code; can_lose caveat |

## Trigger ideas

1. **Battle starts → lights dip / pulse.** `battle == wild` blue, `battle == trainer` amber,
   `trainer_class` in gym leaders / Elite Four (1-8, 11-16) → red. `music == johto_gym_leader_battle`
   / `champion_battle` / `rival_battle` / `rocket_battle` are the same cue from the soundtrack.
2. **Legendary encounter.** `battle_type == roaming` (Raikou/Entei), `== suicune`, `== force_item`
   (Lugia/Ho-Oh — check `enemy_species == lugia/ho_oh` to exclude Snorlax), `== celebi`: one-shot
   dramatic scene.
3. **Danger beep.** `low_health_alarm` (or `player_hp_color == red`) → red pulse while it lasts;
   `whiteout` → lights flash white, then the house "faints" (dim) until the next battle.
4. **Phone ringing.** `phone_ringing` → ring a real chime / flash the hallway light, scoped until
   hang-up.
5. **Day/night mirror.** `time_of_day` → morning warm, day bright, night dim blue; `environment == cave`
   or `map == dark_cave_*` → lights off; `player_state == surf` → ocean blue; `bug_contest` → green
   for 20 minutes with `bug_contest_minutes_left` as a countdown.
6. Progress cheers: `johto_badges`/`kanto_badges` count increases, `music == evolution` /
   `music == capture`, `music == hall_of_fame`, `music == credits`.

## Gaps

- **Wall-clock hour** is HRAM-only (hHours); only the 4-way time-of-day is in WRAM.
- **Pokégear open** has no dedicated WRAM byte. The nearest is `full_screen_menu`
  (wWindowStackSize > 1): the start menu pushes one window and every full-screen submenu
  (Pokégear, Pack, Pokédex, party, trainer card, options) pushes a second via FadeToMenu, so it
  says "a start-menu screen is up" without naming which. wPokegearCard ($CF64) is meaningful only while it is up and otherwise holds unrelated
  union data. A combination (music = radio channel + wPokegearRadioMusicPlaying)
  works only for the radio card.
- `phone_ringing` and `menu_open` are derived from code paths, not observed. Both need a live
  session check before bindings rely on them.
- `whiteout` cannot exclude can_lose battles in one flag (the binding layer has no AND across states).
- `map` reads two bytes written separately on a warp, so a transient `unknown_xxxx` is possible for
  one sample.
- RetroAchievements code notes for Crystal were not consulted (pret symbols are authoritative and
  cover everything asked).
