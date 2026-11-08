/**
 * The Admin review of one film (ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md,
 * "Check it"): the latest audit's rows with review marks, hand nudges, word rulings for this
 * film, and the parent sign-off gate. Rows and their spans come from the latest audit
 * (ContentFilterJobs); a mark counts only while its row's span is unchanged.
 */
import { unmapTime } from '../../../../../../../shared/contracts/content-filter/syncMap.mjs';
import { certify, signOff } from '../../../domain/content-filter/refine/certification.mjs';
import { createTitleQueue } from '../titleQueue.mjs';

export class ReviewError extends Error {
  constructor(message, status, extra = {}) { super(message); this.name = 'ReviewError'; this.status = status; Object.assign(this, extra); }
}

export const MAX_NUDGE_SEC = 30;
const SPAN_EPS = 0.0011; // ±1 ms
const ROW_ID = /^(cue|scene|subject):[A-Za-z0-9_-]+$/;
const WORD_VALUES = new Set(['off', 'mute', 'bleep']);
const sameSpan = (a, b) => Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) <= SPAN_EPS && Math.abs(a[1] - b[1]) <= SPAN_EPS;
const ms3 = (t) => Math.round(t * 1000) / 1000;

/** Marks that still count against the audit rows: { reviewed, changed } (a moved row's mark is `changed`). */
export function countReviewed(rows = [], marks = {}) {
  let reviewed = 0; let changed = 0;
  for (const r of rows) {
    const m = marks[r.id];
    if (m && sameSpan(m.span, [r.in, r.out])) reviewed++; else if (m) changed++;
  }
  return { reviewed, changed };
}

export class ContentFilterReview {
  #repo; #jobs; #digestOf; #logger; #clock; #queue;

  constructor({ contentFilterRepository, jobs, digestOf, logger = console, clock = () => new Date(), titleQueue = createTitleQueue() }) {
    if (!contentFilterRepository || !jobs || !digestOf) throw new Error('ContentFilterReview requires contentFilterRepository, jobs and digestOf');
    this.#repo = contentFilterRepository; this.#jobs = jobs; this.#digestOf = digestOf;
    this.#logger = logger; this.#clock = clock; this.#queue = titleQueue;
  }

