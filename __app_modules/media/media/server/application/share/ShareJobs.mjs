/**
 * ShareJobs — the videos shared from the phone that are being fetched or are
 * ready to play. In memory: a share is ephemeral. After an app restart a job
 * can be adopted again from a source that still holds its video (see
 * PlaySharedVideo.status), otherwise it is gone and the screen lets go.
 *
 *   state: downloading -> ready | streaming | failed
 *     ready      the video is fetched; `media` is its opaque resource
 *     streaming  it could not be fetched; it plays from `streamContentId` instead
 *   progress: 0..1, real bytes from the fetcher (1 only when ready)
 *
 * Reference: __docs/reference/core/share.md
 */
export const SHARE_JOB_ID = /^s[0-9a-f]{12}$/;

/** `s` and 12 hex digits, from the platform's Web Crypto (no Node import here). */
export function randomShareId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return `s${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const KEEP = 30;

export class ShareJobs {
  #jobs = new Map();
  #clock;
  #newId;

  constructor({ clock = Date.now, newId = randomShareId } = {}) {
    this.#clock = clock;
    this.#newId = newId;
  }

  /** @returns {object} the new job (a copy) */
  create({ provider, sourceId, target, username = null }) {
    const id = this.#newId();
    if (!SHARE_JOB_ID.test(id)) throw new Error('bad share job id');
    const now = this.#clock();
    const job = {
      id, provider, sourceId, target, username,
      state: 'downloading', progress: 0, progressAt: now,
      title: null, duration: null, media: null, streamContentId: null, error: null,
      createdAt: now, updatedAt: now,
    };
    this.#jobs.set(id, job);
    this.#trim();
    return { ...job };
  }

  /** A job found again after a restart, already fetched. */
  adopt(id, { provider, title = null, duration = null, media }) {
    if (!SHARE_JOB_ID.test(String(id)) || this.#jobs.has(id)) return this.get(id);
    const now = this.#clock();
    this.#jobs.set(id, {
      id, provider, sourceId: null, target: null, username: null,
      state: 'ready', progress: 1, progressAt: now, title, duration, media, streamContentId: null, error: null,
      createdAt: now, updatedAt: now, adopted: true,
    });
    this.#trim();
    return this.get(id);
  }

  get(id) {
    const job = SHARE_JOB_ID.test(String(id ?? '')) ? this.#jobs.get(id) : null;
    return job ? { ...job } : null;
  }

  /** Real progress only moves forward, and never past 0.99 before the file is there. */
  progress(id, fraction) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== 'downloading') return;
    const f = Math.max(0, Math.min(0.99, Number(fraction) || 0));
    if (f <= job.progress) return;
    job.progress = f;
    job.progressAt = this.#clock();
    job.updatedAt = job.progressAt;
  }

  ready(id, { media, title = null, duration = null }) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== 'downloading') return;
    Object.assign(job, { state: 'ready', progress: 1, media, title, duration, updatedAt: this.#clock() });
  }

  /** It could not be fetched; it plays from a stream instead. */
  stream(id, streamContentId, reason = null) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== 'downloading') return;
    Object.assign(job, { state: 'streaming', progress: 1, streamContentId, error: reason, updatedAt: this.#clock() });
  }

  fail(id, error) {
    const job = this.#jobs.get(id);
    if (!job || job.state === 'failed') return;
    Object.assign(job, { state: 'failed', media: null, error: String(error || 'failed').slice(0, 200), updatedAt: this.#clock() });
  }

  /** Jobs still downloading, for the no-progress deadline. */
  downloading() {
    return [...this.#jobs.values()].filter((j) => j.state === 'downloading').map((j) => ({ ...j }));
  }

  #trim() {
    while (this.#jobs.size > KEEP) this.#jobs.delete(this.#jobs.keys().next().value);
  }
}

export default ShareJobs;
