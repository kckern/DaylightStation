import { createMediaRouter } from "../api/media.mjs";
import { MediaSurfaceConfigService } from "../application/MediaSurfaceConfigService.mjs";
import { MediaQueueEvents } from "#apps/events/RealtimePublications.mjs";
import { MediaQueue } from "../domain/entities/MediaQueue.mjs";
import path from "path";

export async function createMediaApiRuntime({ configService, mediaProgressMemory, contentServices, deviceLivenessService, playLedger, rootLogger, v1Routers, mediaServices, eventBus, loadOriginHints, contentRegistry, notificationStack, contentProxyService }) {
  // Household media memory — recent across screens, carry on with per-screen
  // spots, favourites, removal, watched marks (Media app P1). Reads progress
  // from the same media memory play/log writes; lists live beside the
  // household media queue. See __docs/reference/media/media-app-technical.md §2.4.
  let householdMediaMemory = null;
  {
    const { HouseholdMediaMemoryService } = await import("../application/HouseholdMediaMemoryService.mjs");
    const { LivenessNowPlayingReader } = await import("../application/LivenessNowPlayingReader.mjs");
    const { CompositeNowPlayingReader } = await import("../application/CompositeNowPlayingReader.mjs");
    const { YamlHouseholdMediaListsDatastore } = await import("../adapters/persistence/YamlHouseholdMediaListsDatastore.mjs");
    const { nowTs24 } = await import("#system/utils/index.mjs");
    const { ProgressWriteRuntime } = await import("#system/scheduling/ProgressWriteRuntime.mjs");
    householdMediaMemory = new HouseholdMediaMemoryService({
      progressMemory: mediaProgressMemory,
      listsStore: new YamlHouseholdMediaListsDatastore({ configService }),
      contentCatalog: contentServices.contentCatalog,
      markContentWatched: contentServices.markContentWatched,
      // Fleet device-state first, then play/log sessions — the only live view
      // of browsers and kiosks.
      nowPlaying: new CompositeNowPlayingReader([
        ...(deviceLivenessService ? [new LivenessNowPlayingReader({ livenessService: deviceLivenessService })] : []),
        ...(playLedger ? [{ list: () => playLedger.nowPlaying({ nowEpoch: Date.now() }) }] : []),
      ]),
      nowTimestamp: nowTs24,
      runtime: new ProgressWriteRuntime(),
      playLedger,
      // Continue listening (lookup spec §13): the threshold and the library kinds
      // that make an item a book or a talk, read per answer so a reload applies.
      continueConfig: () => configService.getHouseholdAppConfig?.(null, 'media')?.continue ?? null,
      libraryKinds: () => configService.getHouseholdAppConfig?.(null, 'media')?.play_on_demand?.library_kinds ?? null,
      logger: rootLogger.child({ module: 'household-media-memory' }),
    });
  }

  // Media queue management
  v1Routers.media = createMediaRouter({
    mediaQueueService: mediaServices.mediaQueueService,
    mediaSurfaceConfig: new MediaSurfaceConfigService({
      loadAppConfig: (householdId, app) => configService.getHouseholdAppConfig(householdId, app),
    }),
    contentIdResolver: contentServices.contentIdResolver,
    mediaQueueEvents: new MediaQueueEvents({ publish: (topic, payload) => eventBus.broadcast(topic, payload) }),
    createMediaQueue: (props) => new MediaQueue(props),
    householdMediaMemory,
    logger: rootLogger.child({ module: 'media-api' }),
  });

  // Household screens, routines, how playback started, played earlier and
  // suggestions — mounted on the media router (/api/v1/media/screens, ...).
  // See __docs/reference/media/media-app-technical.md §2.5–2.9.
  const mediaHouse = await (async () => {
    const { createMediaHouseModule } = await import("./mediaHouse.mjs");
    return createMediaHouseModule({
      configService,
      eventBus,
      livenessService: deviceLivenessService,
      playLedger,
      progressMemory: mediaProgressMemory,
      originHints: loadOriginHints,
      householdMediaMemory,
      plexAdapter: contentRegistry?.get?.('plex') ?? null,
      nowLocal: (await import("#system/utils/index.mjs")).nowTs24,
      logger: rootLogger,
    });
  })();
  v1Routers.media.use(mediaHouse.router);

  // Media source healing — when Plex refuses a file (the NAS zeroing modes,
  // 2026-09-28), the Player asks here, waits, and resumes. system config
  // media-source-heal.yml holds the host SSH target and the Plex→host path map
  // (not media.yml: that one is infrastructure and getAppConfig never serves it).
  // See __docs/reference/player/media-source-healing.md.
  {
    const { createMediaSourceRouter } = await import("../api/mediaSource.mjs");
    const { MediaSourceHealer } = await import("../application/MediaSourceHealer.mjs");
    const { createProxyRefusalHandler } = await import("../application/proxyRefusalTrigger.mjs");
    const { PlexSourceProbe } = await import("../adapters/plex/PlexSourceProbe.mjs");
    const { SshMediaHostHealer } = await import("../adapters/SshMediaHostHealer.mjs");
    const plexClient = contentRegistry?.get?.('plex')?.client ?? null;
    const sourceHealConfig = configService.getAppConfig('media-source-heal') || {};
    const healLogger = rootLogger.child({ module: 'media-source-heal' });
    // Key/known_hosts paths in the YAML are relative to the app root (the
    // data dir's parent), but the backend runs with cwd = __backend/, so ssh
    // resolved them against the wrong directory and every host heal failed
    // with "Identity file ... not accessible". Resolve them here.
    const appRoot = path.dirname(configService.getDataDir());
    const resolveFromAppRoot = (p) => (p && !path.isAbsolute(p) ? path.resolve(appRoot, p) : p);
    const hostConfig = { ...(sourceHealConfig.host || {}) };
    for (const key of ['privateKey', 'private_key', 'knownHostsPath', 'known_hosts_path']) {
      if (hostConfig[key]) hostConfig[key] = resolveFromAppRoot(hostConfig[key]);
    }
    const hostHealer = new SshMediaHostHealer(hostConfig, { logger: healLogger });
    const mediaSourceHealer = plexClient
      ? new MediaSourceHealer({
        sourceProbe: new PlexSourceProbe({ client: plexClient }),
        hostHealer: hostHealer.isConfigured() ? hostHealer : null,
        notifier: notificationStack?.notificationService ?? null,
        logger: healLogger,
        config: sourceHealConfig.timing || {},
      })
      : null;
    healLogger.info('media.source.heal.configured', {
      plex: Boolean(plexClient), hostHealer: hostHealer.isConfigured(),
    });
    v1Routers['media-source'] = createMediaSourceRouter({ mediaSourceHealer, logger: healLogger });

    // Heal from the server side too. Only the video Player asks
    // /media-source/check; menu music and other audio just skip a refused
    // track, so a ghosted file stayed unreadable for 4h+ on 2026-10-01
    // (garage menu music, Children's Music). When the proxy turns a part 404
    // into 503 source-unreadable, map the part back to its item and run the
    // same check (in-flight dedupe + host-heal cooldown live in the healer).
    const plexAdapter = contentRegistry?.get?.('plex') ?? null;
    if (mediaSourceHealer && typeof plexAdapter?.resolveRatingKeyForPath === 'function') {
      contentProxyService.onErrorReplaced(createProxyRefusalHandler({
        healer: mediaSourceHealer,
        resolveRatingKey: (refusedPath) => plexAdapter.resolveRatingKeyForPath(refusedPath),
        logger: healLogger,
      }));
    }
  }

  // Track extras for players: the loudness waveform + audio quality, and lyrics
  // (the source's own first, then LRCLIB unless media config `lyrics.lrclib: false`),
  // with looked-up lyrics cached under <data>/system/cache/lyrics.
  // See __docs/reference/media/media-app-technical.md (Track extras).
  {
    const { createTrackRouter } = await import("../api/track.mjs");
    const { TrackExtrasService } = await import("../application/TrackExtrasService.mjs");
    const { LrclibLyricsAdapter } = await import("../adapters/lyrics/LrclibLyricsAdapter.mjs");
    const { FileLyricsCache } = await import("../adapters/lyrics/FileLyricsCache.mjs");
    const trackLogger = rootLogger.child({ module: 'track-extras' });
    const trackExtras = new TrackExtrasService({
      registry: contentRegistry,
      lrclib: new LrclibLyricsAdapter(),
      cache: new FileLyricsCache({ dir: path.join(configService.getDataDir(), 'system', 'cache', 'lyrics') }),
      lrclibEnabled: () => (configService.getHouseholdAppConfig(undefined, 'media') || {})?.lyrics?.lrclib !== false,
      logger: trackLogger,
    });
    // Audiobook chapters: the file's own (Plex), else the same book in Audiobookshelf,
    // matched by folder + one file + length; cached under <data>/system/cache/chapters.
    let trackChapters = null;
    {
      const { TrackChaptersService } = await import("../application/TrackChaptersService.mjs");
      let books = null;
      const absHost = configService.resolveServiceUrl?.('audiobookshelf');
      const absAuth = configService.getHouseholdAuth?.('audiobookshelf');
      if (absHost && absAuth?.token) {
        const { default: axios } = await import('axios');
        const { AudiobookshelfClient } = await import("../../../../../__capabilities/content-catalog/server/adapters/providers/readable/audiobookshelf/AudiobookshelfClient.mjs");
        const { AudiobookshelfBooks } = await import("../adapters/chapters/AudiobookshelfBooks.mjs");
        books = new AudiobookshelfBooks({ client: new AudiobookshelfClient({ host: absHost, token: absAuth.token }, { httpClient: axios.create({ timeout: 8000 }) }) });
      }
      trackChapters = new TrackChaptersService({
        registry: contentRegistry,
        books,
        cache: new FileLyricsCache({ dir: path.join(configService.getDataDir(), 'system', 'cache', 'chapters') }),
        logger: trackLogger,
      });
    }
    v1Routers.track = createTrackRouter({ trackExtras, trackChapters, logger: trackLogger });
  }

  return { householdMediaMemory, mediaHouse };
}

/**
 * A player's queue saved as a household list (the phone's Queue → Save as playlist):
 * POST /api/v1/media/household/playlists on the media router. Mounted from the app once
 * the list management service exists (it is composed after the media runtime).
 */
export async function mountHouseholdPlaylists({ v1Routers, listManagementService, rootLogger }) {
  if (!v1Routers?.media || !listManagementService) return;
  const { createHouseholdPlaylistsRouter } = await import("../api/householdPlaylists.mjs");
  v1Routers.media.use(createHouseholdPlaylistsRouter({
    listManagementService,
    logger: rootLogger.child({ module: 'media-api' }),
  }));
}
