# Pokémon Red: RAM research notes

ROM: SHA-1 `ea9bcae617fdf159b045185467ae58b2e4a48b9a`, "Pokemon - Red Version (USA, Europe) (SGB Enhanced)".
Header version byte 0x00, CGB flag 0x00. This is exactly what pret/pokered builds as `pokered.gbc`
(`roms.sha1` in the repo). Both copies in `media/emulation/gb/roms/` (`PokemonRed.gb` and
`Pokemon Red (UE) [S][!].gb`) hash to it.

## Sources

| Source | URL | Used for |
|---|---|---|
| pret symbol file (rgblink output of this exact build) | https://raw.githubusercontent.com/pret/pokered/symbols/pokered.sym | every address |
| pret wram.asm | https://github.com/pret/pokered/blob/master/ram/wram.asm | field meanings, value comments |
| pret constants | https://github.com/pret/pokered/tree/master/constants (map_, music_, pokemon_, trainer_, tileset_, battle_, ram_constants.asm) | enum tables |
| pret code | home/overworld.asm, home/audio.asm, engine/battle/core.asm, engine/battle/end_of_battle.asm, engine/events/black_out.asm | when values are set and cleared |
| Data Crystal RAM map | https://datacrystal.tcrf.net/wiki/Pok%C3%A9mon_Red_and_Blue/RAM_map | corroboration only |

Raw downloads are in `raw/`. `tools/gen_pokemon_gen1.py` regenerates both drafts from them, so every enum
table comes from the constants files with no hand-typing. `tools/validate.mjs` loads the drafts through the
repo's own `normalizeSidecar` (0 warnings, 36/36 states kept) and checks big-endian HP, BCD money and the
2-byte map-music word against `readValue` on a synthetic heap.

Music ids are not literal in the source: `music_const` defines them as `(header label - SFX_Headers_1) / 3`.
I computed them from the `.sym` label addresses (SFX_Headers_1/2/3 are all at $4000 in banks $02/$08/$1F).
The results match the well-known values (MUSIC_PALLET_TOWN = $BA, MUSIC_GYM_LEADER_BATTLE = $EA).

## Audit of the existing sidecar (`gb/roms/PokemonRed.yml`)

| State | Address | Verdict |
|---|---|---|
| battle | 0xD057 wIsInBattle | Address correct. Missing value 0xFF = LOST_BATTLE. |
| battle_kind | 0xD05A wBattleType | Correct (0 normal, 1 old man, 2 safari). Renamed `battle_type` in the draft. |
| location | 0xD35E wCurMap | Correct; table had 5 of 248 maps. Draft has all 248. |
| **hp_low** | 0xD16C size 2 | **Bug: no `endian`, so it reads little-endian. Gen 1 stores HP big-endian.** HP 5 (bytes `00 05`) reads as 1280 and never fires; HP 256 (`01 00`) reads as 1 and fires. Draft sets `endian: big`. |
| fainted | 0xD16C size 2 | Works by accident (0 is 0 in both byte orders). Draft adds `endian: big` anyway. Also true before the starter is received. |
| party_count | 0xD163 | Correct. |
| badges | 0xD356 count | Correct. |
| money | 0xD347 3B big BCD | Correct. |
| **music_track** | 0xD35B | Address is wMapMusicSoundID: the **current map's** song, not what is playing. It does not change for battle, bike or surf music, and its ids collide across audio banks. Replaced by `music` (0xC026, playing now) + `music_bank`, and `map_music` (2-byte word that includes the bank). |
| calibration.cheat: false | | Keep. $C000-$C0FF is audio-engine RAM. |

## Every address found

All addresses are WRAM ($C000-$DFFF), readable, `disasm-symbol` confidence unless noted.

