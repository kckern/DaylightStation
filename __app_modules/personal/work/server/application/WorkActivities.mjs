import { workError, workHash } from '../domain/workState.mjs';
/** Outbox acknowledgement follows each idempotent projection or owner-side effect. */
export class WorkActivities {
  #state;
  #store;
  #bridge;
  #clock;
  #chains = new Map();
  #logger;
  constructor({
    state,
    activityStore,
    knowledgeBridge = null,
    clock,
    logger
  }) {
    if (!state?.read || !state?.transact || !activityStore?.upsert || typeof clock !== 'function') throw new TypeError('Work activity dependencies required');
    this.#state = state;
    this.#store = activityStore;
    this.#bridge = knowledgeBridge;
    this.#clock = clock;
    this.#logger = logger;
  }
  async #ack(username, eventId, type, asOf) {
    for (let n = 0; n < 4; n++) {
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      const record = state.activities[eventId];
      if (type === 'activity.projected' ? record.projected : record.knowledgeApplied) return;
      try {
        await this.#state.transact({
          username,
          id: type + ':' + workHash(eventId),
          expectedRevision: state.revision,
          events: [{
            type,
            eventId,
            at: asOf
          }],
          asOf
        });
        return;
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    throw workError('STALE_WORK_REVISION');
  }
  flush({
    username,
    asOf = this.#clock()
  }) {
    const run = (this.#chains.get(username) ?? Promise.resolve()).then(async () => {
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      let projected = 0;
      for (const record of Object.values(state.activities)) {
        try {
          if (!record.projected) {
            await this.#store.upsert({
              username,
              event: record.event
            });
            await this.#ack(username, record.event.id, 'activity.projected', asOf);
            projected++;
          }
          if (!record.knowledgeApplied) {
            const result = this.#bridge ? await this.#bridge.applyProviderEvent({
              username,
              event: record.event,
              links: Object.values(state.links),
              asOf
            }) : {
              applied: false,
              reason: 'kb_disabled'
            };
            if (result?.pending === true) continue;
            await this.#ack(username, record.event.id, 'activity.knowledge_applied', asOf);
          }
        } catch {
          this.#logger?.warn?.('work.activity.pending', {
            projected: record.projected
          });
        }
      }
      const latest = await this.#state.read({
        username
      });
      return {
        projected,
        pending: Object.values(latest.activities).filter(row => !row.projected || !row.knowledgeApplied).length
      };
    });
    const tail = run.catch(() => {});
    this.#chains.set(username, tail);
    void tail.finally(() => {
      if (this.#chains.get(username) === tail) this.#chains.delete(username);
    });
    return run;
  }
}
