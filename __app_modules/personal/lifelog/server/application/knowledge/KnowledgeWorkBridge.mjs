import { newBatch, isPinned, evidenceProblem, normalizeQuote } from '../../domain/knowledge/contracts.mjs';
import { localDateFor } from '../../domain/knowledge/calendar.mjs';
/** Semantic owner boundary: Work cannot access Lifelog persistence internals. */
export class KnowledgeWorkBridge {
  #backfill;
  #store;
  #evidence;
  #verify;
  #timezone;
  #questions;
  constructor({
    backfill,
    questions = null,
    store,
    evidence,
    verifyProviderEvent = async () => null,
    userTimezone
  }) {
    this.#backfill = backfill;
    this.#questions = questions;
    this.#store = store;
    this.#evidence = evidence;
    this.#verify = verifyProviderEvent;
    this.#timezone = userTimezone;
  }
  attentionHistory(input) {
    return this.#questions?.attentionHistory?.(input) ?? Promise.resolve({
      available: false,
      deliveries: [],
      reservations: [],
      unansweredInvitations: []
    });
  }
  linkCandidates(input) {
    return this.#questions?.linkCandidates?.(input) ?? Promise.resolve({
      available: false,
      items: [],
      revision: 'unavailable',
      nextCursor: null
    });
  }
  attentionGate(input) {
    return this.#questions?.attentionGate?.(input) ?? Promise.resolve({
      mode: 'legacy',
      questionCount: 2,
      reason: 'unavailable'
    });
  }
  attentionEligibility(input) {
    return this.#questions?.attentionEligibility?.(input) ?? Promise.resolve({});
  }
  pendingReview(input) {
    return this.#questions?.pendingReview?.(input) ?? Promise.resolve({
      available: false,
      ids: [],
      count: 0,
      revision: 'unavailable'
    });
  }
  openReview(input) {
    if (!this.#questions?.openReview) throw new Error('KNOWLEDGE_UNAVAILABLE');
    return this.#questions.openReview(input);
  }
  async applyProviderEvent({
    username,
    event,
    links,
    asOf
  }) {
    const authority = await this.#verify({
      username,
      event,
      links,
      asOf
    });
    if (!authority?.valid || !authority.closureAllowed || !this.#store || !this.#evidence || typeof this.#timezone !== 'function') return {
      applied: false,
      reason: 'policy_blocked'
    };
    if (event?.username !== username || event.type !== 'completed' || !['provider', 'journal'].includes(event.origin) || event.occurredAtEstimated === true || !Number.isFinite(event.occurredAt) || event.occurredAt > asOf) return {
      applied: false,
      reason: 'invalid_event'
    };
    const key = ref => ref && JSON.stringify([ref.provider, ref.accountId, ref.kind, ref.id]);
    const matching = links.filter(link => link.username === username && link.relation === 'same_commitment' && key(link.workRef) === key(event.ref) && Number.isFinite(link.confirmedAt) && link.confirmedAt <= event.occurredAt);
    if (!matching.length) return {
      applied: false,
      reason: 'no_same_commitment'
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      const snapshot = await this.#store.read({
        username
      });
      if (!snapshot.health.available) return {
        applied: false,
        reason: 'kb_unavailable',
        pending: true
      };
      const receipt = 'work-provider:' + event.id;
      if (snapshot.state.workProviderEvents?.includes(receipt)) return {
        applied: false,
        reason: 'already_applied'
      };
      const batch = newBatch();
      for (const link of matching) {
        const object = snapshot.objects[link.kbObjectId];
        if (!object || object.kind !== 'loop' || !['open', 'waiting'].includes(object.status) || object.sensitivity !== 'normal' || isPinned(object, 'status') || isPinned(object, 'closedOn') || object.created.sourceAt > event.occurredAt || batch.upserts.some(o => o.id === object.id)) continue;
        const refs = object.evidence.filter(e => e.source === 'user' && !e.retracted && !snapshot.state.invalidatedRefs?.includes(e.ref)).map(e => e.ref);
        if (!refs.length) continue;
        const evidence = await this.#evidence.readByRefs({
          username,
          refs,
          preview: false
        });
        if (!evidence.length || evidence.some(row => row.retracted || evidenceProblem(row, {
          mode: 'commit',
          timezone: this.#timezone(username),
          asOf
        })) || !evidence.some(row => object.evidence.some(basis => basis.source === 'user' && !basis.retracted && basis.ref === row.ref && normalizeQuote(row.content).includes(normalizeQuote(basis.quote))))) continue;
        const closed = structuredClone(object);
        closed.status = 'answered';
        closed.closedOn = localDateFor(event.occurredAt, this.#timezone(username));
        batch.upserts.push(closed);
        batch.moves.push({
          id: object.id,
          closedYear: closed.closedOn.slice(0, 4)
        });
        batch.events.push({
          id: receipt + ':' + object.id,
          type: 'knowledge.work.completed',
          at: event.occurredAt,
          objectId: object.id,
          providerEventId: event.id,
          actorId: event.actorId ?? null
        });
      }
      if (!batch.upserts.length) return {
        applied: false,
        reason: 'policy_blocked'
      };
      batch.statePatch.workProviderEvents = [...(snapshot.state.workProviderEvents ?? []), receipt];
      const current = await this.#verify({
        username,
        event,
        links,
        asOf
      });
      if (!current?.valid || !current.closureAllowed) return {
        applied: false,
        reason: 'policy_blocked'
      };
      try {
        const result = await this.#store.commit({
          username,
          expectedRevision: snapshot.revision,
          runId: receipt,
          batch
        });
        return {
          applied: result.applied,
          reason: result.applied ? 'completed' : 'already_applied'
        };
      } catch (error) {
        if (error.code !== 'STALE_KNOWLEDGE_REVISION') throw error;
      }
    }
    return {
      applied: false,
      reason: 'kb_busy',
      pending: true
    };
  }
  async previewImport(input) {
    const prepared = input.manifest ? {
      manifest: input.manifest
    } : await this.#backfill.prepare(input);
    return {
      ...prepared,
      ...(await this.#backfill.resume({
        manifest: prepared.manifest,
        usageDir: input.usageDir
      }))
    };
  }
  prepareImport(input) {
    return this.#backfill.prepare(input);
  }
  captureImportReceipt(input) {
    return this.#backfill.captureOperatorReceipt(input);
  }
  commitImport(input) {
    return this.#backfill.commit(input);
  }
}
