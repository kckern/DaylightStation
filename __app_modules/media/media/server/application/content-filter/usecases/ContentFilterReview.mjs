/**
 * The Admin review of one film (ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md,
 * "Check it"): the latest audit's rows with review marks, hand nudges, word rulings for this
 * film, and the parent sign-off gate. Rows and their spans come from the latest audit
 * (ContentFilterJobs); a mark counts only while its row's span is unchanged.
 */
import { unmapTime } from '../../../../../../../shared/contracts/content-filter/syncMap.mjs';
import { certify, signOff } from '../../../domain/content-filter/refine/certification.mjs';
import { filmStage } from '../../../domain/content-filter/filmStage.mjs';
import { createTitleQueue } from '../titleQueue.mjs';

export class ReviewError extends Error {
  constructor(message, status, extra = {}) { super(message); this.name = 'ReviewError'; this.status = status; Object.assign(this, extra); }
}

export const MAX_NUDGE_SEC = 30;
const SPAN_EPS = 0.0011; // ±1 ms
const ROW_ID = /^(cue|scene|subject):[A-Za-z0-9_-]+$/;
const VERDICTS = new Set(['approve', 'remove', 'ignore', 'redo']);
const REDO_REASONS = new Set(['edges', 'category', 'action', 'timing', 'other']);
const WORD_VALUES = new Set(['off', 'mute', 'bleep']);
const sameSpan = (a, b) => Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) <= SPAN_EPS && Math.abs(a[1] - b[1]) <= SPAN_EPS;
/**
 * A mark holds while its row still sits where the mark was made. With a recorded `change` it also
 * holds when the re-audited row sits where that change put it: audit spans are padded per effect
 * by the player's widenCue (skip 400/250 ms, full-blur 150/250 ms, a hand nudge is padded again),
 * so the row's edges differ from the change's by the pads. Tolerance: 0.5 s when the change set
 * edges, 2 s for an effect-only change; the row's effect must equal the change's when it set one.
 * Change sides are local seconds, like spans. A mark with no change keeps the exact rule.
 */
const EDGE_TOL = 0.5;
const EFFECT_TOL = 2;
function markHolds(m, r) {
  const span = [r.in, r.out];
  if (sameSpan(m.span, span)) return true;
  const to = m.change?.to;
  if (to == null || !Array.isArray(m.span)) return false;
  const side = typeof to === 'object' ? to : { effect: to };
  if (side.effect != null && side.effect !== 'profile' && r.effect != null && side.effect !== r.effect) return false;
  const edges = side.in != null || side.out != null;
  const tol = edges ? EDGE_TOL : EFFECT_TOL;
  const want = [side.in ?? m.span[0], side.out ?? m.span[1]];
  return Math.abs(want[0] - r.in) <= tol && Math.abs(want[1] - r.out) <= tol;
}
const ms3 = (t) => Math.round(t * 1000) / 1000;

