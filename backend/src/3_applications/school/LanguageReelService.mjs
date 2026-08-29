import { sha256Bytes } from '#system/utils/sha256.mjs';
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Owns one reel's immutable session snapshot. The content loader intentionally
 * reads only approved reels; imported drafts stay safely author-visible only.
 */
export class LanguageReelService {
  #clock; #idFactory; #repository;
  /**
   * `repository` is INJECTED (`apps-no-fs`): the rules here — which reels are
   * publishable, how a revision is derived, when a session is complete — stay
   * in this layer; reading and writing the bytes does not.
   */
  constructor({ repository, idFactory, clock = () => new Date() } = {}) {
    if (!repository) throw new Error('LanguageReelService requires a reel repository');
    if (typeof idFactory !== 'function') throw new Error('LanguageReelService requires an idFactory');
    this.#repository = repository; this.#idFactory = idFactory; this.#clock = clock;
  }
  getReel(reelId, { approvedOnly = true } = {}) {
    const document = this.#repository.findReel(reelId); if (!document) throw new EntityNotFoundError('language reel', reelId);
    const { reel, bytes } = document;
    if (approvedOnly && reel?.reviewState !== 'approved') throw new EntityNotFoundError('language reel', reelId);
    if (approvedOnly) this.#validatePublished(reel, reelId);
    return { reel, revision: sha256Bytes(bytes).slice(0, 16) };
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
    const prior = this.#repository.readSession(userId, reelId); if (prior === undefined) throw new ValidationError('identified learner is required');
    if (prior?.revision === revision && !prior.completedAt) return { ...prior, reel };
    const session = { schema: 'school.language-reel-session/v1', id: `lr_${this.#idFactory()}`,
      learnerId: userId, reelId: String(reelId), revision, openedAt: this.#clock().toISOString(), updatedAt: this.#clock().toISOString(),
      stages: { flashcards: !reel.vocabulary?.length, listen: false, cloze: false, watch: false, comprehension: false,
        speaking: !reel.authoring?.speaking?.enabled }, attempts: [], completedAt: null };
    this.#repository.writeSession(userId, reelId, session); return { ...session, reel };
  }
  status({ userId, reelId }) {
    const session = this.#repository.readSession(userId, reelId) ?? null;
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
    const selections = this.#repository.readDailySelections(userId); if (selections === undefined || !dayKey) return null;
    const held = selections[dayKey];
    if (held?.reelId) {
      try { const { reel } = this.getReel(held.reelId); return this.#dailyPlanEntry(held.reelId, held.category, dayKey, reel); } catch { delete selections[dayKey]; }
    }
    const choices = [];
    const available = this.#repository.listReels();
    for (const category of [...new Set(available.map((row) => row.category))]) {
      const rows = available.filter((row) => row.category === category).map((row) => row.reelId)
        .filter((id) => { try { return this.getReel(id).reel.reviewState === 'approved'; } catch { return false; } });
      if (rows.length) choices.push({ category, ids: rows });
    }
    if (!choices.length) return null;
    const group = choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
    const reelId = group.ids[Math.min(group.ids.length - 1, Math.floor(rng() * group.ids.length))];
    selections[dayKey] = { reelId, category: group.category, selectedAt: this.#clock().toISOString() };
    this.#repository.writeDailySelections(userId, selections);
    return this.#dailyPlanEntry(reelId, group.category, dayKey, this.getReel(reelId).reel);
  }
  #dailyPlanEntry(reelId, category, dayKey, reel) {
    return { unitId: `language-reel-${dayKey}-${reelId}`, title: reel.title, subject: 'language',
      program: 'language-reels', programInstance: String(reelId), cadence: 'daily', status: 'available',
      timingPriority: 3, timingRank: 0, reelCategory: category };
  }
  markStage({ userId, reelId, stage }) {
    if (!this.#repository.sessionExists(userId, reelId)) throw new ValidationError('open the reel first');
    const session = this.#repository.readSession(userId, reelId); if (!(stage in session.stages)) throw new ValidationError('unknown reel stage');
    session.stages[stage] = true; session.updatedAt = this.#clock().toISOString();
    if (Object.values(session.stages).every(Boolean) && !session.completedAt) session.completedAt = session.updatedAt;
    this.#repository.writeSession(userId, reelId, session); return session;
  }
  recordAttempt({ userId, reelId, type, itemId, answer, correct }) {
    if (!this.#repository.sessionExists(userId, reelId)) throw new ValidationError('open the reel first');
    if (!['cloze', 'comprehension'].includes(type) || !itemId || typeof correct !== 'boolean') throw new ValidationError('invalid reel attempt');
    const session = this.#repository.readSession(userId, reelId);
    session.attempts = [...(session.attempts ?? []), { type, itemId: String(itemId), answer: answer ?? null, correct, at: this.#clock().toISOString() }];
    session.updatedAt = this.#clock().toISOString(); this.#repository.writeSession(userId, reelId, session); return session;
  }
  mediaResource(reelId) { return this.#repository.resolveMediaResource(this.getReel(reelId).reel); }
}
export default LanguageReelService;
