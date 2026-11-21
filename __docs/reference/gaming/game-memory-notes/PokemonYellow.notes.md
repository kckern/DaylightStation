# Pokémon Yellow: RAM research notes

ROM: SHA-1 `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1`, "Pokemon - Yellow Version - Special Pikachu Edition
(USA, Europe) (CGB+SGB Enhanced)". 1 MiB. Header: title `POKEMON YELLOW`, CGB flag 0x80, cartridge type 0x1B
(MBC5+RAM+battery), version byte 0x00. There is only one US/EU revision; this is it, and it is exactly what
pret/pokeyellow builds as `pokeyellow.gbc` (`roms.sha1`). The copy at `media/emulation/gbc/roms/PokemonYellow.gbc`
hashes to it. No sidecar exists for it yet.

## Sources

| Source | URL | Used for |
|---|---|---|
| pret symbol file | https://raw.githubusercontent.com/pret/pokeyellow/symbols/pokeyellow.sym | every address |
| pret wram.asm | https://github.com/pret/pokeyellow/blob/master/ram/wram.asm | meanings |
| pret constants | https://github.com/pret/pokeyellow/tree/master/constants | enum tables |
| pret Pikachu code | engine/events/pikachu_happiness.asm, engine/pikachu/pikachu_status.asm | happiness/mood semantics |
| Data Crystal | https://datacrystal.tcrf.net/wiki/Pok%C3%A9mon_Yellow/RAM_map | corroboration (stub page: D46F happiness, D354 options, "most addresses -1 from Red") |

Same tooling as Red: `tools/gen_pokemon_gen1.py` builds the draft from `raw/`; `tools/validate.mjs`
passes it through `normalizeSidecar` (0 warnings, 38/38 states kept).

**Nothing here is Red-minus-one by assumption.** Each address was looked up in pokeyellow.sym. Most WRAM
from $CF.. upward is one byte lower than Red, but the audio RAM and several others are not shifted:

| Symbol | Red | Yellow | Shift |
|---|---|---|---|
| wChannelSoundIDs | C026 | C026 | 0 |
| wAudioROMBank | C0EF | C0EF | 0 |
| wCurrentMenuItem | CC26 | CC26 | 0 |
| wLowHealthAlarmDisabled | CCF6 | CCF6 | 0 |
| wJoyIgnore | CD6B | CD6B | 0 |
| wBattleResult | CF0B | CF0B | 0 |
| wPlayerHPBarColor | CF1D | CF1C | -1 |
| everything else used in the draft | | | -1 |

**CGB WRAM banking:** the emulator maps $D000-$DFFF linearly onto the first 4 KiB after bank 0 of the
exported 32 KiB, i.e. WRAM bank 1. pokeyellow.sym has no symbols in WRAMX banks 2-7 (every WRAM symbol is
`00:`), so every address in this draft is in bank 0 or bank 1 and readable.

## Every address found (Yellow)

