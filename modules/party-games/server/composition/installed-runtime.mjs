import { PartyGamesConfigProjection } from '../adapters/config/PartyGamesConfigProjection.mjs';
import { YamlGamingDefinitionStore } from "../adapters/persistence/YamlGamingDefinitionStore.mjs";
import { configService } from "#system/config/index.mjs";
import { join } from "path";
import { YamlGamingExperienceManifestStore } from "../../../../capabilities/gaming/server/adapters/persistence/YamlGamingExperienceManifestStore.mjs";
import { PartyGamesCatalog } from "../application/usecases/PartyGamesCatalog.mjs";
import { userService } from "#composition/runtimePersistence.mjs";
import { publicResourceUrl } from "#api/v1/presenters/publicResourceRefs.mjs";
import { LaserPrinterAdapter } from "#adapters/hardware/laser-printer/index.mjs";
import { createGamingApiModule } from "./gamingApi.mjs";
import { scopedGateway } from "#apps/common/ports/IAIGateway.mjs";
import { broadcastEvent } from "#composition/bootstrap.mjs";
import { YamlGamingAssetCatalog } from "../../../../capabilities/gaming/server/adapters/persistence/YamlGamingAssetCatalog.mjs";
import { createGamingRouter } from "../api/gaming.mjs";
import { GamingMediaService } from "../application/GamingMediaService.mjs";
import { FilesystemGamingMediaRepository } from "../adapters/FilesystemGamingMediaRepository.mjs";

export function createPartyGamesCatalogRuntime({ contentPath, rootLogger }) {
  const gamingDefinitionStore = new YamlGamingDefinitionStore({
    definitionsDir: configService.getHouseholdPath('gaming/games'),
    archiveDir: configService.getHouseholdPath('gaming/definitions'),
    contentGamesDir: join(contentPath, 'games'),
    logger: rootLogger.child({ module: 'gaming-definitions' }),
  });
  const gamingManifestStore = new YamlGamingExperienceManifestStore({
    manifestsDir: configService.getHouseholdPath('gaming/manifests'),
  });
  const partyGamesCatalog = new PartyGamesCatalog({
    configProjection: new PartyGamesConfigProjection({ configService }),
    userService,
    definitionStore: gamingDefinitionStore,
    manifestStore: gamingManifestStore,
    resourcePresenter: publicResourceUrl,
    logger: rootLogger.child({ module: 'party-games' }),
  });
  const partyGamesProfile = partyGamesCatalog.getConfig();
  const partyGamesPrinterAdapter = partyGamesProfile.printing.host ? new LaserPrinterAdapter({
    host: partyGamesProfile.printing.host,
    port: partyGamesProfile.printing.port,
    logger: rootLogger.child({ module: 'gaming-print' }),
  }) : null;
  const partyGamesPrinter = partyGamesPrinterAdapter ? {
    print: (pdf, { sessionId }) => partyGamesPrinterAdapter.printPdf(pdf, { jobName: `Party Games host packet — ${sessionId}`, user: 'party-games', copies: 1 }),
  } : null;

  return { gamingDefinitionStore, gamingManifestStore, partyGamesCatalog, partyGamesProfile, partyGamesPrinter };
}

export function createPartyGamesSessionRuntime({ gamingDefinitionStore, gamingManifestStore, partyGamesCatalog, partyGamesProfile, sharedAiGateway, partyGamesPrinter, rootLogger, mediaBasePath }) {
  // One Gaming authority serves every experience.
  const gamingModule = createGamingApiModule({
    definitionStore: gamingDefinitionStore,
    manifestStore: gamingManifestStore,
    snapshotsDir: configService.getHouseholdPath('gaming/snapshots'),
    journalsDir: configService.getHouseholdPath('gaming/journals'),
    effectsDir: configService.getHouseholdPath('gaming/effects'),
    drawingCheckpointsDir: configService.getHouseholdPath('gaming/drawing-checkpoints'),
    historyDir: configService.getHouseholdPath('gaming/history'),
    partyGamesCatalog,
    aiGateway: partyGamesProfile.ai.commentary || partyGamesProfile.ai.advisory_judgment ? scopedGateway(sharedAiGateway, { app: 'gaming' }) : null,
    aiConfig: partyGamesProfile.ai,
    printer: partyGamesPrinter,
    broadcastEvent,
    logger: rootLogger.child({ module: 'gaming-runtime' }),
    autoPrint: partyGamesProfile.printing.auto_print_once_per_session,
  });
  const gamingAssetCatalog = new YamlGamingAssetCatalog({
    catalogsDir: join(mediaBasePath, 'games/_common/catalog'),
    assetRoot: join(mediaBasePath, 'games/_common'),
  });
  return { gamingModule, gamingAssetCatalog };
}

export function createPartyGamesHttpRuntime({ gamingModule, gamingAssetCatalog, mediaBasePath, contentPath, rootLogger }) {
  const gamingRouter = createGamingRouter({
    gamingApplication: gamingModule.gamingApplication,
    gamingDiagnostics: gamingModule.gamingDiagnostics,
    gamingMediaService: new GamingMediaService({ repository: new FilesystemGamingMediaRepository({
      assetCatalog: gamingAssetCatalog,
      partyMediaRoot: join(mediaBasePath, 'games', 'party-games'),
      contentGamesDir: join(contentPath, 'games'),
      imageArchiveDir: configService.getHouseholdPath('gaming/definitions/images'),
    }) }),
    broadcastEvent,
    logger: rootLogger.child({ module: 'gaming-api' }),
  });
  return { gamingRouter };
}