| Symbol | Addr | Size | Meaning | In draft |
|---|---|---|---|---|
| wChannelSoundIDs (CHAN1) | C026 | 1 (of 8) | song id on music channel 1, 0 = stopped | `music` |
| wNewSoundID | C0EE | 1 | sound requested; zeroed inside PlaySound almost immediately | no, too short-lived |
| wAudioROMBank | C0EF | 1 | audio bank of current music: $02, $08 (battle), $1F | `music_bank`, `battle_music` |
| wAudioSavedROMBank | C0F0 | 1 | copy of the above | no |
| wCurrentMenuItem | CC26 | 1 | cursor row in the current menu | no (no clear moment) |
| wJoyIgnore | CD6B | 1 | buttons ignored (scripted scenes) | no |
| wLowHealthAlarmDisabled | CCF6 | 1 | alarm disabled after winning | no |
| wBattleResult | CF0B | 1 | 0 win, 1 lose, 2 draw; but it is set to 1 whenever your *current* mon faints, not only on a lost battle | no, misleading |
| wLastMusicSoundID | CFCA | 1 | "sometimes" last music; may be $FF or 0 (wram.asm says so) | no, unreliable by its own docs |
| wEnemyMonSpecies2 | CFD8 | 1 | enemy species in battle | no (wCurOpponent covers it) |
| wBattleMonSpecies2 | CFD9 | 1 | player's active species in battle | no |
| wPlayerHPBarColor | CF1D | 1 | 0 green, 1 yellow, 2 red; UNION outside battle | `player_hp_bar` |
| wEnemyHPBarColor | CF1E | 1 | same for the enemy | no (add if wanted: "enemy almost down") |
| wEnemyMonHP | CFE6 | 2 BE | enemy HP | no |
| wEnemyMonLevel | CFF3 | 1 | enemy level | no |
| wBattleMonHP | D015 | 2 BE | live HP of player's active mon | no (lead_hp chosen; this is better mid-battle when lead is switched out) |
| wBattleMonStatus | D018 | 1 | status of active mon | no |
| wTrainerClass | D031 | 1 | trainer class (no offset), stale after battle | `trainer_class` |
| wIsInBattle | D057 | 1 | 0/1/2, $FF lost | `battle`, `whited_out` |
| wCurOpponent | D059 | 1 | species (wild) or class+200 (trainer) | `battle_opponent`, `battle_category` |
| wBattleType | D05A | 1 | 0 normal, 1 old man, 2 safari | `battle_type` |
| wGymLeaderNo | D05C | 1 | nonzero in gym-leader battles (picks gym-leader music) | no; wCurOpponent is cleaner. Data Crystal calls it "Is Gym Leader battle music playing?" |
| wLowHealthAlarm | D083 | 1 | bit 7 = alarm on | `low_hp_alarm` |
| wDamage | D0D7 | 2 | last damage | no |
| wTextBoxID | D125 | 1 | text box type | no |
| wLinkState | D12B | 1 | link cable state | no |
| wOutOfBattleBlackout | D12D | 1 | nonzero when poison faints the whole party; UNION with wChosenMenuItem | no, see gaps |
| wPlayerName | D158 | 11 | name | no |
| wPartyCount | D163 | 1 | | `party_count` |
| wPartySpecies | D164 | 7 | species list, $FF terminated | no |
| wPartyMon1Species | D16B | 1 | lead species | `lead_species` |
| wPartyMon1HP | D16C | 2 BE | lead HP | `lead_hp`, `lead_hp_low`, `lead_fainted` |
| wPartyMon1Status | D16F | 1 | lead status (poison, sleep...) | no (candidate: "poisoned") |
| wPartyMon1Level | D18C | 1 | | `lead_level` |
| wPartyMon1MaxHP | D18D | 2 BE | | `lead_max_hp` |
| wPokedexOwned | D2F7-D309 | 19 | 151-bit flags | `dex_owned_*` (5 chunks) |
| wPokedexSeen | D30A-D31C | 19 | seen flags | no |
| wNumBagItems | D31D | 1 | | no |
| wPlayerMoney | D347 | 3 BE BCD | | `money` |
| wOptions | D355 | 1 | text speed, animation, battle style | no |
| wObtainedBadges | D356 | 1 | bit0 Boulder .. bit7 Earth | `badges`, `badge_bits` |
| wMapMusicSoundID / wMapMusicROMBank | D35B / D35C | 1+1 | current map's song + bank | `map_music` (2-byte word) |
| wCurMap | D35E | 1 | map id | `location` |
| wLastMap | D365 | 1 | outdoor map an indoor exit returns to | `last_outdoor_map` |
| wCurMapTileset | D367 | 1 | tileset id | `tileset` |
| wPlayerMovingDirection / wPlayerDirection | D528 / D52A | 1 | facing | no |
| wCurrentBoxNum | D5A0 | 1 | | no |
| wNumHoFTeams | D5A2 | 1 | Hall of Fame entries | `hall_of_fame_teams` |
| wPlayerCoins | D5A4 | 2 BE BCD | Game Corner coins | `coins` |
| wWalkBikeSurfState | D700 | 1 | 0 walk, 1 bike, 2 surf | `walk_state`, `surfing`, `biking` |
| wSafariSteps | D70D | 2 | steps left in Safari Zone | no |
| wBeatGymFlags | D72A | 1 | duplicate of badges | no |
| wStatusFlags4 | D72E (wStatusFlags5 - 2) | 1 | bit 5 BIT_BATTLE_OVER_OR_BLACKOUT, set after *every* battle | no |
| wStatusFlags5/6/7 | D730/D732/D733 | 1 | scripted movement, fly/dig warps, forced bike | no |
| wElite4Flags | D734 | 1 | bit 1 = Elite Four run started | `elite_four_started` |
| wEventFlags | D747.. | many | story event bits | no (too many; pick specific ones later) |
| wNumSafariBalls | DA47 | 1 | | no |
| wPlayTimeHours/Maxed/Minutes/Seconds/Frames | DA41-DA45 | 1 each | play clock | no |
| wBoxCount | DA80 | 1 | | no |
| hJoyHeld | FFB4 | 1 | buttons held | unreadable: hram |

