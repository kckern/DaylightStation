import { selectOpportunities } from '../domain/workflows/eligibility.mjs';
import { workHash, workRelevanceVersion, workError } from '../domain/workState.mjs';
import { keyOf } from '../domain/workModel.mjs';
/** Selection is separate from delivery, and can never dispatch a provider command. */
export class SelectWorkFlow {
  #context;
  #state;
  #budget;
  #ranker;
  #policy;
  #clock;
  #logger;
  constructor({
    context,
    state,
    budget,
    ranker = null,
    resolvePolicy,
    clock = Date.now,
    logger
  }) {
    this.#context = context;
    this.#state = state;
    this.#budget = budget;
    this.#ranker = ranker;
    this.#policy = resolvePolicy;
    this.#clock = clock;
    this.#logger = logger;
  }
  async #view(username, asOf) {
    const state = await this.#state.read({
      username
    });
    if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
    const context = await this.#context.execute({
      username,
      asOf
    });
    if (this.#context.attentionContext) Object.assign(context, await this.#context.attentionContext({
      username,
      state,
      context,
      asOf
    }));
    return {
      state,
      context
    };
  }
  async execute({
    username,
    asOf = this.#clock(),
    explicitRequest = false,
    conversationContext = {}
  }) {
    const policy = this.#policy(username),
      revision = policy.revision;
    if (!policy.enabled) return {
      offer: null,
      excludedReasons: ['work_disabled']
    };
    const {
        state,
        context
      } = await this.#view(username, asOf),
      history = await this.#budget.history({
        username,
        asOf
      });
    if (history.available === false && !explicitRequest) return {
      offer: null,
      excludedReasons: ['history_unavailable']
    };
    const input = {
        context,
        relevance: state.relevance,
        history,
        policy,
        asOf,
        explicitRequest
      },
      first = selectOpportunities(input),
      excludedReasons = [...new Set(first.excluded.map(e => e.reason))];
    if (conversationContext.flowType) first.eligible = first.eligible.filter(o => o.flowType === conversationContext.flowType);
    this.#logger?.debug?.('work.workflow.excluded', {
      reasons: excludedReasons
    });
    if (!first.eligible.length) return {
      offer: null,
      excludedReasons
    };
    const requested = conversationContext.offerId ? first.eligible.find(o => o.id === conversationContext.offerId && state.offers?.[o.id]) : null;
    if (conversationContext.offerId && !requested) return {
      offer: null,
      excludedReasons: [...excludedReasons, 'offer_changed']
    };
    let ranked = requested ? {
      candidateId: requested.id
    } : null;
    try {
      ranked = requested ? ranked : policy.attention.rankerEnabled === true ? await this.#ranker?.rank({
        eligible: first.eligible.slice(0, 5),
        context: {
          username,
          explicitRequest
        },
        asOf
      }) : null;
    } catch {/* deterministic fallback */}
    const currentPolicy = this.#policy(username),
      fresh = await this.#view(username, this.#clock());
    if (currentPolicy.revision !== revision) return {
      offer: null,
      excludedReasons: [...excludedReasons, 'policy_changed']
    };
    const freshHistory = await this.#budget.history({
      username,
      asOf: this.#clock()
    });
    if (freshHistory.available === false && !explicitRequest) return {
      offer: null,
      excludedReasons: [...excludedReasons, 'history_unavailable']
    };
    const next = selectOpportunities({
      context: fresh.context,
      relevance: fresh.state.relevance,
      history: freshHistory,
      policy: currentPolicy,
      asOf: this.#clock(),
      explicitRequest
    });
    const wanted = first.eligible.find(o => o.id === ranked?.candidateId) ?? first.eligible[0],
      offer = next.eligible.find(o => o.id === wanted.id);
    if (!offer) return {
      offer: null,
      excludedReasons: [...excludedReasons, 'eligibility_changed']
    };
    const existing = fresh.state.offers?.[offer.id],
      record = existing ?? {
        offer,
        relevanceVersion: offer.ref ? workRelevanceVersion(fresh.state.relevance[keyOf(offer.ref)]) : workHash(null),
        status: 'selected'
      };
    if (!existing) try {
      await this.#state.transact({
        username,
        id: 'workflow:select:' + offer.id,
        expectedRevision: fresh.state.revision,
        events: [{
          type: 'workflow.selected',
          record
        }],
        asOf: this.#clock()
      });
    } catch (error) {
      if (error.code === 'STALE_WORK_REVISION') return {
        offer: null,
        excludedReasons: [...excludedReasons, 'state_changed']
      };
      throw error;
    }
    let reservationId = null;
    if (!conversationContext.preview) {
      const grant = await this.#budget.reserve({
        username,
        decisionId: offer.id,
        channel: explicitRequest ? 'direct_request' : offer.flowType === 'housekeeping' ? 'housekeeping' : 'review',
        flowType: offer.flowType,
        refKey: offer.ref ? keyOf(offer.ref) : 'knowledge-review',
        questionUnits: 1,
        asOf: this.#clock(),
        expiresAt: record.offer.expiresAt
      });
      if (!grant.allowed) return {
        offer: null,
        excludedReasons: [...excludedReasons, grant.reason]
      };
      reservationId = grant.reservationId;
    }
    this.#logger?.info?.('work.workflow.selected', {
      flowType: offer.flowType,
      reason: offer.reason
    });
    return {
      offer: structuredClone(record.offer),
      reservationId,
      excludedReasons
    };
  }
}