  async #film(ratingKey) {
    const raw = await this.#repo.getEdl(ratingKey);
    const ref = raw?.sourceRef;
    const refined = ref?.workId != null && ref?.tagSetId != null ? await this.#repo.getRefinedEdl(ref) : null;
    if (!refined) throw new ReviewError('This film has no refined filter yet.', 404);
    return { raw, ref, refined, override: (await this.#repo.getOverride(ratingKey)) || { contentId: `plex:${ratingKey}` } };
  }

  /** Local seconds -> integer ms on the VidAngel clock, within MAX_NUDGE_SEC of `from` (VidAngel s). */
  static #toVa(nudge, from, sync) {
    const a = Number(nudge?.in); const b = Number(nudge?.out);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) throw new ReviewError('The start must be before the end.', 400);
    const va = sync ? [unmapTime(a, sync), unmapTime(b, sync)] : [a, b];
    if (va.some((t) => t == null)) throw new ReviewError('That time is outside this copy of the film.', 400);
    if (Math.abs(va[0] - from.in) > MAX_NUDGE_SEC || Math.abs(va[1] - from.out) > MAX_NUDGE_SEC) {
      throw new ReviewError(`A nudge can move each edge at most ${MAX_NUDGE_SEC} seconds.`, 400);
    }
    return { startMs: Math.round(va[0] * 1000), endMs: Math.round(va[1] * 1000) };
  }

  async #nudge({ ratingKey, id, nudge, key }) {
    return this.#queue.run(ratingKey, async () => {
      const { refined, override } = await this.#film(ratingKey);
      const item = key === 'cueOverrides' ? refined.cues?.find((c) => c.id === id) : refined.scenes?.find((s) => s.id === id);
      if (!item) throw new ReviewError(`Unknown ${key === 'cueOverrides' ? 'cue' : 'scene'}: ${id}`, 404);
      const all = { ...(override[key] || {}) };
      const next = { ...(all[id] || {}) };
      if (nudge == null) { delete next.startMs; delete next.endMs; }
      else Object.assign(next, ContentFilterReview.#toVa(nudge, item, override.sync));
      if (Object.keys(next).length) all[id] = next; else delete all[id];
      await this.#repo.saveOverride(ratingKey, { ...override, [key]: all });
      this.#logger.info?.('content-filter.nudge', { ratingKey, [key === 'cueOverrides' ? 'cue' : 'scene']: id, startMs: next.startMs ?? null, endMs: next.endMs ?? null });
      return next;
    });
  }

  nudgeCue({ ratingKey, cueId, nudge }) { return this.#nudge({ ratingKey, id: cueId, nudge, key: 'cueOverrides' }); }

  nudgeScene({ ratingKey, sceneId, nudge }) { return this.#nudge({ ratingKey, id: sceneId, nudge, key: 'sceneOverrides' }); }

  /** This film's ruling for one word (beats its language group): off | mute | bleep, null clears. */
  async setTitleWord({ ratingKey, word, value }) {
    const w = String(word || '').trim().toLowerCase();
    if (!/^[a-z][a-z' *-]{0,30}$/.test(w)) throw new ReviewError(`Not a word: ${word}`, 400);
    if (value !== null && !WORD_VALUES.has(value)) throw new ReviewError(`Unknown word setting: ${value}`, 400);
    return this.#queue.run(ratingKey, async () => {
      const override = (await this.#repo.getOverride(ratingKey)) || { contentId: `plex:${ratingKey}` };
      const patch = { ...(override.profilePatch || {}) };
      const words = { ...(patch.languageWords || {}) };
      if (value === null) delete words[w]; else words[w] = value;
      if (Object.keys(words).length) patch.languageWords = words; else delete patch.languageWords;
      await this.#repo.saveOverride(ratingKey, { ...override, profilePatch: patch });
      this.#logger.info?.('content-filter.word.override', { ratingKey, word: w, value });
      return { word: w, value };
    });
  }

  async #audit(ratingKey) { return (await this.#jobs.record(ratingKey))?.audit || null; }

  async markReviewed({ ratingKey, rowId, span, by }) {
    if (!ROW_ID.test(String(rowId))) throw new ReviewError(`Bad row id: ${rowId}`, 400);
    return this.#queue.run(ratingKey, async () => {
      const row = (await this.#audit(ratingKey))?.rows?.find((r) => r.id === rowId);
      if (!row || !sameSpan(span, [row.in, row.out])) throw new ReviewError('This part moved. Reload the list.', 409);
      const override = (await this.#repo.getOverride(ratingKey)) || { contentId: `plex:${ratingKey}` };
      const mark = { by: String(by || 'admin'), at: this.#clock().toISOString(), span: [ms3(row.in), ms3(row.out)] };
      await this.#repo.saveOverride(ratingKey, { ...override, review: { ...(override.review || {}), [rowId]: mark } });
      this.#logger.info?.('content-filter.review.marked', { ratingKey, rowId, by: mark.by });
      return mark;
    });
  }

  async unmarkReviewed({ ratingKey, rowId }) {
    if (!ROW_ID.test(String(rowId))) throw new ReviewError(`Bad row id: ${rowId}`, 400);
    return this.#queue.run(ratingKey, async () => {
      const override = (await this.#repo.getOverride(ratingKey)) || {};
      const review = { ...(override.review || {}) };
      delete review[rowId];
      await this.#repo.saveOverride(ratingKey, { ...override, review });
      this.#logger.info?.('content-filter.review.unmarked', { ratingKey, rowId });
    });
  }

  /** Drop marks whose row is gone or moved (after an audit lands). */
  async pruneMarks(ratingKey) {
    return this.#queue.run(ratingKey, async () => {
      const rows = new Map(((await this.#audit(ratingKey))?.rows || []).map((r) => [r.id, r]));
      const override = await this.#repo.getOverride(ratingKey);
      if (!override?.review) return 0;
      const review = {}; let pruned = 0;
      for (const [id, m] of Object.entries(override.review)) {
        const row = rows.get(id);
        if (row && sameSpan(m.span, [row.in, row.out])) review[id] = m; else pruned++;
      }
      if (pruned) {
        await this.#repo.saveOverride(ratingKey, { ...override, review });
        this.#logger.info?.('content-filter.review.pruned', { ratingKey, pruned });
      }
      return pruned;
    });
  }

  async get({ ratingKey }) {
    const { raw, refined, override } = await this.#film(ratingKey);
    const record = await this.#jobs.record(ratingKey);
    const audit = record?.audit || null;
    const fresh = !!audit && audit.digest === (await this.#digestOf(ratingKey));
    const cert = certify(refined, { at: refined.certification?.machine?.at ?? null, cueOverrides: override.cueOverrides || {} });
    const marks = override.review || {};
    let reviewed = 0; let changed = 0;
    const rows = (audit?.rows || []).map((r) => {
      const m = marks[r.id];
      const ok = !!m && sameSpan(m.span, [r.in, r.out]);
      if (ok) reviewed++; else if (m) changed++;
      return { ...r, reviewed: ok ? { by: m.by, at: m.at } : null };
    });
    const total = rows.length;
    const missing = [];
    if (cert.level === 'none') missing.push(`Not machine-certified: ${cert.blocking.length} mutes do not cover their word`);
    if (audit && audit.ok === false) missing.push('The audit has not passed');
    if (!fresh) missing.push('The audit is still running');
    if (total - reviewed - changed > 0) missing.push(`${total - reviewed - changed} of ${total} parts not reviewed`);
    if (changed) missing.push(`${changed} parts changed since you reviewed them`);
    const run = (record?.runs || []).at(-1) || null;
    return {
      title: raw?.title ?? null,
      certification: { level: cert.level, ...(cert.blocking ? { blocking: cert.blocking } : {}) },
      audit: audit ? { ok: audit.ok, at: audit.at, fresh, failures: audit.failures || [] } : null,
      rows, reviewed, total,
      job: run ? { id: run.id, kind: run.kind, status: run.status, step: run.step, steps: run.steps } : null,
      signOff: { ready: missing.length === 0, missing, parent: refined.certification?.parent || null },
    };
  }

  async approve({ ratingKey, by }) {
    return this.#queue.run(ratingKey, async () => {
      const state = await this.get({ ratingKey });
      if (!state.signOff.ready) {
        this.#logger.info?.('content-filter.signoff.refused', { ratingKey, missing: state.signOff.missing });
        throw new ReviewError('Not ready to approve.', 409, { missing: state.signOff.missing });
      }
      const { ref, refined } = await this.#film(ratingKey);
      const at = this.#clock().toISOString();
      const certification = signOff({ certification: { ...refined.certification, level: 'machine' } }, { by: String(by || 'admin'), at });
      await this.#repo.saveRefinedEdl(ref, { ...refined, certification });
      this.#logger.info?.('content-filter.signoff.approved', { ratingKey, by });
      return certification;
    });
  }

  async withdraw({ ratingKey, by }) {
    return this.#queue.run(ratingKey, async () => {
      const { ref, refined } = await this.#film(ratingKey);
      const { parent: _p, ...rest } = refined.certification || {};
      const certification = { ...rest, level: rest.level === 'parent' ? 'machine' : (rest.level || 'none') };
      await this.#repo.saveRefinedEdl(ref, { ...refined, certification });
      this.#logger.info?.('content-filter.signoff.withdrawn', { ratingKey, by });
      return certification;
    });
  }
}

export default ContentFilterReview;
