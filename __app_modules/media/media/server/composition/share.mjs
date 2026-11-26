/**
 * Media's part of the share router: a shared video link is fetched to the
 * media mount's temp folder and played on the target screen.
 *
 * The one place that names the concrete sources (YouTube) and the tools
 * (yt-dlp). Everything above takes ports.
 *
 * Reference: __docs/reference/core/share.md
 */
import { YtDlpAdapter } from '../adapters/YtDlpAdapter.mjs';
import { YouTubeSharedVideoSource } from '#adapters/content/media/youtube/YouTubeSharedVideoSource.mjs';
import { ShareTempStore } from '#adapters/content/media/share/ShareTempStore.mjs';
import { ShareContentSource } from '#adapters/content/media/share/ShareContentSource.mjs';
import { ShareJobs } from '../application/share/ShareJobs.mjs';
import { PlaySharedVideo } from '../application/share/PlaySharedVideo.mjs';
import { provenancePolicy } from './provenance.mjs';

/** A fetched file lives this long unless its job is still in memory. */
export const SHARE_TEMP_MAX_AGE_MS = 6 * 3600_000;
const SWEEP_EVERY_MS = 3600_000;

/**
 * @param {object} deps
 * @param {object} deps.configService
 * @param {object} deps.contentRegistry - the `share:` source is registered into it
 * @param {{ load(deviceId, query): Promise<object>, stop(deviceId): Promise }} deps.screens
 * @param {(username: string, message: { title: string, body: string }) => Promise} [deps.notify]
 * @returns {{ handler: PlaySharedVideo, stop(): void }}
 */
export function createMediaShare({ configService, contentRegistry, screens, notify, rootLogger }) {
  const logger = rootLogger.child({ module: 'share-video' });
  const jobs = new ShareJobs();
  const temp = new ShareTempStore({ mediaDir: configService.getMediaDir(), logger });
  const downloader = new YtDlpAdapter({ logger });

  // The scene's logo and line colour come from the provenance config's services.
  const presentation = (provider) => {
    if (!provider) return null;
    let accent = null;
    try { accent = provenancePolicy(configService.getHouseholdAppConfig(null, 'provenance')).services?.accents?.[provider] ?? null; } catch { accent = null; }
    return { provider, logo: `/api/v1/provenance/logo/${provider}`, accent };
  };

  const handler = new PlaySharedVideo({
    jobs,
    sources: [new YouTubeSharedVideoSource({ downloader })],
    screens,
    notify,
    filePathFor: (id) => temp.filePathFor(id),
    presentation,
    logger,
    schedule: (fn, ms) => setTimeout(fn, ms).unref?.(),
  });

  contentRegistry.register(
    new ShareContentSource({ jobs, relativePathFor: (id) => temp.relativePathFor(id) }),
    { category: 'media', provider: 'share' },
  );

  const sweep = () => {
    try { temp.sweep({ maxAgeMs: SHARE_TEMP_MAX_AGE_MS, keepJobIds: jobs.liveFiles() }); } catch (error) {
      logger.warn('share.temp.sweep-failed', { error: error.message });
    }
  };
  sweep();
  const timer = setInterval(sweep, SWEEP_EVERY_MS);
  timer.unref?.();

  return { handler, stop: () => clearInterval(timer) };
}
