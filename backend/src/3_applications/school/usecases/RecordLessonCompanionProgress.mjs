/** Delegates optional telemetry to the companion's own handler. */
export class RecordLessonCompanionProgress {
  #companions; #handlers;
  constructor({ companions, handlers } = {}) {
    if (!companions) throw new Error('RecordLessonCompanionProgress requires companions');
    if (!handlers) throw new Error('RecordLessonCompanionProgress requires handlers');
    this.#companions = companions; this.#handlers = handlers;
  }
  async execute({ id, ...payload } = {}) {
    const offer = await this.#companions.get(id);
    if (!offer) return { ok: false, tracked: false };
    return this.#handlers.recordProgress({ offer, payload });
  }
}

export default RecordLessonCompanionProgress;
