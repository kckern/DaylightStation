/**
 * ShareJobs — the videos shared from the phone that are being fetched or are
 * ready to play. In memory only: a share is ephemeral (played once from temp
 * storage, swept later), so a restart forgetting the jobs is correct — the
 * screen's intro then sees `gone` and lets go.
 *
 *   state: downloading -> ready | failed
 *   progress: 0..1, real bytes from the downloader (1 only when ready)
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
      state: 'downloading', progress: 0,
      title: null, duration: null, filePath: null, error: null,
      createdAt: now, updatedAt: now,
    };
    this.#jobs.set(id, job);
    this.#trim();
    return { ...job };
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
    job.updatedAt = this.#clock();
  }

  ready(id, { filePath, title = null, duration = null }) {
    const job = this.#jobs.get(id);
    if (!job || job.state !== 'downloading') return;
    Object.assign(job, { state: 'ready', progress: 1, filePath, title, duration, updatedAt: this.#clock() });
  }

  fail(id, error) {
    const job = this.#jobs.get(id);
    if (!job || job.state === 'failed') return;
    Object.assign(job, { state: 'failed', error: String(error || 'failed').slice(0, 200), updatedAt: this.#clock() });
  }

  /** Files of jobs still in memory, so the sweep never deletes one that may play. */
  liveFiles() {
    return new Set([...this.#jobs.values()].filter((j) => j.state !== 'failed').map((j) => j.id));
  }

  #trim() {
    while (this.#jobs.size > KEEP) this.#jobs.delete(this.#jobs.keys().next().value);
  }
}

export default ShareJobs;
