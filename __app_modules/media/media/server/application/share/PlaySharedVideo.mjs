/**
 * PlaySharedVideo — the share router's handler for a video link: fetch the
 * video and play it on the target screen, nothing kept.
 *
 * Which service a link belongs to, and how a video is fetched (a fetch service
 * over the VPN, then the app's own fetcher), is the sources' business
 * (ISharedVideoSource adapters). This use case owns what happens around it:
 *
 *   share  -> job (downloading), screen told to play `share:<job>` at once
 *   fetched            -> ready: the screen's intro lets the Player play the file
 *   not fetchable      -> streaming: the same video plays from the source's stream
 *                         (`streamContentId`), when the source has one and the video
 *                         is not simply unavailable (private, removed)
 *   no stream either   -> failed: the scene shows it and lets go, the screen is
 *                         stopped after `failureHoldMs`, the sharer is notified
 *   no progress for `stallMs` -> the fetch is cancelled and treated as not fetchable
 *   the screen will not start -> the fetch is cancelled, the sharer is notified
 *   app restarted      -> status/media/item adopt the job again from a source that
 *                         still holds the video; otherwise it is gone
 *
 * Ports (all injected):
 *   sources: ISharedVideoSource[]
 *   screens.load(deviceId, query) -> Promise<{ ok }>;  screens.stop(deviceId) -> Promise
 *   notify(username, { title, body }) -> Promise
 *   presentation(provider) -> { provider, logo, accent } for the scene, or null
 *   schedule(fn, ms) -> run fn once after ms (the composition's timer)
 *
 * Reference: __docs/reference/core/share.md
 */
import { isSharedVideoSource } from './ports/ISharedVideoSource.mjs';

export const SHARE_FAILURE_HOLD_MS = 8000;
/** No new bytes for this long and the fetch is given up (the fetchers have their own, shorter, deadlines). */
export const SHARE_STALL_MS = 150_000;

export class PlaySharedVideo {
  #jobs; #sources; #screens; #notify; #presentation; #logger; #maxHeight; #failureHoldMs; #stallMs; #schedule; #clock;
  #sourceOf = new Map();

  constructor({
    jobs, sources = [], screens, notify = async () => {}, presentation = () => null,
    logger = console, maxHeight = 1080, failureHoldMs = SHARE_FAILURE_HOLD_MS, stallMs = SHARE_STALL_MS,
    schedule, clock = Date.now,
  }) {
    if (!jobs || !screens?.load || typeof schedule !== 'function') {
      throw new Error('PlaySharedVideo requires jobs, screens and schedule');
    }
    if (!sources.every(isSharedVideoSource)) throw new Error('PlaySharedVideo sources must be ISharedVideoSource');
    this.#jobs = jobs;
    this.#sources = sources;
    this.#screens = screens;
    this.#notify = notify;
    this.#presentation = presentation;
    this.#logger = logger;
    this.#maxHeight = maxHeight;
    this.#failureHoldMs = failureHoldMs;
    this.#stallMs = stallMs;
    this.#schedule = schedule;
    this.#clock = clock;
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
    this.#sourceOf.set(job.id, found.source);
    this.#logger.info?.('share.video.accepted', { jobId: job.id, provider: found.provider, sourceId: found.sourceId, target });
    void this.#fetch(job, found.source);
    void this.#load(job, found.source);
    this.#watch(job.id);
    return { kind: 'video', provider: found.provider, jobId: job.id, target };
  }