/** Marks that still count against the audit rows: { reviewed, changed } (a moved row's mark is `changed`). */
export function countReviewed(rows = [], marks = {}) {
  let reviewed = 0; let changed = 0;
  for (const r of rows) {
    const m = marks[r.id];
    if (m && markHolds(m, r)) reviewed++; else if (m) changed++;
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

  /** Cue/scene override ids a row's rulings apply to. */
  static #targets(row, rowId) {
    if (rowId.startsWith('scene:')) return { key: 'sceneOverrides', ids: [rowId.slice(6)] };
    const members = (row?.members || []).map(String);
    return { key: 'cueOverrides', ids: members.length ? members : [rowId.replace(/^(cue|subject):/, '')] };
  }

  /**
   * Put an effect back the way its own setter would: cues (ContentFilterScenes.ruleCue) store
   * `off` as `disabled: true`; scenes (#rule) store `effect: 'off'` and leave `disabled` alone.
   */
  static #restoreEffect(next, effect, key) {
    if (key === 'sceneOverrides') {
      if (effect == null || effect === 'profile') delete next.effect; else next.effect = effect;
      return;
    }
    if (effect == null || effect === 'profile') { delete next.effect; delete next.disabled; }
    else if (effect === 'off') { delete next.effect; next.disabled = true; }
    else { next.effect = effect; delete next.disabled; }
  }

  /** A `change` side is an effect string/null or `{ effect?, in?, out? }` (in/out = local seconds; null clears the nudge). */
  static #side(v) { return v !== null && typeof v === 'object' ? v : { effect: v ?? null }; }

  /**
   * Undo what a verdict applied: re-enable cues it disabled; restore the effect and/or edges a
   * recorded change left behind (edges only for a single-target row — a subject nudges per cue).
   */
  static #revert(override, mark, { refined = null, warn = () => {} } = {}) {
    let out = override;
    const touch = (key, id, fn) => {
      const all = { ...(out[key] || {}) }; const next = { ...(all[id] || {}) };
      fn(next);
      if (Object.keys(next).length) all[id] = next; else delete all[id];
      out = { ...out, [key]: all };
    };
    for (const id of mark.applied?.ids || []) touch(mark.applied.key, id, (n) => { delete n.disabled; });
    if (mark.targets && mark.change && 'from' in mark.change) {
      const f = ContentFilterReview.#side(mark.change.from);
      const { key, ids } = mark.targets;
      for (const id of ids) {
        touch(key, id, (n) => {
          if ('effect' in f) ContentFilterReview.#restoreEffect(n, f.effect, key);
          if ('in' in f || 'out' in f) {
            if (ids.length !== 1) { warn('content-filter.review.undo.edges-skipped', { id, reason: 'multi-member row' }); return; }
            if (f.in == null && f.out == null) { delete n.startMs; delete n.endMs; return; }
            const item = (key === 'cueOverrides' ? refined?.cues : refined?.scenes)?.find((x) => x.id === id);
            if (!item) { warn('content-filter.review.undo.edges-skipped', { id, reason: 'no refined item' }); return; }
            try { Object.assign(n, ContentFilterReview.#toVa({ in: f.in, out: f.out }, item, out.sync)); } catch (e) { warn('content-filter.review.undo.edges-skipped', { id, reason: e.message }); }
          }
        });
      }
    }
    return out;
  }

  /**
   * Record a verdict on one row: approve | remove | ignore | redo (reason: edges|category|action|timing|other).
   * `remove` disables the cue/scene (undo re-enables what this call disabled). `change: { from, to }`
   * records an in-place change the client already applied (effect string, or `{ effect?, in?, out? }`
   * for edges); undo restores `from`. A span that no longer matches the audit row is refused (409).
   * A re-verdict keeps an earlier change and any earlier remove unless the new outcome differs
   * (anything but `remove` re-enables); only an explicit undo (clearVerdict) reverts a change.
   */
  async setVerdict(ratingKey, rowId, { verdict = 'approve', reason, change, span, by, dwellMs, replays } = {}) {
    if (!ROW_ID.test(String(rowId))) throw new ReviewError(`Bad row id: ${rowId}`, 400);
    if (!VERDICTS.has(verdict)) throw new ReviewError(`Unknown verdict: ${verdict}`, 400);
    if (reason != null && (verdict !== 'redo' || !REDO_REASONS.has(reason))) throw new ReviewError(`Unknown redo reason: ${reason}`, 400);
    return this.#queue.run(ratingKey, async () => {
      const record = await this.#jobs.record(ratingKey);
      const row = record?.audit?.rows?.find((r) => r.id === rowId);
      if (!row || !sameSpan(span, [row.in, row.out])) throw new ReviewError('This part moved. Reload the list.', 409);
      const { refined, override: stored } = await this.#film(ratingKey);
      if (!refined) throw new ReviewError('This film has no refined filter yet.', 404);
      const override = { ...stored, contentId: stored.contentId || `plex:${ratingKey}` };
      const target = ContentFilterReview.#targets(row, rowId);
      const hasChange = !!change && typeof change === 'object';
      if (verdict === 'remove' || hasChange) {
        const known = new Set(((target.key === 'sceneOverrides' ? refined.scenes : refined.cues) || []).map((x) => String(x.id)));
        const bad = target.ids.find((id) => !known.has(id));
        if (bad) throw new ReviewError(`Unknown ${target.key === 'sceneOverrides' ? 'scene' : 'cue'}: ${bad}`, 404);
      }
      const prior = override.review?.[rowId];
      const mark = { by: String(by || 'admin'), at: this.#clock().toISOString(), span: [ms3(row.in), ms3(row.out)], verdict };
      if (reason) mark.reason = reason;
      if (hasChange) {
        const S = ContentFilterReview.#side;
        // Per field: the earliest `from` (what to restore) and the latest `to`.
        mark.change = prior?.change && 'from' in prior.change && 'from' in change
          ? { from: { ...S(change.from), ...S(prior.change.from) }, to: { ...S(prior.change.to), ...S(change.to) } }
          : { from: change.from ?? null, to: change.to ?? null };
        mark.targets = target;
      } else if (prior?.change) { mark.change = prior.change; mark.targets = prior.targets; }
      let next = override;
      const priorIds = prior?.applied?.ids || [];
      if (verdict === 'remove') {
        const all = { ...(next[target.key] || {}) }; const applied = [...priorIds];
        for (const id of target.ids) {
          if (all[id]?.disabled) continue;
          all[id] = { ...(all[id] || {}), disabled: true }; applied.push(id);
        }
        next = { ...next, [target.key]: all };
        mark.applied = { key: target.key, ids: applied };
      } else if (priorIds.length) {
        next = ContentFilterReview.#revert(next, { applied: prior.applied });
      }
      await this.#repo.saveOverride(ratingKey, { ...next, review: { ...(next.review || {}), [rowId]: mark } });
      const entry = {
        at: mark.at, by: mark.by, rowId, kind: row.kind ?? null, category: row.category ?? null, modality: row.modality ?? null,
        effect: row.effect ?? null, span: mark.span, verdict, reason: reason ?? null, change: mark.change ?? null,
        dwellMs: Number.isFinite(dwellMs) ? dwellMs : null, replays: Number.isFinite(replays) ? replays : null,
        // machine.stage = the pipeline stage the machine's output had reached (a parent sign-off is a
        // human step, so it reads as `machine`); film.stage = the film's readiness stage now (filmStage).
        machine: { stage: await this.#stage(ratingKey, record, refined, 'machine'), unsure: row.unsure || [], handFixed: !!row.handFixed },
        film: { stage: await this.#stage(ratingKey, record, refined) },
      };
      await this.#repo.appendReviewHistory(ratingKey, entry);
      this.#logger.info?.('content_filter.review.verdict.recorded', { ratingKey, rowId, kind: entry.kind, category: entry.category, verdict, reason: entry.reason, by: mark.by });
      // `reenabled` is a signal to the caller (re-audit), not part of the stored mark.
      return priorIds.length && verdict !== 'remove' ? { ...mark, reenabled: true } : mark;
    });
  }

  async #stage(ratingKey, record, refined, cap = null) {
    const audit = record?.audit || null;
    const level = refined?.certification?.level ?? 'none';
    return filmStage({
      hasRefined: !!refined, hasScenesKey: Array.isArray(refined?.scenes),
      audit: audit ? { ok: audit.ok, fresh: audit.digest === (await this.#digestOf(ratingKey)) } : null,
      certificationLevel: cap === 'machine' && level === 'parent' ? 'machine' : level, job: null,
    });
  }

  markReviewed({ ratingKey, rowId, span, by }) { return this.setVerdict(ratingKey, rowId, { verdict: 'approve', span, by }); }

  /** Undo: drop the verdict and revert what it applied; appends an `undo` history entry. */
  async clearVerdict({ ratingKey, rowId, by }) {
    if (!ROW_ID.test(String(rowId))) throw new ReviewError(`Bad row id: ${rowId}`, 400);
    return this.#queue.run(ratingKey, async () => {
      const override = (await this.#repo.getOverride(ratingKey)) || {};
      const mark = override.review?.[rowId];
      const review = { ...(override.review || {}) };
      delete review[rowId];
      let next = { ...override, review };
      if (mark) {
        const refined = await this.#film(ratingKey).then((f) => f.refined, () => null);
        next = ContentFilterReview.#revert(next, mark, { refined, warn: (e, d) => this.#logger.warn?.(e, { ratingKey, rowId, ...d }) });
      }
      await this.#repo.saveOverride(ratingKey, next);
      if (mark) {
        const who = String(by || 'admin');
        await this.#repo.appendReviewHistory(ratingKey, {
          at: this.#clock().toISOString(), by: who, rowId, verdict: 'undo', undid: mark.verdict || 'approve',
          span: mark.span ?? null, change: mark.change ?? null,
        });
        this.#logger.info?.('content_filter.review.verdict.recorded', { ratingKey, rowId, verdict: 'undo', undid: mark.verdict || 'approve', by: who });
      }
      this.#logger.info?.('content-filter.review.unmarked', { ratingKey, rowId });
    });
  }

  unmarkReviewed(args) { return this.clearVerdict(args); }

  /**
   * Drop marks whose row is gone (after an audit lands). A mark whose row moved stays, so the
   * page can say "N parts changed since you reviewed them"; it does not count until re-marked.
   */
  async pruneMarks(ratingKey) {
    return this.#queue.run(ratingKey, async () => {
      const rows = new Map(((await this.#audit(ratingKey))?.rows || []).map((r) => [r.id, r]));
      const override = await this.#repo.getOverride(ratingKey);
      if (!override?.review) return 0;
      const review = {}; let pruned = 0;
      for (const [id, m] of Object.entries(override.review)) {
        if (rows.has(id)) review[id] = m; else pruned++;
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
    let reviewed = 0; let changed = 0; let redo = 0;
    const rows = (audit?.rows || []).map((r) => {
      const m = marks[r.id];
      const ok = !!m && markHolds(m, r);
      if (ok) reviewed++; else if (m) changed++;
      const verdict = ok ? { verdict: m.verdict || 'approve', ...(m.reason ? { reason: m.reason } : {}), ...(m.change ? { change: m.change } : {}), by: m.by, at: m.at } : null;
      if (verdict?.verdict === 'redo') redo++;
      return { ...r, reviewed: ok ? { by: m.by, at: m.at } : null, verdict };
    });
    const total = rows.length;
    const auditing = typeof this.#jobs.isAuditing === 'function' && this.#jobs.isAuditing(ratingKey);
    const missing = [];
    if (cert.level === 'none') {
      // Name the words (up to three) so the parent knows which rows to fix.
      const names = cert.blocking.map((id) => rows.find((r) => (r.members || []).includes(id) || r.id === `cue:${id}`)?.label).filter(Boolean);
      const shown = [...new Set(names)].slice(0, 3);
      missing.push(`Not machine-certified: ${cert.blocking.length} mutes do not cover their word${shown.length ? ` (${shown.join(', ')}${cert.blocking.length > shown.length ? ', …' : ''})` : ''}`);
    }
    if (audit && audit.ok === false) missing.push('The audit has not passed');
    if (!fresh) missing.push(auditing ? 'The audit is still running' : 'The audit is out of date. Run Stage again → Audit.');
    if (total - reviewed - changed > 0) missing.push(`${total - reviewed - changed} rows have no verdict`);
    if (changed) missing.push(`${changed} parts changed since you reviewed them`);
    if (redo) missing.push(`${redo} rows wait for redo`);
    const run = (record?.runs || []).at(-1) || null;
    return {
      title: raw?.title ?? null,
      certification: { level: cert.level, ...(cert.blocking ? { blocking: cert.blocking } : {}) },
      audit: audit ? { ok: audit.ok, at: audit.at, fresh, running: auditing, failures: audit.failures || [] } : null,
      wordRulings: override.profilePatch?.languageWords || {},
      bleepLevel: { film: override.profilePatch?.bleepLevel ?? null, profile: (await this.#repo.getProfile('family'))?.bleepLevel ?? null },
      rows, reviewed, total, redo,
      job: run ? { id: run.id, kind: run.kind, status: run.status, step: run.step, steps: run.steps, ...(run.cues ? { cues: run.cues } : {}) } : null,
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
