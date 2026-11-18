import moment from 'moment-timezone';
import { keyOf } from '../domain/workModel.mjs';
import { workHash, workRelevanceVersion, workError } from '../domain/workState.mjs';
import { workflowRegistry } from '../domain/workflows/workflowRegistry.mjs';
const quiet = ref => ({
  key: keyOf(ref),
  state: 'unconfirmed',
  confirmedAt: null,
  reviewAt: null,
  snoozedUntil: null,
  lastOfferedAt: null,
  ignoredOffers: 0
});
const localVersion = (state, ref) => workRelevanceVersion(state.relevance[keyOf(ref)]);
const same = (a, b) => a && b && keyOf(a) === keyOf(b);
const denied = reason => ({
  status: 'denied',
  reason
});
const labels = {
  keep_active: 'Keep active',
  snooze: 'Revisit in30 days',
  retire: 'Stop tracking',
  review: 'Review',
  later: 'Later',
  dismiss: 'Dismiss',
  refresh: 'Refresh',
  review_link: 'Review link'
};
/** Work decisions authorize local review; provider/KB mutations retain their own owners. */
export class WorkFlows {
  #state;
  #selector;
  #decisions;
  #context;
  #budget;
  #verify;
  #claim;
  #policy;
  #timezone;
  #clock;
  constructor({
    state,
    selector,
    decisions,
    context,
    budget,
    verifyPrincipal,
    verifyDecisionClaim = async () => false,
    resolvePolicy,
    userTimezone,
    clock = Date.now
  }) {
    this.#state = state;
    this.#selector = selector;
    this.#decisions = decisions;
    this.#context = context;
    this.#budget = budget;
    this.#verify = verifyPrincipal;
    this.#claim = verifyDecisionClaim;
    this.#policy = resolvePolicy;
    this.#timezone = userTimezone;
    this.#clock = clock;
  }
  async #change(username, id, build) {
    for (let n = 0; n < 8; n++) {
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      const events = build(state);
      if (!events.length) return state;
      try {
        await this.#state.transact({
          username,
          id: 'workflow:' + id + ':' + workHash(events),
          expectedRevision: state.revision,
          events,
          asOf: this.#clock()
        });
        return await this.#state.read({
          username
        });
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    throw workError('STALE_WORK_REVISION');
  }
  async #current(username, offerId = null, explicitRequest = false) {
    const state = await this.#state.read({
      username
    });
    if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
    const context = await this.#context.execute({
      username,
      asOf: this.#clock()
    });
    if (this.#context.attentionContext) Object.assign(context, await this.#context.attentionContext({
      username,
      state,
      context,
      asOf: this.#clock(),
      explicitRequest: explicitRequest || state.offers?.[offerId]?.explicitRequest === true
    }));
    return {
      state,
      context
    };
  }
  #actor(principal) {
    const p = this.#verify(principal);
    if (!p?.authored || !this.#policy(p.username).enabled) throw workError('WORK_PRINCIPAL_REQUIRED');
    return p;
  }
  async #gate(username, askDate) {
    const policy = this.#policy(username);
    if (!policy.enabled || !policy.proactive || moment.tz(this.#clock(), this.#timezone(username)).format('YYYY-MM-DD') !== askDate) return null;
    const gate = await this.#context.morningGate?.({
      username,
      askDate,
      asOf: this.#clock()
    });
    return gate?.mode === 'knowledge' && gate.askDate === askDate && gate.questionCount < Math.min(2, gate.maxQuestionUnits ?? 2) ? gate : null;
  }
  async selectForMorning({
    username,
    askDate,
    remainingUnits,
    flowType = null,
    asOf = this.#clock()
  }) {
    if (remainingUnits < 1 || !(await this.#gate(username, askDate))) return {
      offer: null
    };
    return this.#selector.execute({
      username,
      asOf,
      explicitRequest: false,
      conversationContext: {
        preview: true,
        ...(flowType ? {
          flowType
        } : {})
      }
    });
  }
  async prepareForMorning({
    username,
    offerId,
    askDate,
    asOf = this.#clock()
  }) {
    if (!(await this.#gate(username, askDate))) return null;
    const selected = await this.#selector.execute({
      username,
      asOf,
      explicitRequest: false,
      conversationContext: {
        offerId
      }
    });
    if (!selected.offer) return null;
    const before = await this.#state.read({
      username
    });
    if (before.offers[offerId]?.decisionId) return null;
    try {
      const page = await this.#decisions.prepareInvitation({
        username,
        offerId,
        asOf
      });
      await this.#change(username, 'prepare:' + offerId, state => {
        const record = state.offers[offerId];
        if (record.decisionId) throw workError('WORK_OFFER_ALREADY_PREPARED');
        return [{
          type: 'workflow.prepared',
          offerId,
          decisionId: page.decisionId,
          reservationId: selected.reservationId,
          at: this.#clock()
        }];
      });
      return {
        ...page,
        offerId,
        questionUnits: 1
      };
    } catch (error) {
      if (selected.reservationId) await this.#budget.fail({
        username,
        reservationId: selected.reservationId,
        uncertain: true,
        asOf: this.#clock()
      });
      throw error;
    }
  }
  async renderInvitation({
    username,
    offerId
  }) {
    const {
        state,
        context
      } = await this.#current(username),
      record = state.offers?.[offerId],
      offer = record?.offer,
      policy = this.#policy(username),
      identity = this.#context.identityForUser?.(username);
    const reservation = Object.values(state.attention ?? {}).find(r => r.decisionId === offerId && r.status === 'prepared' && r.expiresAt > this.#clock());
    const askDate = moment.tz(this.#clock(), this.#timezone(username)).format('YYYY-MM-DD');
    if (!offer || record.status !== 'selected' || !identity || offer.policyRevision !== policy.revision || offer.expiresAt <= this.#clock() || !reservation || !(await this.#gate(username, askDate))) throw workError('WORK_INVITATION_DENIED');
    if (offer.ref) {
      const item = context.items.find(i => same(i.ref, offer.ref));
      if (!item || item.version !== offer.expectedVersion || localVersion(state, offer.ref) !== record.relevanceVersion) throw workError('WORK_OFFER_CHANGED');
    } else if (offer.flowType !== 'knowledge_review' || context.pendingReview?.revision !== offer.expectedVersion) throw workError('WORK_OFFER_CHANGED');
    return {
      identity,
      flowState: this.#flow(offer, 'invite'),
      text: offer.flowType === 'knowledge_review' ? `Review ${Math.min(5, offer.evidenceRefs.length)} suggestions?` : offer.flowType === 'coverage_repair' ? 'Review a stale or partial work source?' : offer.flowType === 'housekeeping' ? 'Review one older work item?' : offer.flowType === 'reactivate' ? 'Revisit a paused work item?' : 'Review one current work item?',
      options: ['review', 'later', 'dismiss'].map(action => ({
        text: labels[action],
        action: 'choose',
        value: {
          action
        }
      }))
    };
  }
  #flow(offer, step) {
    return {
      flowType: offer.flowType,
      offerId: offer.id,
      step,
      selectionRefs: offer.ref ? [offer.ref] : [],
      pageCursor: 0,
      expectedVersion: offer.expectedVersion,
      policyRevision: offer.policyRevision,
      sourceReceipt: null,
      ...(offer.flowType === 'knowledge_review' ? {
        knowledgeReviewIds: offer.evidenceRefs.slice(0, 5)
      } : {})
    };
  }
  async dispatchDelivery({
    username,
    decisionId
  }) {
    const state = await this.#state.read({
      username
    });
    const record = Object.values(state.offers ?? {}).find(r => r.decisionId === decisionId);
    const askDate = moment.tz(this.#clock(), this.#timezone(username)).format('YYYY-MM-DD');
    if (!record || !(await this.#gate(username, askDate)) || !(await this.#check(username, record.offer.id))) return {
      allowed: false
    };
    const identity = this.#context.identityForUser?.(username),
      decision = state.decisions[decisionId];
    if (!identity || decision?.senderId !== String(identity.senderId) || decision?.conversationId !== identity.conversationId) return {
      allowed: false
    };
    const grant = await this.#budget.dispatch({
      username,
      reservationId: record.reservationId
    });
    const currentIdentity = this.#context.identityForUser?.(username);
    if (!currentIdentity || decision.senderId !== String(currentIdentity.senderId) || decision.conversationId !== currentIdentity.conversationId) {
      if (grant.allowed) await this.#budget.fail({
        username,
        reservationId: record.reservationId,
        uncertain: false,
        asOf: this.#clock()
      });
      return {
        allowed: false
      };
    }
    return grant;
  }
  async recordDelivery({
    username,
    decisionId,
    botMessageId,
    asOf = this.#clock()
  }) {
    await this.#decisions.recordDelivery({
      username,
      decisionId,
      botMessageId,
      asOf
    });
    const state = await this.#state.read({
        username
      }),
      record = Object.values(state.offers ?? {}).find(r => r.decisionId === decisionId);
    if (record?.reservationId) await this.#budget.acknowledge({
      username,
      reservationId: record.reservationId,
      botMessageId,
      deliveredAt: asOf
    });
    if (record?.offer.ref) await this.#change(username, 'exposure:' + decisionId, current => {
      const old = current.relevance[keyOf(record.offer.ref)] ?? quiet(record.offer.ref);
      if (old.lastOfferedAt >= asOf) return [];
      return [{
        type: 'relevance.changed',
        ref: record.offer.ref,
        relevance: {
          ...old,
          lastOfferedAt: asOf
        }
      }];
    });
  }
  async recordFailure({
    username,
    decisionId,
    uncertain = true,
    asOf = this.#clock()
  }) {
    await this.#decisions.recordFailure({
      username,
      decisionId,
      uncertain,
      asOf
    });
    const state = await this.#state.read({
        username
      }),
      record = Object.values(state.offers ?? {}).find(r => r.decisionId === decisionId);
    if (record?.reservationId) await this.#budget.fail({
      username,
      reservationId: record.reservationId,
      uncertain,
      asOf
    });
  }
  async open({
    principal,
    flowType = 'housekeeping',
    offerId = null,
    asOf = this.#clock()
  }) {
    const p = this.#actor(principal);
    if (!workflowRegistry.get(flowType)) throw workError('INVALID_WORK_FLOW');
    if (flowType === 'create_link' && !this.#context.linkCandidates) return {
      decisionId: null,
      text: 'No verified link choices are available in this flow.',
      choices: []
    };
    if (flowType === 'knowledge_review' && !offerId) {
      const {
          state,
          context
        } = await this.#current(p.username, null, true),
        pending = context.pendingReview;
      if (!pending?.available || !pending.ids.length) return {
        decisionId: null,
        text: 'No eligible private suggestions are available.',
        choices: []
      };
      const id = 'offer.' + workHash([p.username, p.receiptId, 'knowledge_review', pending.revision]),
        offer = {
          id,
          username: p.username,
          flowType,
          ref: null,
          kbObjectId: null,
          domainId: 'knowledge',
          evidenceRefs: pending.ids.slice(0, 5),
          reason: 'user_requested_review',
          eligibleAt: asOf,
          expiresAt: asOf + 86400000,
          questionUnits: 1,
          requiresConfirmation: true,
          expectedVersion: pending.revision,
          policyRevision: this.#policy(p.username).revision
        };
      await this.#change(p.username, 'manual:' + id, current => current.offers[id] ? [] : [{
        type: 'workflow.selected',
        record: {
          offer,
          relevanceVersion: workHash(null),
          status: 'selected',
          explicitRequest: true
        }
      }]);
      return this.#decisions.prepare({
        principal,
        flowState: this.#flow(offer, 'actions'),
        asOf
      });
    }
    if (offerId) return this.#decisions.prepare({
      principal,
      flowState: this.#flow((await this.#state.read({
        username: p.username
      })).offers[offerId].offer, 'actions'),
      asOf
    });
    return this.#decisions.prepare({
      principal,
      flowState: {
        flowType,
        offerId: 'manual:' + workHash([p.username, p.receiptId, flowType]),
        step: 'select',
        selectionRefs: [],
        pageCursor: 0,
        expectedVersion: null,
        policyRevision: this.#policy(p.username).revision,
        sourceReceipt: null
      },
      asOf
    });
  }
  async renderFlow({
    principal,
    flowState
  }) {
    const p = this.#actor(principal),
      {
        state,
        context
      } = await this.#current(p.username);
    if (flowState.policyRevision !== this.#policy(p.username).revision) throw workError('WORK_POLICY_CHANGED');
    if (flowState.step === 'select') {
      const rows = context.items.slice().sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref))),
        page = rows.slice(flowState.pageCursor, flowState.pageCursor + 3),
        options = page.map(item => ({
          text: 'This one',
          action: 'choose',
          value: {
            ref: item.ref,
            expectedVersion: item.version,
            relevanceVersion: localVersion(state, item.ref)
          }
        }));
      if (rows.length > flowState.pageCursor + 3) options.push({
        text: 'Next',
        action: 'next',
        value: flowState.pageCursor + 3
      });
      if (flowState.pageCursor > 0) options.push({
        text: 'Back',
        action: 'back',
        value: Math.max(0, flowState.pageCursor - 3)
      });
      options.push({
        text: 'None',
        action: 'none',
        value: null
      });
      return {
        text: page.length ? 'Choose work to review:\n' + page.map((item, i) => `${i + 1}. ${item.title}`).join('\n') : 'No work is available for this review.',
        options,
        more: rows.length > flowState.pageCursor + 3
      };
    }
    const checked = await this.#check(p.username, flowState.offerId);
    if (!checked) throw workError('WORK_OFFER_CHANGED');
    const {
        record,
        item
      } = checked,
      offer = record.offer;
    if (offer.flowType === 'create_link') {
      if (flowState.step === 'link_relation') {
        const candidate = record.linkCandidate;
        if (!candidate) throw workError('WORK_LINK_SELECTION_REQUIRED');
        return {
          text: `Link “${item.title}” to “${candidate.title}”. Choose the relationship; linking does not complete either item.`,
          options: [['Same commitment', 'same_commitment'], ['A step toward it', 'action_for'], ['Context only', 'context_for']].map(([text, relation]) => ({
            text,
            action: 'choose',
            value: {
              relation
            }
          })),
          more: false
        };
      }
      const page = await this.#context.linkCandidates({
        principal,
        username: p.username,
        senderId: p.senderId,
        conversationId: p.conversationId,
        asOf: this.#clock(),
        max: 3,
        cursor: flowState.pageCursor
      });
      if (!page.available) return {
        text: 'KB link choices are unavailable.',
        options: [{
          text: 'None',
          action: 'none',
          value: null
        }],
        more: false
      };
      const options = page.items.map(candidate => ({
        text: 'This one',
        action: 'choose',
        value: {
          candidate,
          revision: page.revision,
          cursor: flowState.pageCursor
        }
      }));
      if (page.nextCursor !== null) options.push({
        text: 'Next',
        action: 'next',
        value: page.nextCursor
      });
      options.push({
        text: 'None',
        action: 'none',
        value: null
      });
      return {
        text: 'Choose the KB commitment:\n' + page.items.map((c, i) => `${i + 1}. ${c.title}`).join('\n'),
        options,
        more: page.nextCursor !== null
      };
    }
    if (offer.flowType === 'knowledge_review') return {
      text: `Review ${offer.evidenceRefs.length} suggestions?`,
      options: ['review', 'later', 'dismiss'].map(action => ({
        text: labels[action],
        action: 'choose',
        value: {
          action
        }
      })),
      more: false
    };
    const actions = offer.flowType === 'reconcile' ? ['keep_active', 'snooze', 'retire'] : workflowRegistry.get(offer.flowType).allowedActions;
    return {
      text: offer.flowType === 'coverage_repair' ? 'This work source is stale or partial. Refresh checks the latest available observations; it does not change task status.' : `Review “${item.title}” in ${offer.domainId}. These choices change local tracking only.`,
      options: actions.map(action => ({
        text: labels[action],
        action: 'choose',
        value: {
          action
        }
      })),
      more: false
    };
  }
  async #check(username, offerId) {
    const {
        state,
        context
      } = await this.#current(username, offerId),
      record = state.offers?.[offerId],
      offer = record?.offer;
    if (!offer || record.status === 'resolved' || offer.policyRevision !== this.#policy(username).revision || offer.expiresAt <= this.#clock()) return null;
    if (!record.explicitRequest && offer.ref && context.links.some(l => same(l.workRef, offer.ref) && context.knowledgeEligibility?.[l.kbObjectId]?.allowed !== true)) return null;
    if (!offer.ref) {
      if (offer.flowType !== 'knowledge_review' || context.pendingReview?.available !== true || context.pendingReview.revision !== offer.expectedVersion || !offer.evidenceRefs.every(id => context.pendingReview.ids.includes(id))) return null;
      return {
        state,
        context,
        record,
        item: null
      };
    }
    if (offer.flowType === 'coverage_repair') {
      const cached = context.items.find(i => same(i.ref, offer.ref));
      return cached && localVersion(state, offer.ref) === record.relevanceVersion ? {
        state,
        context,
        record,
        item: cached
      } : null;
    }
    const item = await this.#context.getItem({
      username,
      ref: offer.ref,
      asOf: this.#clock()
    });
    if (!item || item.version !== offer.expectedVersion || localVersion(state, offer.ref) !== record.relevanceVersion || offer.expiresAt <= this.#clock() || offer.policyRevision !== this.#policy(username).revision) return null;
    return {
      state,
      context,
      record,
      item
    };
  }
  async applyFlowChoice({
    principal,
    flowState,
    choice,
    asOf = this.#clock()
  }) {
    const p = this.#verify(principal);
    if (!p?.authored || !(await this.#claim({
      principal,
      flowState,
      choice,
      asOf: this.#clock()
    }))) return denied('unclaimed_workflow_choice');
    if (flowState.policyRevision !== this.#policy(p.username).revision) return denied('policy_changed');
    if (flowState.step === 'select') {
      if (['next', 'back'].includes(choice.action)) return {
        status: 'page',
        page: await this.#decisions.prepare({
          principal,
          flowState: {
            ...flowState,
            pageCursor: choice.value
          },
          asOf
        })
      };
      if (choice.action !== 'choose' || !choice.value?.ref) return denied('selection_required');
      const {
          state,
          context
        } = await this.#current(p.username),
        cached = context.items.find(i => same(i.ref, choice.value.ref)),
        live = cached && (await this.#context.getItem({
          username: p.username,
          ref: cached.ref,
          asOf: this.#clock()
        }));
      if (!live || live.version !== choice.value.expectedVersion || localVersion(state, live.ref) !== choice.value.relevanceVersion) return denied('selection_changed');
      const policy = this.#policy(p.username),
        domains = Object.entries(policy.domains).filter(([, d]) => {
          const b = policy.providers[d.provider];
          return b.type === live.ref.provider && b.accountId === live.ref.accountId && b.operations?.includes('read') && d.containerId === live.containerRef.id && (!d.assigneeIds || d.assigneeIds.some(id => live.assigneeIds.includes(id)));
        });
      if (domains.length !== 1) return denied('ambiguous_domain');
      const id = 'offer.' + workHash([p.username, flowState.offerId, live.ref, live.version, choice.value.relevanceVersion]),
        offer = {
          id,
          username: p.username,
          flowType: flowState.flowType,
          ref: live.ref,
          kbObjectId: null,
          domainId: domains[0][0],
          evidenceRefs: [],
          reason: 'user_requested_review',
          eligibleAt: asOf,
          expiresAt: asOf + 86400000,
          questionUnits: 1,
          requiresConfirmation: true,
          expectedVersion: live.version,
          policyRevision: policy.revision
        };
      await this.#change(p.username, 'manual:' + id, current => current.offers[id] ? [] : [{
        type: 'workflow.selected',
        record: {
          offer,
          relevanceVersion: choice.value.relevanceVersion,
          status: 'selected',
          explicitRequest: true
        }
      }]);
      return {
        status: 'page',
        page: await this.#decisions.prepare({
          principal,
          flowState: this.#flow(offer, offer.flowType === 'create_link' ? 'link_candidates' : 'actions'),
          asOf
        })
      };
    }
    const checked = await this.#check(p.username, flowState.offerId);
    if (!checked) return denied('offer_changed');
    const {
        record,
        item
      } = checked,
      offer = record.offer,
      action = choice.value?.action;
    if (offer.flowType === 'create_link') {
      if (choice.action === 'next') return {
        status: 'page',
        page: await this.#decisions.prepare({
          principal,
          flowState: {
            ...flowState,
            pageCursor: choice.value
          },
          asOf
        })
      };
      if (choice.action !== 'choose') return denied('link_selection_required');
      const cursor = flowState.step === 'link_relation' ? record.linkCandidate?.cursor : choice.value?.cursor;
      const page = await this.#context.linkCandidates({
        principal,
        username: p.username,
        senderId: p.senderId,
        conversationId: p.conversationId,
        asOf: this.#clock(),
        max: 3,
        cursor: cursor ?? 0
      });
      if (flowState.step === 'link_candidates') {
        const candidate = page.items.find(c => c.id === choice.value?.candidate?.id);
        if (!page.available || page.revision !== choice.value.revision || !candidate || workHash(candidate) !== workHash(choice.value.candidate)) return denied('link_candidate_changed');
        await this.#change(p.username, 'link-candidate:' + offer.id, state => [{
          type: 'workflow.link_candidate',
          offerId: offer.id,
          candidate: {
            ...candidate,
            revision: page.revision,
            cursor: cursor ?? 0
          },
          at: this.#clock()
        }]);
        return {
          status: 'page',
          page: await this.#decisions.prepare({
            principal,
            flowState: {
              ...flowState,
              step: 'link_relation'
            },
            asOf
          })
        };
      }
      const chosen = record.linkCandidate,
        candidate = chosen && page.items.find(c => c.id === chosen.id),
        relation = choice.value?.relation;
      if (!page.available || !candidate || page.revision !== chosen.revision || workHash(candidate.basisRefs) !== workHash(chosen.basisRefs) || !['same_commitment', 'action_for', 'context_for'].includes(relation)) return denied('link_candidate_changed');
      const fresh = await this.#check(p.username, offer.id);
      if (!fresh) return denied('offer_changed');
      await this.#context.confirmLink({
        principal,
        kbObjectId: chosen.id,
        workRef: offer.ref,
        relation,
        basisRefs: chosen.basisRefs,
        asOf: this.#clock()
      });
      await this.#respond(p.username, record, 'link', null);
      return {
        status: 'applied'
      };
    }
    const permitted = flowState.step === 'invite' ? ['review', 'later', 'dismiss'] : workflowRegistry.get(offer.flowType)?.allowedActions ?? [];
    if (choice.action !== 'choose' || !permitted.includes(action)) return denied('action_not_allowed');
    if (action === 'refresh') {
      await this.#respond(p.username, record, 'refresh', null);
      await this.#context.refresh?.({
        username: p.username
      });
      return {
        status: 'refreshed'
      };
    }
    if (action === 'review' && offer.flowType !== 'knowledge_review') {
      await this.#respond(p.username, record, 'review', null);
      return {
        status: 'page',
        page: await this.#decisions.prepare({
          principal,
          flowState: this.#flow(offer, offer.flowType === 'create_link' ? 'link_candidates' : 'actions'),
          asOf
        })
      };
    }
    let changed = null;
    if (['keep_active', 'snooze', 'retire'].includes(action)) {
      const old = checked.state.relevance[keyOf(offer.ref)] ?? quiet(offer.ref),
        next = structuredClone(old);
      next.state = action === 'keep_active' ? 'active' : action === 'retire' ? 'retired' : 'paused';
      next.confirmedAt = action === 'keep_active' ? this.#clock() : next.confirmedAt;
      next.reviewAt = action === 'snooze' ? moment.tz(this.#clock(), this.#timezone(p.username)).add(30, 'days').valueOf() : null;
      next.snoozedUntil = action === 'snooze' ? next.reviewAt : null;
      changed = {
        type: 'relevance.changed',
        ref: offer.ref,
        relevance: next
      };
    }
    if (offer.ref && ['later', 'dismiss'].includes(action)) {
      const old = checked.state.relevance[keyOf(offer.ref)] ?? quiet(offer.ref);
      changed = {
        type: 'relevance.changed',
        ref: offer.ref,
        relevance: {
          ...old,
          invitationUntil: moment.tz(this.#clock(), this.#timezone(p.username)).add(30, 'days').valueOf()
        }
      };
    }
    await this.#respond(p.username, record, action, changed);
    return offer.flowType === 'knowledge_review' && action === 'review' ? {
      status: 'knowledge_review',
      username: p.username,
      knowledgeReviewIds: offer.evidenceRefs.slice(0, 5)
    } : {
      status: 'applied'
    };
  }
  async #respond(username, record, action, changed) {
    await this.#change(username, 'respond:' + record.offer.id + ':' + action, state => {
      const current = state.offers[record.offer.id];
      if (current.status === 'resolved' || current.offer.expiresAt <= this.#clock() || current.offer.policyRevision !== this.#policy(username).revision) throw workError('WORK_OFFER_RESOLVED');
      if (record.offer.ref && localVersion(state, record.offer.ref) !== record.relevanceVersion) throw workError('WORK_RELEVANCE_CHANGED');
      const events = [];
      if (changed) events.push(changed);
      const attention = current.reservationId && state.attention[current.reservationId];
      if (attention?.status === 'delivered' && !attention.response) events.push({
        type: 'attention.responded',
        reservationId: attention.id,
        action,
        at: this.#clock()
      });
      events.push({
        type: 'workflow.responded',
        offerId: record.offer.id,
        action,
        at: this.#clock(),
        resolved: action !== 'review' || record.offer.flowType === 'knowledge_review',
        ...(record.offer.flowType === 'knowledge_review' && action === 'later' ? {
          reviewUntil: moment.tz(this.#clock(), this.#timezone(username)).add(30, 'days').valueOf()
        } : {})
      });
      return events;
    });
  }
  respond({
    principal,
    token,
    botMessageId,
    asOf = this.#clock()
  }) {
    return this.#decisions.reply({
      principal,
      token,
      botMessageId,
      asOf
    });
  }
}