## Conflicts between sources

- Data Crystal lists D700 as "Bike Speed". pret names it wWalkBikeSurfState with 0/1/2 values, and the
  code (`HandleFlyWarpOrDungeonWarp`, `ResetStatusAndHalveMoneyOnBlackout`) treats it that way. pret wins.
- Data Crystal D05C "Is Gym Leader battle music playing?" vs pret wGymLeaderNo. Same byte, different framing;
  not used.
- Data Crystal D35B "Audio track" is the map's song (wMapMusicSoundID). The old sidecar inherited that
  reading and treated it as the current track.
- No conflicts on D057, D05A, D16C, D347, D356, D35E.

## Things to know before binding

- **Song ids collide across audio banks.** On `music` (C026) these ids carry two or three names:
  $C3 cities1/title_screen, $C7 cities2/credits, $CA celadon/hall_of_fame, $CD cinnabar/oaks_lab,
  $D0 vermilion/jigglypuff_song, $E8 pkmn_healed/dungeon3, $F0 wild_battle/pokemon_tower,
  $F3 routes3/final_battle/silph_co, $F6 defeated_trainer/meet_evil_trainer,
  $F9 defeated_wild_mon/meet_female_trainer, $FC defeated_gym_leader/meet_male_trainer.
  The binding language matches one state, so for battle music bind `battle_music` (bank $08) or
  `battle_category`, not `music == wild_battle_or_pokemon_tower`. Ids that are unique ($EA gym_leader_battle,
  $ED trainer_battle, $BA pallet_town, $DE meet_rival...) are safe to bind directly.
- `map_music` reads two bytes (id, bank) as one little-endian word, so 0x02BA = pallet_town, 0x1FF0 =
  pokemon_tower. No collisions there.
- `battle_category` and `battle_opponent` are the same byte with two value tables. wCurOpponent is written
  when the encounter or trainer engagement starts (a moment before the battle screen) and zeroed by
  EndOfBattle.
- `lead_*` is party slot 1, not the mon currently in battle.
- `whited_out` is a short window (~1 s); a binding should be a one-shot `do:`, not a scoped effect.

## Trigger ideas

1. **Battle lights**: `battle_category == gym_leader` → gym-leader scene; `== legendary` → lightning/strobe;
   `== champion` → full-house light show; `battle == wild` → subtle pulse. Exit when `battle == none`.
2. **Low HP**: `low_hp_alarm` (the game's own beeping) → red pulse while it beeps.
3. **Whited out**: `whited_out` → lights dim to black for a few seconds.
4. **New badge**: `badges` changes upward (count state) → chime + gold flash. Badge count 8 → victory scene.
5. **Hall of Fame**: `hall_of_fame_teams` increments, or `music == celadon_or_hall_of_fame` together with
   `location == hall_of_fame` → celebration.
6. Ambient: `tileset == cavern` → dim; `tileset == cemetery` (Pokémon Tower) → purple/low; `surfing` → blue;
   `biking` → faster ambient; `location == safari_zone_*` → green.
7. New Pokédex catch: any `dex_owned_*` count goes up → small notification.

## Not found / gaps

- **Pokédex owned count** is not stored anywhere readable as one value. The game counts bits on demand
  into HRAM (`hDexRatingNumMonsOwned`) or the scratch wNumSetBits. The draft exposes five `count` states
  over the 19-byte array; a consumer has to add them. A schema extension (count over N bytes) would make it
  one state.
- **Ratio-based low HP** (HP < 1/5 of max) cannot be expressed; the schema compares against constants only.
  `lead_hp_low` uses HP < 10. In battle `low_hp_alarm` and `player_hp_bar == red` are the real signal.
- **Out-of-battle poison blackout** does not set wIsInBattle = $FF; it jumps straight to HandleBlackOut.
  wOutOfBattleBlackout (D12D) flags it but shares its byte with wChosenMenuItem, so it is not a clean flag.
  Not drafted.
- **Menu open / paused**: no clean single byte found. wCurrentMenuItem and wTextBoxID hold stale values.
- No live-session verification yet. Every address is exact for this ROM build; behaviour comments come
  from reading code, not from watching it.
