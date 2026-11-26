/**
 * Media's part of the share router: a shared video link is fetched and played
 * on the target screen.
 *
 * The one place that names the concrete source (YouTube) and the fetchers:
 *   1. the ytdlp-fetch service (VPN, PO tokens; `services.ytdlp_fetch` or
 *      YTDLP_FETCH_URL), when configured
 *   2. the app's own yt-dlp, into container temp storage (never the media
 *      mount, which is a synced folder)
 *   3. when neither fetches it: the source's own stream (`youtube:<id>`)
 * Everything above takes ports.
 *
 * Reference: __docs/reference/core/share.md
 */
import { YtDlpAdapter } from '../adapters/YtDlpAdapter.mjs';
import { YouTubeSharedVideoSource } from '#adapters/content/media/youtube/YouTubeSharedVideoSource.mjs';
import { ShareContentSource } from '#adapters/content/media/share/ShareContentSource.mjs';
import { YtDlpFetchServiceAdapter } from '#adapters/video/YtDlpFetchServiceAdapter.mjs';
import { LocalVideoFetcher } from '#adapters/video/LocalVideoFetcher.mjs';
import { FailoverVideoFetcher } from '#adapters/video/FailoverVideoFetcher.mjs';
import { ShareJobs } from '../application/share/ShareJobs.mjs';
import { PlaySharedVideo } from '../application/share/PlaySharedVideo.mjs';
import { provenancePolicy } from './provenance.mjs';

/** Container-local: not a mount, so not synced, and gone with the container. */
export const SHARE_LOCAL_DIR = '/tmp/daylight-share';
/** A locally fetched file lives this long. */
export const SHARE_TEMP_MAX_AGE_MS = 6 * 3600_000;
const SWEEP_EVERY_MS = 3600_000;

function fetchServiceUrl(configService, env) {
  let url = null;
  try { url = configService.resolveServiceUrl?.('ytdlp_fetch') || null; } catch { url = null; }
  return url || env.YTDLP_FETCH_URL || null;
}

/**
 * @param {object} deps
 * @param {object} deps.configService
 * @param {object} deps.contentRegistry - the `share:` source is registered into it
 * @param {{ load(deviceId, query): Promise<object>, stop(deviceId): Promise }} deps.screens
 * @param {(username: string, message: { title: string, body: string }) => Promise} [deps.notify]
 * @param {object} [deps.env] - process environment (YTDLP_FETCH_URL, SHARE_LOCAL_DIR)
 * @returns {{ handler: PlaySharedVideo, fetchService: YtDlpFetchServiceAdapter|null, stop(): void }}
 */
export function createMediaShare({ configService, contentRegistry, screens, notify, rootLogger, env = {} }) {
  const logger = rootLogger.child({ module: 'share-video' });

  const serviceUrl = fetchServiceUrl(configService, env);
  const fetchService = serviceUrl ? new YtDlpFetchServiceAdapter({ baseUrl: serviceUrl, logger }) : null;
  const local = new LocalVideoFetcher({
    downloader: new YtDlpAdapter({ logger }),
    dir: env.SHARE_LOCAL_DIR || SHARE_LOCAL_DIR,
    logger,
  });
  const fetcher = new FailoverVideoFetcher({ fetchers: [fetchService, local], logger });
  logger.info('share.fetchers', { fetchers: fetcher.names, service: serviceUrl ? 'configured' : 'none' });

  // The scene's logo and line colour come from the provenance config's services.
  const presentation = (provider) => {
    if (!provider) return null;
    let accent = null;
    try { accent = provenancePolicy(configService.getHouseholdAppConfig(null, 'provenance')).services?.accents?.[provider] ?? null; } catch { accent = null; }
    return { provider, logo: `/api/v1/provenance/logo/${provider}`, accent };
  };

  const handler = new PlaySharedVideo({
    jobs: new ShareJobs(),
    sources: [new YouTubeSharedVideoSource({ fetcher })],
    screens,
    notify,
    presentation,
    logger,
    schedule: (fn, ms) => setTimeout(fn, ms).unref?.(),
  });

  // The streaming fallback plays the catalog's own item for the stream content id.
  const resolveItem = async (contentId) => {
    const found = contentRegistry.resolve?.(contentId);
    return found?.adapter?.getItem ? found.adapter.getItem(contentId) : null;
  };
  contentRegistry.register(
    new ShareContentSource({ jobs: handler, resolveItem, logger }),
    { category: 'media', provider: 'share' },
  );

  const sweep = () => {
    try { local.sweep({ maxAgeMs: SHARE_TEMP_MAX_AGE_MS }); } catch (error) {
      logger.warn('share.temp.sweep-failed', { error: error.message });
    }
  };
  sweep();
  const timer = setInterval(sweep, SWEEP_EVERY_MS);
  timer.unref?.();

  return { handler, fetchService, stop: () => clearInterval(timer) };
}
