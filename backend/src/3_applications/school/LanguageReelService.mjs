import crypto from 'node:crypto';
import path from 'node:path';
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

const ID_RE = /^\d+$/;

/**
 * Owns one reel's immutable session snapshot. The content loader intentionally
 * reads only approved reels; imported drafts stay safely author-visible only.
 */
export class LanguageReelService {
  #config; #clock; #store;
  /**
   * `store` is INJECTED (`apps-no-fs`): the rules here — which reels are
   * publishable, how a revision is derived, when a session is complete — stay
   * in this layer; reading and writing the bytes does not.
   */
  constructor({ configService, store, clock = () => new Date() } = {}) {
    if (!store) throw new Error('LanguageReelService requires a document store');
    this.#config = configService; this.#store = store; this.#clock = clock;
  }
  #root() { return path.join(this.#config.getDataDir(), 'content', 'school', 'language', 'korean-language-reels'); }
  #reelFile(reelId) {
    if (!ID_RE.test(String(reelId))) return null;
    const root = path.join(this.#root(), 'reels');
    for (const category of this.#store.list(root)) {
      const candidate = path.join(root, category, `${reelId}.reel.yml`);
      if (this.#store.exists(candidate)) return candidate;
    }
    return null;
  }
  #sessionFile(userId, reelId) {
    if (!this.#config.getUserProfile?.(userId) || !ID_RE.test(String(reelId))) return null;
    return path.join(this.#config.getUserDir(userId), 'apps', 'school', 'language-reels', `${reelId}.yml`);
  }
  #dailyFile(userId) {
    if (!this.#config.getUserProfile?.(userId)) return null;
    return path.join(this.#config.getUserDir(userId), 'apps', 'school', 'language-reels', 'daily-selections.yml');
  }
  #mediaFile(reel) {
    const parts = String(reel?.media?.assetId ?? '').replace(/^school:language\//, '').split('/');
    if (parts.length !== 3 || parts[0] !== 'korean-language-reels') return null;
    // asset form is course/category/id; reject anything that cannot be a file.
    const [course, category, id] = parts;
    if (course !== 'korean-language-reels' || !/^[a-z0-9-]+$/.test(category) || !ID_RE.test(id)) return null;
    return path.join(this.#config.getMediaDir(), 'school', 'language', course, category, `${id}.mp4`);
  }
  getReel(reelId, { approvedOnly = true } = {}) {
    const file = this.#reelFile(reelId); if (!file) throw new EntityNotFoundError('language reel', reelId);
    const reel = this.#store.read(file);
    if (approvedOnly && reel?.reviewState !== 'approved') throw new EntityNotFoundError('language reel', reelId);
    if (approvedOnly) this.#validatePublished(reel, reelId);
    return { reel, revision: crypto.createHash('sha256').update(this.#store.readBytes(file)).digest('hex').slice(0, 16) };
  }
  #validatePublished(reel, reelId) {
    const cues = Array.isArray(reel?.transcript) ? reel.transcript : [];
    if (!reel?.title || !reel?.media?.assetId || !cues.length) throw new ValidationError(`language reel '${reelId}' is not publishable`);
    let previousEnd = -1;
    const ids = new Set();
    for (const cue of cues) {
      if (!cue?.id || ids.has(cue.id) || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs >= cue.endMs || cue.startMs < previousEnd) throw new ValidationError(`language reel '${reelId}' has an invalid transcript`);
      ids.add(cue.id); previousEnd = cue.endMs;
    }
    for (const cloze of reel.authoring?.cloze ?? reel.cloze ?? []) {
      const options = [cloze.answer, ...(cloze.decoys ?? [])];
      if (!ids.has(cloze.lineId) || !cloze.prompt || !cloze.answer || new Set(options).size !== 4 || options.length !== 4) throw new ValidationError(`language reel '${reelId}' has an invalid cloze item`);
    }
    for (const segment of reel.authoring?.speaking?.segments ?? []) {
      if ((!segment.lineId && !(Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs))) || (segment.startMs != null && segment.startMs >= segment.endMs)) throw new ValidationError(`language reel '${reelId}' has an invalid speaking segment`);
    }
  }
  open({ userId, reelId }) {
    const { reel, revision } = this.getReel(reelId);
    const file = this.#sessionFile(userId, reelId); if (!file) throw new ValidationError('identified learner is required');
    const prior = this.#store.read(file);
    if (prior?.revision === revision && !prior.completedAt) return { ...prior, reel };
    const session = { schema: 'school.language-reel-session/v1', id: `lr_${crypto.randomUUID()}`,
      learnerId: userId, reelId: String(reelId), revision, openedAt: this.#clock().toISOString(), updatedAt: this.#clock().toISOString(),
      stages: { flashcards: !reel.vocabulary?.length, listen: false, cloze: false, watch: false, comprehension: false,
        speaking: !reel.authoring?.speaking?.enabled }, attempts: [], completedAt: null };
    this.#store.write(file, session); return { ...session, reel };
  }
  status({ userId, reelId }) {
    const file = this.#sessionFile(userId, reelId); const session = file ? this.#store.read(file) : null;
    const terminal = Boolean(session?.completedAt);
    return { doneToday: terminal && session.completedAt.slice(0, 10) === this.#clock().toISOString().slice(0, 10), terminal,
      progressLabel: terminal ? 'Reel complete' : session ? 'Reel in progress' : 'Not started', score: session?.score ?? null };
  }
  /**
   * Select once at agenda creation, then preserve the decision for that study
   * day.  The category is chosen first; a reel is then chosen from it. This
   * keeps reprinted agendas deterministic and avoids one huge category winning
   * simply because it has more files.
   */
  dailyEntry({ userId, dayKey, rng = Math.random } = {}) {
    const file = this.#dailyFile(userId); if (!file || !dayKey) return null;
    const selections = this.#store.read(file, {}) ?? {};
    const held = selections[dayKey];
    if (held?.reelId) {
      try { const { reel } = this.getReel(held.reelId); return this.#dailyPlanEntry(held.reelId, held.category, dayKey, reel); } catch { delete selections[dayKey]; }
    }
    const root = path.join(this.#root(), 'reels');
    const choices = [];
    for (const category of this.#store.list(root)) {
      const rows = this.#store.list(path.join(root, category)).filter((name) => name.endsWith('.reel.yml'))
        .map((name) => name.replace(/\.reel\.yml$/, ''))
        .filter((id) => { try { return this.getReel(id).reel.reviewState === 'approved'; } catch { return false; } });
      if (rows.length) choices.push({ category, ids: rows });
    }
    if (!choices.length) return null;
    const group = choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
    const reelId = group.ids[Math.min(group.ids.length - 1, Math.floor(rng() * group.ids.length))];
    selections[dayKey] = { reelId, category: group.category, selectedAt: this.#clock().toISOString() };
    this.#store.write(file, selections);
    return this.#dailyPlanEntry(reelId, group.category, dayKey, this.getReel(reelId).reel);
  }
  #dailyPlanEntry(reelId, category, dayKey, reel) {
    return { unitId: `language-reel-${dayKey}-${reelId}`, title: reel.title, subject: 'language',
      program: 'language-reels', programInstance: String(reelId), cadence: 'daily', status: 'available',
      timingPriority: 3, timingRank: 0, reelCategory: category };
  }
  markStage({ userId, reelId, stage }) {
    const file = this.#sessionFile(userId, reelId); if (!file || !this.#store.exists(file)) throw new ValidationError('open the reel first');
    const session = this.#store.read(file); if (!(stage in session.stages)) throw new ValidationError('unknown reel stage');
    session.stages[stage] = true; session.updatedAt = this.#clock().toISOString();
    if (Object.values(session.stages).every(Boolean) && !session.completedAt) session.completedAt = session.updatedAt;
    this.#store.write(file, session); return session;
  }
  recordAttempt({ userId, reelId, type, itemId, answer, correct }) {
    const file = this.#sessionFile(userId, reelId); if (!file || !this.#store.exists(file)) throw new ValidationError('open the reel first');
    if (!['cloze', 'comprehension'].includes(type) || !itemId || typeof correct !== 'boolean') throw new ValidationError('invalid reel attempt');
    const session = this.#store.read(file);
    session.attempts = [...(session.attempts ?? []), { type, itemId: String(itemId), answer: answer ?? null, correct, at: this.#clock().toISOString() }];
    session.updatedAt = this.#clock().toISOString(); this.#store.write(file, session); return session;
  }
  mediaPath(reelId) { const { reel } = this.getReel(reelId); const file = this.#mediaFile(reel); return file && this.#store.exists(file) ? file : null; }
}
export default LanguageReelService;
