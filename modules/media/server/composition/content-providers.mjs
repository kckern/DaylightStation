import { HttpClient } from "#system/services/HttpClient.mjs";
import { FreshVideoAdapter } from "../adapters/providers/freshvideo/FreshVideoAdapter.mjs";
import { StreamAdapter } from "../../../../capabilities/playback/server/adapters/stream/StreamAdapter.mjs";
import { YouTubeContentSource } from "#adapters/content/media/youtube/YouTubeContentSource.mjs";
import { YouTubeAdapter } from "#adapters/content/media/youtube/YouTubeAdapter.mjs";
import { IframeStreamResolver } from "../../../../capabilities/playback/server/adapters/stream/resolvers/IframeStreamResolver.mjs";
import { ScrapeStreamResolver } from "../../../../capabilities/playback/server/adapters/stream/resolvers/ScrapeStreamResolver.mjs";
import { YtDlpStreamResolver } from "../../../../capabilities/playback/server/adapters/stream/resolvers/YtDlpStreamResolver.mjs";
import { StreamProfile } from "../../../../capabilities/content-catalog/server/domain/value-objects/StreamProfile.mjs";
import { YtDlpAdapter } from "../adapters/YtDlpAdapter.mjs";
import freshvideoManifest from "../adapters/providers/freshvideo/manifest.mjs";
import streamManifest from "../../../../capabilities/playback/server/adapters/stream/manifest.mjs";

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
