/** Registry boundary for the different things a worksheet companion can do. */
export class LessonCompanionHandlers {
  #handlers;
  constructor(handlers = []) { this.#handlers = new Map(handlers.map((handler) => [handler.name, handler])); }
  async open({ offer }) {
    const handler = this.#handlers.get(offer?.companion?.handler);
    return handler?.open ? handler.open({ offer }) : { outcome: 'refused', sentence: 'That lesson companion is not available on this screen.' };
  }
  async recordProgress({ offer, payload }) {
    const handler = this.#handlers.get(offer?.companion?.handler);
    if (!handler?.recordProgress) return { ok: true, tracked: false };
    return handler.recordProgress({ offer, payload });
  }
}

/** The first handler: a text-and-audio sequence, with optional part telemetry. */
export class ReadalongLessonCompanionHandler {
  name = 'readalong';
  #companions; #clock;
  constructor({ companions, clock = () => new Date() } = {}) { this.#companions = companions; this.#clock = clock; }
  async open({ offer }) {
    const now = this.#clock().toISOString();
    const updated = await this.#companions.update(offer.id, (current) => ({
      ...current, state: { ...(current.state ?? {}), openedAt: current.state?.openedAt ?? now, parts: current.state?.parts ?? {} },
    }));
    if (!updated) return { outcome: 'failed', sentence: 'Something went wrong. Tell a grown-up.' };
    return {
      outcome: 'mount', sentence: 'Opening your companion.',
      effect: { kind: 'companion', companionId: updated.id, presentation: 'readalong', title: updated.companion.payload.playlist.title, parts: updated.companion.payload.playlist.parts, state: updated.state ?? {}, participation: updated.participation, learnerId: updated.learnerId },
    };
  }
  async recordProgress({ offer, payload: { partId, positionSeconds = 0, durationSeconds = 0, completed = false } = {} }) {
    const now = this.#clock().toISOString();
    const updated = await this.#companions.update(offer.id, (current) => {
      const part = current.companion?.payload?.playlist?.parts?.find((candidate) => candidate.id === partId);
      if (!part) return current;
      const previous = current.state?.parts?.[partId] ?? {};
      return {
        ...current,
        state: { ...(current.state ?? {}), openedAt: current.state?.openedAt ?? now, lastUpdatedAt: now,
          parts: { ...(current.state?.parts ?? {}), [partId]: {
            ...previous, startedAt: previous.startedAt ?? now,
            lastPositionSeconds: Math.max(0, Number(positionSeconds) || 0),
            durationSeconds: Math.max(0, Number(durationSeconds) || 0) || previous.durationSeconds || 0,
            ...(completed ? { completedAt: previous.completedAt ?? now } : {}),
          } },
        },
      };
    });
    return updated ? { ok: true, tracked: true } : { ok: false, tracked: false };
  }
}