  /** The job, adopted again from a source after a restart when one still holds its video. */
  async #job(jobId) {
    const job = this.#jobs.get(jobId);
    if (job) return job;
    for (const source of this.#sources) {
      let held = null;
      try { held = await source.stored?.(jobId); } catch (error) {
        this.#logger.warn?.('share.video.adopt-failed', { jobId, error: error.message });
      }
      if (held?.media) {
        this.#sourceOf.set(jobId, source);
        this.#logger.info?.('share.video.adopted', { jobId, provider: held.provider });
        return this.#jobs.adopt(jobId, held);
      }
    }
    return null;
  }

  /** What the screen's intro polls. null for an unknown or expired job. */
  async status(jobId) {
    const job = await this.#job(jobId);
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

  /** What the `share:` content source plays. null for an unknown or failed job. */
  async item(jobId) {
    const job = await this.#job(jobId);
    if (!job || job.state === 'failed') return null;
    return {
      id: job.id, state: job.state, title: job.title, duration: job.duration,
      provider: job.provider, streamContentId: job.streamContentId,
    };
  }

  /** The fetched video's opaque media resource, or null. */
  async media(jobId) {
    const job = await this.#job(jobId);
    return job?.state === 'ready' ? job.media : null;
  }

  async #fetch(job, source) {
    const startedAt = this.#clock();
    let lastLogged = 0;
    try {
      const result = await source.fetch(job.sourceId, {
        name: job.id,
        maxHeight: this.#maxHeight,
        onProgress: (f) => {
          this.#jobs.progress(job.id, f);
          if (f - lastLogged >= 0.25) {
            lastLogged = f;
            this.#logger.debug?.('share.video.progress', { jobId: job.id, progress: Number(f.toFixed(2)) });
          }
        },
        onAttempt: ({ fetcher, n }) => this.#logger.info?.('share.video.fetch-attempt', { jobId: job.id, fetcher, n }),
      });
      if (this.#jobs.get(job.id)?.state !== 'downloading') return;
      if (result?.kind === 'downloaded') {
        this.#jobs.ready(job.id, { media: result.media, title: result.title, duration: result.duration });
        this.#logger.info?.('share.video.ready', { jobId: job.id, ms: this.#clock() - startedAt, duration: result.duration });
        return;
      }
      if (result?.reason === 'cancelled') return;
      this.#notFetchable(job, source, result?.error || 'fetch failed', result?.reason || 'error');
    } catch (error) {
      if (this.#jobs.get(job.id)?.state === 'downloading') this.#notFetchable(job, source, error.message, 'error');
    }
  }

  /** The last fallback: play the source's stream of the same video, else fail. */
  #notFetchable(job, source, error, reason) {
    // A video the service itself refuses (private, removed) would only stream to its error page.
    const contentId = reason === 'unavailable' ? null : (source.streamContentId?.(job.sourceId) || null);
    if (contentId) {
      this.#jobs.stream(job.id, contentId, `${reason}: ${String(error).slice(0, 160)}`);
      this.#logger.warn?.('share.video.streaming', { jobId: job.id, reason, error: String(error).slice(0, 200) });
      return;
    }
    this.#failed(job, error, 'fetch');
  }

  /** The no-progress deadline, checked while the job downloads. */
  #watch(jobId) {
    const every = Math.max(1000, Math.round(this.#stallMs / 3));
    const check = () => {
      const job = this.#jobs.get(jobId);
      if (!job || job.state !== 'downloading') return;
      if (this.#clock() - job.progressAt >= this.#stallMs) {
        const source = this.#sourceOf.get(jobId);
        this.#logger.warn?.('share.video.stalled', { jobId, progress: job.progress, stallMs: this.#stallMs });
        Promise.resolve(source?.cancel?.(jobId)).catch(() => {});
        this.#notFetchable(job, source, `no progress for ${Math.round(this.#stallMs / 1000)}s`, 'stalled');
        return;
      }
      this.#schedule(check, every);
    };
    this.#schedule(check, every);
  }

  async #load(job, source) {
    try {
      const result = await this.#screens.load(job.target, { play: `share:${job.id}` });
      if (result && result.ok === false) {
        this.#failed(job, result.error || `the screen did not start (${result.failedStep || 'load'})`, 'screen');
        Promise.resolve(source?.cancel?.(job.id)).catch(() => {});
        return;
      }
      this.#logger.info?.('share.video.screen-loaded', { jobId: job.id, target: job.target });
    } catch (error) {
      this.#failed(job, error.message, 'screen');
      Promise.resolve(source?.cancel?.(job.id)).catch(() => {});
    }
  }

  #failed(job, error, stage) {
    const before = this.#jobs.get(job.id);
    if (!before || before.state === 'failed') return;
    this.#jobs.fail(job.id, error);
    this.#logger.warn?.('share.video.failed', { jobId: job.id, stage, error: String(error).slice(0, 200) });
    // The scene shows the failure and lets go by itself; stopping the screen is the backstop.
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
        : 'The shared video could not be fetched or streamed, so it was not played.';
      Promise.resolve(this.#notify(job.username, { title: 'Share did not play', body })).catch((e) => {
        this.#logger.warn?.('share.video.notify-failed', { jobId: job.id, error: e.message });
      });
    }
  }
}

export default PlaySharedVideo;
