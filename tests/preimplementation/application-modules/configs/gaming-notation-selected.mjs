/** Fixed original gaming, Arcade, Piano-game and notation oracles; retain their native runners. */
export const gamingNotationVitest = [
  "frontend/src/modules/Gaming/architecture.test.js",
  "backend/src/3_applications/gaming/runtime/GamingApplication.test.mjs",
  "backend/src/3_applications/gaming/effects/GamingEffectService.casual.test.mjs",
  "backend/src/3_applications/gaming/usecases/PartyGamesCatalog.test.mjs",
  "backend/src/3_applications/gaming/usecases/AuthorizeArcadeGameSession.test.mjs",
  "backend/src/3_applications/gaming/usecases/EnforceArcadeGameBudget.test.mjs",
  "backend/src/3_applications/gaming/usecases/ReconcileArcadeGameSessions.test.mjs",
  "backend/src/3_applications/gaming/runtime/ArcadeGameObservationWatchdog.test.mjs",
  "backend/src/3_applications/piano-games/GameRivalryMemoryService.test.mjs",
  "shared/music/learningPrograms.test.mjs",
  "shared/music/musicXmlToNotes.test.mjs",
  "frontend/src/modules/MusicNotation/renderers/RimStaffRenderer.test.jsx",
  "frontend/src/modules/MusicNotation/roundtrip.test.js",
  "shared/gaming/kernel/kernel.test.mjs",
  "shared/gaming/kernel/authority.test.mjs",
  "shared/gaming/rulesets/card-battle/reducer.test.mjs",
  "cli/gaming-artifacts.cli.test.mjs"
];
export const gamingNotationNode = [
  "shared/gaming/assets.test.mjs",
  "backend/src/3_applications/piano-games/PianoGamesContainer.test.mjs",
  "backend/src/2_domains/gaming/entities/OpponentLadder.test.mjs",
  "backend/src/1_adapters/persistence/yaml/YamlPianoBoardGameDayStore.test.mjs",
  "shared/music/assessmentRecord.test.mjs",
  "shared/music/exerciseBank.test.mjs",
  "shared/music/midiToScore.test.mjs",
  "shared/gaming/rulesets/checkers/engine.test.mjs",
  "cli/gaming-assets.cli.test.mjs"
];

/** New meaningful factory/session/persistence coverage; never counted as old baseline. */
export const gamingSupplemental = [
  "modules/party-games/server/composition/gamingApi.test.mjs",
  "modules/party-games/server/application/runtime/GamingDiagnosticSessions.test.mjs",
  "modules/party-games/server/adapters/persistence/YamlGamingDefinitionStore.test.mjs",
  "modules/party-games/server/application/GamingMediaService.test.mjs",
  "modules/party-games/server/adapters/FilesystemGamingMediaRepository.test.mjs"
];
