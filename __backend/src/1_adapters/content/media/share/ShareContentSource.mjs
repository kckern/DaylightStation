/**
 * `share:<jobId>` content source — a video shared from the phone, as a
 * playable item served from the share temp folder.
 *
 * The item exists from the moment of the share, while the file is still being
 * fetched: the screen resolves the id into a queue before its Player mounts, and
 * an empty queue would end the play there. The screen's intro then holds the
 * play request until the job is ready (see PlaySharedVideo), so the media URL is
 * only used once the file is in. A failed or unknown job is no item.
 *
 * The item is `ephemeral`: no playhead, completion or media-server session is
 * kept for it (RecordPlaybackProgress).
 *
 * Reference: __docs/reference/core/share.md
 */
import { PlayableItem } from "../../../../../../__capabilities/content-catalog/server/items.mjs";

export class ShareContentSource {
  #jobs; #relativePathFor; #streamPrefix;

  /**
   * @param {{ get(id: string): object|null }} deps.jobs - ShareJobs
   * @param {(jobId: string) => string} deps.relativePathFor - media-relative path of a job's file
   */
  constructor({ jobs, relativePathFor, streamPrefix = '/api/v1/proxy/media/stream' }) {
    this.#jobs = jobs;
    this.#relativePathFor = relativePathFor;
    this.#streamPrefix = streamPrefix;
  }

  get source() { return 'share'; }
  get prefixes() { return [{ prefix: 'share' }]; }
  getCapabilities() { return ['playable']; }

  async getItem(id) {
    const jobId = String(id ?? '').replace(/^share:/, '').trim();
    const job = this.#jobs.get(jobId);
    if (!job || job.state === 'failed') return null;
    return new PlayableItem({
      id: `share:${job.id}`,
      source: 'share',
      title: job.title || 'Shared video',
      type: 'video',
      mediaType: 'video',
      mediaUrl: `${this.#streamPrefix}/${encodeURIComponent(this.#relativePathFor(job.id))}`,
      duration: job.duration ?? null,
      resumable: false,
      metadata: { contentFormat: 'video', ephemeral: true, provider: job.provider, shareState: job.state },
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
