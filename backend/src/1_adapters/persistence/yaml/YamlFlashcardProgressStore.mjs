import path from 'node:path';
import { loadYaml, saveYamlToPathAtomic, resolveYamlPath } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

/** Durable, repairable projection of a learner's flashcard review events. */
export class YamlFlashcardProgressStore {
  #configService; #logger; #corrupt = new Set();
  constructor({ configService, logger = console } = {}) {
    if (typeof configService?.getUserDir !== 'function') throw new InfrastructureError('YamlFlashcardProgressStore requires configService.getUserDir()', { code: 'MISSING_DEPENDENCY' });
    this.#configService = configService; this.#logger = logger;
  }
  #base(userId) { return this.#configService.getUserProfile?.(userId) ? path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'flashcards') : null; }
  #read(userId) {
    const base = this.#base(userId); if (!base) return { state: 'missing', value: { schema: 'school.flashcard-progress/v1', cards: {}, sessions: {}, decks: {}, events: [] }, file: null };
    const resolved = resolveYamlPath(base); const empty = { schema: 'school.flashcard-progress/v1', cards: {}, sessions: {}, decks: {}, events: [] };
    if (!resolved) { this.#corrupt.delete(userId); return { state: 'missing', value: empty, file: `${base}.yml` }; }
    try {
      const raw = loadYaml(base); if (raw == null) return { state: 'ok', value: empty, file: resolved };
      if (raw.schema !== 'school.flashcard-progress/v1' || !raw.cards || typeof raw.cards !== 'object' || Array.isArray(raw.cards) || !raw.sessions || typeof raw.sessions !== 'object' || Array.isArray(raw.sessions) || (raw.decks !== undefined && (!raw.decks || typeof raw.decks !== 'object' || Array.isArray(raw.decks))) || (raw.events !== undefined && !Array.isArray(raw.events))) throw new Error('invalid shape');
      this.#corrupt.delete(userId); return { state: 'ok', value: { ...raw, decks: raw.decks ?? {}, events: raw.events ?? [] }, file: resolved };
    } catch {
      this.#corrupt.add(userId); this.#logger.error?.('school.flashcards.progress-corrupt', { learnerId: userId, file: resolved }); return { state: 'corrupt', value: empty, file: resolved };
    }
  }
  read(userId) { return structuredClone(this.#read(userId).value); }
  save(userId, value) {
    const state = this.#read(userId); if (!state.file) throw new InfrastructureError(`cannot resolve flashcard progress for ${userId}`, { code: 'UNKNOWN_USER' });
    if (state.state === 'corrupt') throw new DomainInvariantError(`flashcard progress for '${userId}' is corrupt — refusing to overwrite it`, { code: 'FLASHCARD_PROGRESS_CORRUPT' });
    if (value?.schema !== 'school.flashcard-progress/v1' || !value.cards || !value.sessions || !value.decks || !Array.isArray(value.events)) throw new TypeError('flashcard progress has invalid shape');
    saveYamlToPathAtomic(state.file, value, { noRefs: true }); return true;
  }
  update(userId, fn) { const current = this.read(userId); const next = fn(current); this.save(userId, next); return structuredClone(next); }
}
export default YamlFlashcardProgressStore;
