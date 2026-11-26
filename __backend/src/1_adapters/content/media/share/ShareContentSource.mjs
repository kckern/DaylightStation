/**
 * `share:<jobId>` content source — a video shared from the phone, as a
 * playable item.
 *
 * The item exists from the moment of the share, while the video is still being
 * fetched: the screen resolves the id into a queue before its Player mounts,
 * and an empty queue would end the play there. The screen's intro holds the
 * play request until the job is ready (or streaming), so the media URL is only
 * used once there is something behind it. A failed or unknown job is no item.
 *
 *   downloading | ready  -> the fetched file, at GET /api/v1/share/jobs/<job>/media
 *   streaming            -> the item of the job's stream content id (the last
 *                           fallback: the source's own stream of the same video),
 *                           under the share's id
 *
 * The item is `ephemeral`: no playhead, completion or media-server session is
 * kept for it (RecordPlaybackProgress).
 *
 * Reference: __docs/reference/core/share.md
 */
import { PlayableItem } from "../../../../../../__capabilities/content-catalog/server/items.mjs";

export class ShareContentSource {
  #jobs; #resolveItem; #mediaPrefix; #logger;

  /**
   * @param {object} deps
   * @param {{ item(jobId: string): Promise<object|null> }} deps.jobs - the share handler (PlaySharedVideo)
   * @param {(contentId: string) => Promise<object|null>} [deps.resolveItem] - the catalog's item for a content id (for streaming)
   */
  constructor({ jobs, resolveItem = async () => null, mediaPrefix = '/api/v1/share/jobs', logger = console }) {
    this.#jobs = jobs;
    this.#resolveItem = resolveItem;
    this.#mediaPrefix = mediaPrefix;
    this.#logger = logger;
  }

  get source() { return 'share'; }
  get prefixes() { return [{ prefix: 'share' }]; }
  getCapabilities() { return ['playable']; }

  async getItem(id) {
    const jobId = String(id ?? '').replace(/^share:/, '').trim();
    const job = await this.#jobs.item(jobId);
    if (!job) return null;
    const base = {
      id: `share:${job.id}`,
      source: 'share',
      title: job.title || 'Shared video',
      type: 'video',
      duration: job.duration ?? null,
      resumable: false,
    };
    const metadata = { contentFormat: 'video', ephemeral: true, provider: job.provider, shareState: job.state };
    if (job.state === 'streaming' && job.streamContentId) {
      let stream = null;
      try { stream = await this.#resolveItem(job.streamContentId); } catch (error) {
        this.#logger.warn?.('share.stream.resolve-failed', { jobId: job.id, error: error.message });
      }
      if (!stream?.mediaUrl) return null;
      const format = stream.metadata?.contentFormat || stream.mediaType || 'video';
      return new PlayableItem({
        ...base,
        title: job.title || stream.title || base.title,
        duration: stream.duration ?? base.duration,
        mediaType: stream.mediaType || 'video',
        mediaUrl: stream.mediaUrl,
        metadata: { ...metadata, contentFormat: format, streamedFrom: job.streamContentId },
      });
    }
    return new PlayableItem({
      ...base,
      mediaType: 'video',
      mediaUrl: `${this.#mediaPrefix}/${job.id}/media`,
      metadata,
    });
  }

  async resolvePlayables(id) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }

  async getList() { return []; }
  async resolveSiblings() { return null; }
}

export default ShareContentSource;