| Symbol | Addr | Size | Meaning | In draft |
|---|---|---|---|---|
| wChannelSoundIDs (CHAN1) | C026 | 1 | song on music channel 1 | `music` |
| wAudioROMBank | C0EF | 1 | $02, $08 (battle), $1F, $20 (Yellow's 4th audio bank) | `music_bank`, `battle_music` |
| wLastMusicSoundID | CFC9 | 1 | unreliable per wram.asm | no |
| wPlayerHPBarColor / wEnemyHPBarColor | CF1C / CF1D | 1 | 0 green 1 yellow 2 red, in battle | `player_hp_bar` |
| wEnemyMonHP | CFE5 | 2 BE | | no |
| wBattleMonHP | D014 | 2 BE | | no |
| wTrainerClass | D030 | 1 | | `trainer_class` |
| wIsInBattle | D056 | 1 | 0/1/2, $FF lost | `battle`, `whited_out` |
| wCurOpponent | D058 | 1 | species / class+200 | `battle_opponent`, `battle_category` |
| wBattleType | D059 | 1 | 0 normal, 1 old man, 2 safari, 3 run, 4 pikachu | `battle_type` |
| wGymLeaderNo | D05B | 1 | | no |
| wLowHealthAlarm | D082 | 1 | bit 7 alarm | `low_hp_alarm` |
| wOutOfBattleBlackout | D12C | 1 | UNION, see Red notes | no |
| wPartyCount | D162 | 1 | | `party_count` |
| wPartySpecies | D163 | 7 | | no |
| wPartyMon1Species | D16A | 1 | | `lead_species` |
| wPartyMon1HP | D16B | 2 BE | | `lead_hp`, `lead_hp_low`, `lead_fainted` |
| wPartyMon1Status | D16E | 1 | | no |
| wPartyMon1Level | D18B | 1 | | `lead_level` |
| wPartyMon1MaxHP | D18C | 2 BE | | `lead_max_hp` |
| wPokedexOwned | D2F6-D308 | 19 | | `dex_owned_*` |
| wPokedexSeen | D309 | 19 | | no |
| wPlayerMoney | D346 | 3 BE BCD | | `money` |
| wOptions | D354 | 1 | (Yellow adds sound mode bits 4-5) | no |
| wObtainedBadges | D355 | 1 | | `badges`, `badge_bits` |
| wMapMusicSoundID / ROMBank | D35A / D35B | 2 | | `map_music` |
| wCurMap | D35D | 1 | 249 maps (adds SUMMER_BEACH_HOUSE) | `location` |
| wLastMap | D364 | 1 | | `last_outdoor_map` |
| wCurMapTileset | D366 | 1 | 25 tilesets (adds BEACH_HOUSE) | `tileset` |
| wPikachuHappiness | D46F | 1 | 0-255 | `pikachu_happiness` |
| wPikachuMood | D470 | 1 | $80 neutral, higher happier | `pikachu_mood` |
| wPikachuSpawnStateFlags | D471 | 1 | Pikachu following state | no (meaning not documented) |
| wPlayerState | D472 | 1 | PLAYER_NORMAL/SURF/SURF_PIKA per ram_constants.asm | no; constants exist but I did not trace the writes |
| wNumHoFTeams | D5A1 | 1 | | `hall_of_fame_teams` |
| wPlayerCoins | D5A3 | 2 BE BCD | | `coins` |
| wWalkBikeSurfState | D6FF | 1 | 0 walk, 1 bike, 2 surf | `walk_state`, `surfing`, `biking` |
| wSafariSteps | D70C | 2 | | no |
| wStatusFlags4 | D72D | 1 | | no |
| wElite4Flags | D733 | 1 | bit 1 started | `elite_four_started` |
| wEventFlags | D746.. | | | no |
| hJoyHeld | FFB4 | 1 | | unreadable: hram |
| hDexRatingNumMonsOwned | FFDC | 1 | owned count, only during the dex rating | unreadable: hram |

## Yellow-specific differences

- **Audio bank $20** (AUDIO_4) holds surfing_pikachu ($99), meet_jessie_james ($9C), yellow_unused_song ($9F),
  gb_printer ($A3). MUSIC_INTRO_BATTLE is replaced by yellow_intro ($DC), and the AUDIO_3 songs after it are
  shifted by one id compared with Red, so **the music tables differ between the two drafts**.
- Song-id collisions on `music` in Yellow: $C3 cities1/title_screen, $C7 cities2/credits,
  $CA celadon/hall_of_fame, $CD cinnabar/oaks_lab, $D0 vermilion/jigglypuff_song,
  $EB routes1/cinnabar_mansion, $EF routes2/pokemon_tower, $F3 routes3/final_battle,
  $FB indigo_plateau/meet_male_trainer. In Yellow wild_battle ($F0), defeated_* and gym_leader_battle are
  unique, so `music == wild_battle` works directly here (it does not in Red).
- `battle_type` gains 3 = run and 4 = pikachu (the scripted catch in the intro).
- Trainer classes are the same table as Red; Jessie & James use the ROCKET class, so they show as
  `battle_category == trainer`, `battle_opponent == trainer_rocket`.

## Trigger ideas (Yellow)

1. **Pikachu mood lights**: `pikachu_happiness` thresholds (e.g. `gt: 200` happy, `lt: 50` unhappy) → warm
   yellow glow vs a cooler colour. Needs a flag state with `when: { gt: 200 }` added once a threshold is chosen.
2. Gym leader / legendary / champion battle scenes via `battle_category`, as in Red.
3. `music == surfing_pikachu` (unique id $99) → beach scene.
4. `music == meet_jessie_james` ($9C, unique) → Team Rocket alert.
5. `low_hp_alarm`, `whited_out`, badge count up, as in Red.

## Not found / gaps

Same as Red (dex count spread over five states, no ratio-based HP, poison blackout not flagged, no clean
"menu open" byte), plus:
- wPikachuSpawnStateFlags and wPlayerState meanings were not traced through the code; left out.
- Happiness thresholds the game uses for Pikachu's expressions (engine/pikachu/pikachu_emotions.asm) were
  downloaded but not tabulated; bindings should start from raw numbers.
- No live-session verification.
