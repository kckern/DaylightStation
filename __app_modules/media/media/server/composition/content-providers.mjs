import { HttpClient } from "#system/services/HttpClient.mjs";
import { FreshVideoAdapter } from "../adapters/providers/freshvideo/FreshVideoAdapter.mjs";
import { StreamAdapter } from "../../../../../__capabilities/playback/server/adapters/stream/StreamAdapter.mjs";
import { YouTubeContentSource } from "#adapters/content/media/youtube/YouTubeContentSource.mjs";
import { YouTubeAdapter } from "#adapters/content/media/youtube/YouTubeAdapter.mjs";
import { PlexLiveTvLineup } from "#adapters/content/media/plex-live/PlexLiveTvLineup.mjs";
import { PlexLiveTvContentSource } from "#adapters/content/media/plex-live/PlexLiveTvContentSource.mjs";
import { IframeStreamResolver } from "../../../../../__capabilities/playback/server/adapters/stream/resolvers/IframeStreamResolver.mjs";
import { ScrapeStreamResolver } from "../../../../../__capabilities/playback/server/adapters/stream/resolvers/ScrapeStreamResolver.mjs";
import { YtDlpStreamResolver } from "../../../../../__capabilities/playback/server/adapters/stream/resolvers/YtDlpStreamResolver.mjs";
import { StreamProfile } from "../../../../../__capabilities/content-catalog/server/domain/value-objects/StreamProfile.mjs";
import { YtDlpAdapter } from "../adapters/YtDlpAdapter.mjs";
import freshvideoManifest from "../adapters/providers/freshvideo/manifest.mjs";
import streamManifest from "../../../../../__capabilities/playback/server/adapters/stream/manifest.mjs";

export function registerFreshVideoProvider({ registry, config, mediaProgressMemory }) {
if (config.mediaBasePath) {
    const fileAdapter = registry.get('files');
    if (fileAdapter) {
      registry.register(
        new FreshVideoAdapter({ fileAdapter, mediaProgressMemory }),
        { category: freshvideoManifest.capability, provider: freshvideoManifest.provider }
      );
    }
  }
}
export function registerOnlineVideoProviders({ registry, deps }) {
{
    const logger = deps.logger || console;
    const configService = deps.configService || null;
    const rawProfiles = configService?.getStreamingProfiles?.() || [];
    const profiles = [];
    for (const raw of rawProfiles) {
      try { profiles.push(new StreamProfile(raw)); }
      catch (e) { logger.warn?.('stream.profile.invalid', { name: raw?.name, error: e.message }); }
    }
    const ytDlpAdapter = new YtDlpAdapter({ logger });
    const resolvers = [
      new ScrapeStreamResolver({ logger }),
      new YtDlpStreamResolver({ ytDlpAdapter, logger }),
      new IframeStreamResolver(),
    ];
    const streamAdapter = new StreamAdapter({ resolvers, profiles, fallbackStrategy: 'ytdlp', logger });
    registry.register(
      streamAdapter,
      { category: streamManifest.capability, provider: streamManifest.provider }
    );

    // Register `youtube:<videoId>` content source — routing-safe published
    // identity for YouTube. Cascades Piped → stream (yt-dlp) → iframe embed.
    const pipedHost = configService?.resolveServiceUrl?.('piped') || null;
    const pipedAdapter = pipedHost
      ? new YouTubeAdapter({
          host: pipedHost,
          httpClient: new HttpClient({ logger }),
          logger: logger.child?.({ module: 'youtube-adapter' }) || logger,
        })
      : null;
    registry.register(
      new YouTubeContentSource({ pipedAdapter, streamAdapter, logger }),
      { category: 'media', provider: 'youtube' }
    );
  }
}

/**
 * `plex-live:<slug>` — Plex's free live TV channels (watch.plex.tv/live-tv),
 * read from plex.tv with the media library's account token and played through
 * the `plex-live` proxy. Skipped when there is no Plex token.
 */
export function registerPlexLiveTvProvider({ registry, config, deps }) {
  const token = config.plex?.token;
  if (!token) return;
  const logger = deps.logger || console;
  const lineup = new PlexLiveTvLineup({
    token,
    httpClient: new HttpClient({ logger }),
    logger: logger.child?.({ module: 'plex-live' }) || logger,
  });
  registry.register(
    new PlexLiveTvContentSource({ lineup, logger: logger.child?.({ module: 'plex-live' }) || logger }),
    { category: 'media', provider: 'plex-live' }
  );
}
