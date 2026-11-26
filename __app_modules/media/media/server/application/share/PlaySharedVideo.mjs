/**
 * PlaySharedVideo — the share router's handler for a video link: fetch the
 * video to temp storage and play it on the target screen, nothing kept.
 *
 * Which service a link belongs to is the sources' business (ISharedVideoSource
 * adapters); this use case only asks each one whether it recognises the link.
 *
 * The screen is told to play `share:<jobId>` at once. Its intro (the
 * provider's provenance scene) holds the play request and follows the real
 * download (GET /api/v1/share/jobs/:id), so the room sees it connecting from
 * the moment of the share. When the file is in, the intro lets the Player
 * fetch play info (the `share:` content source) and the lines meet as the
 * video starts.
 *
 * A failure (the fetch, or the screen refusing the load) marks the job failed:
 * the scene shows it, the screen is stopped after `failureHoldMs`, and the
 * person who shared gets a notification saying what happened.
 *
 * Ports (all injected):
 *   sources: ISharedVideoSource[]
 *   screens.load(deviceId, query) -> Promise<{ ok }>;  screens.stop(deviceId) -> Promise
 *   notify(username, { title, body }) -> Promise
 *   filePathFor(jobId) -> absolute .mp4 path in the share temp folder
 *   presentation(provider) -> { provider, logo, accent } for the scene, or null
 *   schedule(fn, ms) -> run fn once after ms (the composition's timer)
 *
 * Reference: __docs/reference/core/share.md
 */
import { isSharedVideoSource } from './ports/ISharedVideoSource.mjs';

export const SHARE_FAILURE_HOLD_MS = 8000;

export class PlaySharedVideo {
  #jobs; #sources; #screens; #notify; #filePathFor; #presentation; #logger; #maxHeight; #failureHoldMs; #schedule;

  constructor({
    jobs, sources = [], screens, notify = async () => {}, filePathFor, presentation = () => null,
    logger = console, maxHeight = 1080, failureHoldMs = SHARE_FAILURE_HOLD_MS, schedule,
  }) {
    if (!jobs || !screens?.load || typeof filePathFor !== 'function' || typeof schedule !== 'function') {
      throw new Error('PlaySharedVideo requires jobs, screens, filePathFor and schedule');
    }
    if (!sources.every(isSharedVideoSource)) throw new Error('PlaySharedVideo sources must be ISharedVideoSource');
    this.#jobs = jobs;
    this.#sources = sources;
    this.#screens = screens;
    this.#notify = notify;
    this.#filePathFor = filePathFor;
    this.#presentation = presentation;
    this.#logger = logger;
    this.#maxHeight = maxHeight;
    this.#failureHoldMs = failureHoldMs;
    this.#schedule = schedule;
  }

  get kind() { return 'video'; }

  #recognize(url) {
    for (const source of this.#sources) {
      const found = source.recognize(url);
      if (found) return { source, ...found };
    }
    return null;
  }

  matches(url) { return this.#recognize(url) !== null; }

  /**
   * Start one share. Returns at once; the fetch and the screen run on.
   * @returns {{ kind: 'video', provider: string, jobId: string, target: string }}
   */
  accept({ url, target, username = null }) {
    const found = this.#recognize(url);
    if (!found) throw new Error('not a video link any source recognises');
    const job = this.#jobs.create({ provider: found.provider, sourceId: found.sourceId, target, username });
    this.#logger.info?.('share.video.accepted', { jobId: job.id, provider: found.provider, sourceId: found.sourceId, target });
    void this.#fetch(job, found.source);
    void this.#load(job);
    return { kind: 'video', provider: found.provider, jobId: job.id, target };
  }

  /** What the screen's intro polls. null for an unknown or expired job. */
  status(jobId) {
    const job = this.#jobs.get(jobId);
    if (!job) return null;
    return {
      id: job.id,
      kind: 'video',
      state: job.state,
      progress: job.progress,
      title: job.title,
      failed: job.state === 'failed' ? job.error : null,
      provenance: this.#presentation(job.provider),
    };
  }

  async #fetch(job, source) {
    const startedAt = Date.now();
    let lastLogged = 0;
    try {
      const result = await source.fetch(job.sourceId, {
        outputPath: this.#filePathFor(job.id),
        maxHeight: this.#maxHeight,
        onProgress: (f) => {
          this.#jobs.progress(job.id, f);
          if (f - lastLogged >= 0.25) {
            lastLogged = f;
            this.#logger.debug?.('share.video.progress', { jobId: job.id, progress: Number(f.toFixed(2)) });
          }
        },
      });
      if (result?.kind === 'downloaded') {
        this.#jobs.ready(job.id, { filePath: result.filePath, title: result.title, duration: result.duration });
        this.#logger.info?.('share.video.ready', { jobId: job.id, ms: Date.now() - startedAt, duration: result.duration });
        return;
      }
      this.#failed(job, result?.error || 'fetch failed', 'fetch');
    } catch (error) {
      this.#failed(job, error.message, 'fetch');
    }
  }

  async #load(job) {
    try {
      const result = await this.#screens.load(job.target, { play: `share:${job.id}` });
      if (result && result.ok === false) {
        this.#failed(job, result.error || `the screen did not start (${result.failedStep || 'load'})`, 'screen');
        return;
      }
      this.#logger.info?.('share.video.screen-loaded', { jobId: job.id, target: job.target });
    } catch (error) {
      this.#failed(job, error.message, 'screen');
    }
  }

  #failed(job, error, stage) {
    const before = this.#jobs.get(job.id);
    if (!before || before.state === 'failed') return;
    this.#jobs.fail(job.id, error);
    this.#logger.warn?.('share.video.failed', { jobId: job.id, stage, error: String(error).slice(0, 200) });
    // The scene shows the failure for a moment, then the screen lets go.
    if (stage === 'fetch') {
      this.#schedule(() => {
        Promise.resolve(this.#screens.stop?.(job.target)).catch((e) => {
          this.#logger.warn?.('share.video.stop-failed', { jobId: job.id, error: e.message });
        });
      }, this.#failureHoldMs);
    }
    if (job.username) {
      const body = stage === 'screen'
        ? 'The screen did not start, so the shared video was not played.'
        : 'The shared video could not be fetched, so it was not played.';
      Promise.resolve(this.#notify(job.username, { title: 'Share did not play', body })).catch((e) => {
        this.#logger.warn?.('share.video.notify-failed', { jobId: job.id, error: e.message });
      });
    }
  }
}

export default PlaySharedVideo;
