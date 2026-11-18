import { knowledgeRevision } from '../../domain/knowledge/knowledgeRevision.mjs';
import moment from 'moment-timezone';
import { reviewKnowledge } from '../../domain/knowledge/reviewKnowledge.mjs';
import { selectQuestions, experimentArm } from '../../domain/knowledge/selectQuestions.mjs';
import { buildQuestion } from '../../domain/knowledge/questionForms.mjs';
import { applyUserReply, reduceKnowledge } from '../../domain/knowledge/reduceKnowledge.mjs';
import { localDateFor } from '../../domain/knowledge/calendar.mjs';
import { REPLY_WINDOW_MS, evidenceProblem, normalizeQuote } from '../../domain/knowledge/contracts.mjs';
import { mutateKnowledge, stateBatch } from './knowledgeMutation.mjs';
const DAY = 86400000;
const fail = code => {
  throw Object.assign(new Error(code), {
    code
  });
};
const legacy = reason => ({
  mode: 'legacy',
  questions: [],
  statements: [],
  queuedCount: 0,
  selectionId: null,
  reason
});
const reserved = (snapshot, asOf) => new Set(Object.values(snapshot.state.deliveries ?? {}).filter(d => ['prepared', 'quarantined'].includes(d.status) && d.expiresAt > asOf).flatMap(d => d.questions.map(q => q.objectId).filter(Boolean)));
function eligibleView(snapshot, asOf) {
  const blocked = reserved(snapshot, asOf);
  return {
    ...snapshot,
    objects: Object.fromEntries(Object.entries(snapshot.objects).filter(([id]) => !blocked.has(id)))
  };
}
/** Durable selections and receipt-bound decisions. Transport never supplies authority. */
export class KnowledgeQuestions {
  #enabled;
  #store;
  #evidence;
  #tokens;
  #verify;
  #identity;
  #timezone;
  #id;
  #activation;
  #attention;
  #reviewGrants = new WeakMap();
  constructor({
    enabled = false,
    store,
    evidence,
    tokens,
    verifyPrincipal,
    identityForUser,
    userTimezone,
    nextId,
    activationDate,
    attentionBudget = null
  }) {
    if (!store?.commit || !tokens?.mint || typeof verifyPrincipal !== 'function' || typeof identityForUser !== 'function' || typeof userTimezone !== 'function' || typeof nextId !== 'function') throw new TypeError('Invalid knowledge question dependencies');
    this.#enabled = enabled;
    this.#store = store;
    this.#evidence = evidence;
    this.#tokens = tokens;
    this.#verify = verifyPrincipal;
    this.#identity = identityForUser;
    this.#timezone = userTimezone;
    this.#id = nextId;
    this.#activation = activationDate;
    this.#attention = attentionBudget;
  }
  #date(username, asOf) {
    return localDateFor(asOf, this.#timezone(username));
  }
  #principal(principal) {
    if (!this.#enabled) fail('KNOWLEDGE_DISABLED');
    const value = this.#verify(principal);
    if (!value) fail('KNOWLEDGE_PRINCIPAL_REQUIRED');
    if (value.authored !== true) fail('KNOWLEDGE_AUTHORED_INPUT_REQUIRED');
    const configured = this.#identity(value.username);
    if (!configured || String(configured.senderId) !== value.senderId || configured.conversationId !== value.conversationId) fail('KNOWLEDGE_IDENTITY_MISMATCH');
    return value;
  }
  #fresh(snapshot, asOf) {
    return snapshot.health.available && !snapshot.health.conflicted && !snapshot.health.recovering && Number.isFinite(snapshot.health.lastSweepAt) && snapshot.health.lastSweepAt <= asOf && asOf - snapshot.health.lastSweepAt <= REPLY_WINDOW_MS;
  }
  #nonce(tokens) {
    for (let i = 0; i < 8; i++) {
      const nonce = this.#tokens.mint();
      if (!Object.hasOwn(tokens, nonce)) return nonce;
    }
    fail('KNOWLEDGE_TOKEN_COLLISION');
  }
  async #refreshRevocations(username) {
    if (typeof this.#evidence?.readRevocations !== 'function') return;
    const refs = await this.#evidence.readRevocations({
      username
    });
    if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string' || !ref.startsWith('journalist:msg:'))) fail('KNOWLEDGE_INVALID_REVOCATION');
    if (!refs.length) return;
    await mutateKnowledge({
      store: this.#store,
      username,
      runId: this.#id(),
      build: snapshot => {
        const existing = snapshot.state.invalidatedRefs ?? [],
          invalidatedRefs = [...new Set([...existing, ...refs])];
        return invalidatedRefs.length === existing.length ? null : stateBatch({
          invalidatedRefs
        });
      }
    });
  }
  async selectForMorning({
    username,
    askDate,
    asOf,
    max = 2
  }) {
    if (!this.#enabled) return legacy('disabled');
    await this.#refreshRevocations(username);
    if (this.#date(username, asOf) !== askDate) fail('KNOWLEDGE_ASK_DATE_MISMATCH');
    const initial = await this.#store.read({
      username
    });
    if (!this.#fresh(initial, asOf)) return legacy('unavailable');
    let selected;
    await mutateKnowledge({
      store: this.#store,
      username,
      runId: this.#id(),
      build: snapshot => {
        if (!this.#fresh(snapshot, asOf)) {
          selected = legacy('unavailable');
          return null;
        }
        const previous = snapshot.state.morningSelections?.[askDate];
        if (previous && snapshot.state.selections?.[previous]) {
          selected = snapshot.state.selections[previous];
          return null;
        }
        const activation = this.#activation?.(username) ?? this.#date(username, snapshot.state.activationAt ?? asOf);
        const mode = experimentArm({
          activationDate: activation,
          askDate
        });
        const used = snapshot.asks.filter(a => a.channel === 'morning' && a.arm === 'knowledge' && a.askDate === askDate && a.botMessageId && Number.isFinite(a.deliveredAt)).length;
        const result = selectQuestions({
          snapshot: eligibleView(snapshot, asOf),
          askDate,
          asOf,
          timezone: this.#timezone(username),
          max: mode === 'legacy' ? 0 : Math.max(0, Math.min(2, max) - used)
        });
        const history = {
            ...(snapshot.state.quizHistory ?? {})
          },
          quiz = [];
        for (const question of result.quizCandidates) {
          const object = snapshot.objects[question.objectId],
            old = history[object.id] ?? snapshot.quiz.find(row => row.objectId === object.id);
          const moved = old && object.touched > old.evidenceDate;
          if (old && !moved && asOf - old.enqueuedAt >= 7 * DAY) continue;
          const row = {
            objectId: object.id,
            questionId: question.id,
            enqueuedAt: old && !moved ? old.enqueuedAt : asOf,
            evidenceDate: object.touched
          };
          history[object.id] = row;
          quiz.push(row);
          if (quiz.length === 5) break;
        }
        const selectionId = this.#id();
        selected = {
          mode,
          questions: mode === 'knowledge' ? result.questions : [],
          statements: [],
          queuedCount: quiz.length,
          selectionId,
          askDate,
          createdAt: asOf,
          kind: 'morning',
          reason: mode === 'legacy' ? 'control' : result.reason
        };
        return stateBatch({
          selections: {
            ...(snapshot.state.selections ?? {}),
            [selectionId]: selected
          },
          morningSelections: {
            ...(snapshot.state.morningSelections ?? {}),
            [askDate]: selectionId
          },
          quiz,
          quizHistory: history
        });
      }
    });
    return selected;
  }
  async prepareEcho({
    username,
    runId,
    asOf
  }) {
    if (!this.#enabled) return {
      status: 'disabled',
      sendAllowed: false
    };
    const askDate = this.#date(username, asOf);
    let selection;
    await mutateKnowledge({
      store: this.#store,
      username,
      runId: this.#id(),
      build: snapshot => {
        if (!this.#fresh(snapshot, asOf)) fail('KNOWLEDGE_UNAVAILABLE');
        const candidate = snapshot.state.echoCandidates?.[runId];
        if (!candidate || asOf < candidate.createdAt || asOf - candidate.createdAt >= REPLY_WINDOW_MS) {
          selection = null;
          return null;
        }
        const existing = snapshot.state.echoSelections?.[runId];
        if (existing) {
          selection = snapshot.state.selections[existing];
          return null;
        }
        const objects = candidate.objectIds.map(id => snapshot.objects[id]).filter(object => object?.kind === 'loop' && object.sensitivity === 'normal' && object.ask_policy !== 'never').slice(0, 3);
        if (!objects.length && !candidate.reviewCount) {
          selection = null;
          return null;
        }
        const text = ['Recorded: ' + objects.map(object => object.title).join('; '), candidate.reviewCount ? 'Other items await private review.' : null].filter(Boolean).join('\n');
        const selectionId = this.#id();
        selection = {
          mode: 'knowledge',
          kind: 'echo',
          selectionId,
          askDate,
          createdAt: asOf,
          questions: [{
            id: 'echo:' + runId,
            scope: 'echo',
            runId,
            text
          }]
        };
        return stateBatch({
          selections: {
            ...(snapshot.state.selections ?? {}),
            [selectionId]: selection
          },
          echoSelections: {
            ...(snapshot.state.echoSelections ?? {}),
            [runId]: selectionId
          }
        });
      }
    });
    if (!selection) return {
      status: 'empty',
      sendAllowed: false,
      questions: []
    };
    return this.prepareDelivery({
      username,
      conversationId: this.#identity(username)?.conversationId,
      selectionId: selection.selectionId,
      askDate: selection.askDate,
      channel: 'echo',
      questionIds: selection.questions.map(q => q.id),
      asOf
    });
  }
  async linkCandidates({
    principal,
    username,
    senderId,
    conversationId,
    asOf,
    max = 3,
    cursor = 0
  }) {
    const identity = this.#identity(username),
      empty = {
        available: false,
        items: [],
        revision: 'unavailable',
        nextCursor: null
      };
    const actor = this.#verify(principal);
    if (!actor?.authored || actor.username !== username || actor.senderId !== String(senderId) || actor.conversationId !== conversationId || !identity || String(identity.senderId) !== String(senderId) || identity.conversationId !== conversationId || !Number.isSafeInteger(cursor) || cursor < 0) return empty;
    await this.#refreshRevocations(username);
    const snapshot = await this.#store.read({
      username
    });
    if (!this.#fresh(snapshot, asOf)) return empty;
    const candidates = Object.values(snapshot.objects).filter(o => o.kind === 'loop' && ['open', 'waiting', 'stale'].includes(o.status) && o.sensitivity === 'normal' && o.ask_policy !== 'never').sort((a, b) => a.id.localeCompare(b.id)),
      slice = candidates.slice(cursor, cursor + 100),
      refs = [...new Set(slice.flatMap(o => o.evidence.filter(e => e.source === 'user' && !e.retracted && !snapshot.state.invalidatedRefs?.includes(e.ref)).map(e => e.ref)))],
      evidence = await this.#evidence.readByRefs({
        username,
        refs,
        preview: false
      }),
      items = [];
    let scanned = 0;
    for (const object of slice) {
      scanned++;
      const basisRefs = object.evidence.filter(e => e.source === 'user' && !e.retracted && !snapshot.state.invalidatedRefs?.includes(e.ref) && evidence.some(row => row.ref === e.ref && !evidenceProblem(row, {
        mode: 'commit',
        timezone: this.#timezone(username),
        asOf
      }) && normalizeQuote(row.content).includes(normalizeQuote(e.quote)))).map(e => e.ref).slice(0, 5);
      if (basisRefs.length) items.push({
        id: object.id,
        title: object.title.slice(0, 200),
        basisRefs
      });
      if (items.length >= Math.min(3, max)) break;
    }
    const revision = knowledgeRevision(JSON.stringify(items.map(i => [i, snapshot.objects[i.id].user_edits, snapshot.objects[i.id].pinned, evidence.filter(e => i.basisRefs.includes(e.ref)).map(e => [e.ref, e.sourceHash ?? e.content])])));
    return {
      available: true,
      items,
      revision,
      nextCursor: cursor + scanned < candidates.length ? cursor + scanned : null
    };
  }
  async #allowance(username, askDate) {
    const snapshot = await this.#store.read({
      username
    });
    if (!snapshot.health.available) return 0;
    return snapshot.state.backoff?.until > askDate ? [0, 6].includes(new Date(askDate + 'T12:00:00Z').getUTCDay()) ? 1 : 0 : 2;
  }
  async attentionGate({
    username,
    askDate,
    asOf
  }) {
    const selected = await this.selectForMorning({
      username,
      askDate,
      asOf,
      max: 2
    });
    return {
      maxQuestionUnits: await this.#allowance(username, askDate),
      mode: selected.mode,
      reason: selected.reason,
      questionCount: selected.questions?.length ?? 2,
      askDate,
      selectionId: selected.selectionId
    };
  }
  async attentionEligibility({
    username,
    kbObjectIds,
    asOf
  }) {
    await this.#refreshRevocations(username);
    const snapshot = await this.#store.read({
        username
      }),
      result = {};
    for (const id of [...new Set(kbObjectIds)].slice(0, 100)) {
      const object = snapshot.objects[id];
      let allowed = false;
      if (this.#fresh(snapshot, asOf) && object?.kind === 'loop' && object.ask_policy === 'normal' && object.sensitivity === 'normal') allowed = selectQuestions({
        snapshot: eligibleView({
          ...snapshot,
          objects: {
            [id]: object
          }
        }, asOf),
        askDate: this.#date(username, asOf),
        asOf,
        timezone: this.#timezone(username),
        max: 1
      }).questions.some(q => q.objectId === id);
      result[id] = {
        allowed,
        reason: allowed ? 'eligible' : 'owner_policy'
      };
    }
    return result;
  }
  async pendingReview({
    username,
    asOf,
    max = 5,
    excludeIds = [],
    onlyIds = null
  }) {
    if (!this.#enabled) return {
      available: false,
      ids: [],
      count: 0,
      revision: 'disabled',
      due: false
    };
    await this.#refreshRevocations(username);
    const snapshot = await this.#store.read({
      username
    });
    if (!this.#fresh(snapshot, asOf)) return {
      available: false,
      ids: [],
      count: 0,
      revision: 'unavailable',
      due: false
    };
    const candidates = (snapshot.state.pendingReviews ?? []).filter(r => ['person_confirmation', 'alias_confirmation', 'sensitive'].includes(r.reason) && (!onlyIds || onlyIds.includes(r.id)) && !excludeIds.includes(r.id) && !snapshot.state.invalidatedRefs?.includes(r.proposal.evidenceRef)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, 100);
    const evidence = await this.#evidence.readByRefs({
        username,
        refs: [...new Set(candidates.map(r => r.proposal.evidenceRef))],
        preview: false
      }),
      eligible = [];
    for (const row of candidates) {
      try {
        reviewKnowledge({
          snapshot,
          reviewId: row.id,
          action: 'confirm',
          evidence,
          asOf,
          timezone: this.#timezone(username),
          receiptId: 'preview:' + row.id
        });
        eligible.push(row);
        if (eligible.length >= Math.max(0, Math.min(5, max))) break;
      } catch {/* Invalid/retracted proposals never become invitations. */}
    }
    const revision = knowledgeRevision(JSON.stringify(eligible.map(r => [r.id, r.reason, r.proposal, snapshot.objects[r.proposal.target]?.user_edits ?? [], snapshot.objects[r.proposal.target]?.pinned ?? [], evidence.filter(e => e.ref === r.proposal.evidenceRef).map(e => [e.ref, e.sourceHash ?? e.content])])));
    const local = moment.tz(asOf, this.#timezone(username));
    return {
      available: true,
      ids: eligible.map(r => r.id),
      count: eligible.length,
      revision,
      due: local.isoWeekday() === 1 && local.hour() >= 5
    };
  }
  async openReview({
    principal,
    ids,
    asOf
  }) {
    const p = this.#principal(principal);
    if (!Array.isArray(ids) || !ids.length || ids.length > 5 || new Set(ids).size !== ids.length) fail('KNOWLEDGE_INVALID_REVIEW');
    const pending = await this.pendingReview({
      username: p.username,
      asOf,
      max: 5,
      onlyIds: ids
    });
    if (!pending.available || ids.some(id => !pending.ids.includes(id))) fail('KNOWLEDGE_REVIEW_CHANGED');
    const askDate = this.#date(p.username, asOf),
      requestId = knowledgeRevision(JSON.stringify([p.kind === 'callback' ? [p.callbackData, p.messageId] : p.receiptId, ids]));
    let selectionId = this.#id();
    await mutateKnowledge({
      store: this.#store,
      username: p.username,
      runId: this.#id(),
      build: snapshot => {
        this.#principal(principal);
        if (snapshot.state.reviewSelections?.[requestId]) {
          selectionId = snapshot.state.reviewSelections[requestId];
          return null;
        }
        if (!this.#fresh(snapshot, asOf)) fail('KNOWLEDGE_UNAVAILABLE');
        const reviews = ids.map(id => snapshot.state.pendingReviews?.find(r => r.id === id));
        if (reviews.some(r => !r)) fail('KNOWLEDGE_REVIEW_CHANGED');
        const selection = {
          mode: 'knowledge',
          kind: 'review',
          selectionId,
          askDate,
          createdAt: asOf,
          questions: reviews.map(row => ({
            id: 'review:' + row.id,
            scope: 'review',
            proposalId: row.id,
            objectId: row.proposal.target,
            text: row.reason === 'alias_confirmation' ? `Confirm alias: ${row.proposal.fields.alias}` : row.reason === 'person_confirmation' ? `Confirm person: ${row.proposal.fields.name}` : `Keep privately: ${row.proposal.fields.title}`
          }))
        };
        return stateBatch({
          selections: {
            ...(snapshot.state.selections ?? {}),
            [selectionId]: selection
          },
          reviewSelections: {
            ...(snapshot.state.reviewSelections ?? {}),
            [requestId]: selectionId
          }
        });
      }
    });
    const reviewGrant = {};
    this.#reviewGrants.set(reviewGrant, {
      principal,
      username: p.username,
      selectionId
    });
    return this.prepareDelivery({
      username: p.username,
      conversationId: p.conversationId,
      selectionId,
      askDate,
      channel: 'review',
      questionIds: ids.map(id => 'review:' + id),
      asOf,
      reviewGrant
    });
  }
  async prepareWeeklyReview({
    username,
    asOf
  }) {
    if (!this.#enabled) return {
      status: 'disabled',
      sendAllowed: false
    };
    const local = moment.tz(asOf, this.#timezone(username)),
      askDate = this.#date(username, asOf);
    if (local.isoWeekday() !== 1 || local.hour() < 5) return {
      status: 'not_due',
      sendAllowed: false
    };
    let selection;
    await mutateKnowledge({
      store: this.#store,
      username,
      runId: this.#id(),
      build: snapshot => {
        if (!this.#fresh(snapshot, asOf)) fail('KNOWLEDGE_UNAVAILABLE');
        const existing = snapshot.state.weeklyReviews?.[askDate];
        if (existing) {
          selection = snapshot.state.selections[existing];
          return null;
        }
        const reviews = (snapshot.state.pendingReviews ?? []).filter(row => ['person_confirmation', 'alias_confirmation', 'sensitive'].includes(row.reason)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, 5);
        const selectionId = this.#id();
        selection = {
          mode: 'knowledge',
          kind: 'review',
          selectionId,
          askDate,
          createdAt: asOf,
          questions: reviews.map(row => ({
            id: 'review:' + row.id,
            scope: 'review',
            proposalId: row.id,
            objectId: row.proposal.target,
            text: row.reason === 'alias_confirmation' ? `Confirm alias: ${row.proposal.fields.alias}` : row.reason === 'person_confirmation' ? `Confirm person: ${row.proposal.fields.name}` : `Keep privately: ${row.proposal.fields.title}`
          }))
        };
        return stateBatch({
          selections: {
            ...(snapshot.state.selections ?? {}),
            [selectionId]: selection
          },
          weeklyReviews: {
            ...(snapshot.state.weeklyReviews ?? {}),
            [askDate]: selectionId
          }
        });
      }
    });
    if (!selection.questions.length) return {
      status: 'empty',
      sendAllowed: false,
      questions: []
    };
    return this.prepareDelivery({
      username,
      conversationId: this.#identity(username)?.conversationId,
      selectionId: selection.selectionId,
      askDate,
      channel: 'review',
      questionIds: selection.questions.map(q => q.id),
      asOf
    });
  }
  async prepareDelivery({
    username,
    conversationId,
    selectionId,
    askDate,
    channel,
    questionIds = [],
    asOf,
    reviewGrant = null
  }) {
    const grant = reviewGrant && this.#reviewGrants.get(reviewGrant);
    const explicitRequest = !!(grant && this.#principal(grant.principal).username === username && grant.selectionId === selectionId);
    if (!this.#enabled) fail('KNOWLEDGE_DISABLED');
    await this.#refreshRevocations(username);
    if (this.#date(username, asOf) !== askDate) fail('KNOWLEDGE_ASK_DATE_MISMATCH');
    if (this.#identity(username)?.conversationId !== conversationId) fail('KNOWLEDGE_CONVERSATION_MISMATCH');
    if (!['morning', 'quiz', 'review', 'echo'].includes(channel) || !Array.isArray(questionIds)) fail('KNOWLEDGE_INVALID_DELIVERY');
    let attentionReservationId = null;
    if (this.#attention && !explicitRequest && ['morning', 'review'].includes(channel)) {
      const initial = await this.#store.read({
          username
        }),
        selection = initial.state.selections?.[selectionId];
      if (!this.#fresh(initial, asOf)) fail('KNOWLEDGE_UNAVAILABLE');
      if (!selection || selection.askDate !== askDate || selection.kind !== channel) fail('KNOWLEDGE_SELECTION_MISMATCH');
      const previous = Object.values(initial.state.deliveries ?? {}).filter(d => d.selectionId === selectionId && d.channel === channel);
      const live = previous.find(d => !['cancelled', 'expired'].includes(d.status) && (!['prepared', 'quarantined'].includes(d.status) || d.expiresAt > asOf));
      if (live) return {
        deliveryId: live.id,
        questions: live.displayQuestions,
        choices: live.choices,
        sendAllowed: false,
        status: live.status,
        attentionReservationId: live.attentionReservationId ?? null
      };
      if (questionIds.some(id => selection.mode !== 'legacy' && !selection.questions.some(q => q.id === id))) fail('KNOWLEDGE_QUESTION_MISMATCH');
      const questionUnits = selection.mode === 'legacy' ? questionIds.length : selection.questions.filter(q => questionIds.includes(q.id)).length;
      const grant = await this.#attention.reserve({
        username,
        owner: 'knowledge',
        decisionId: 'kb:' + selectionId + ':' + (previous.length + 1),
        channel,
        flowType: channel === 'review' ? 'knowledge_review' : 'morning',
        questionUnits,
        refKey: null,
        asOf,
        expiresAt: asOf + DAY
      });
      if (!grant.allowed) return {
        sendAllowed: false,
        status: 'attention_denied',
        reason: grant.reason,
        questions: [],
        choices: []
      };
      attentionReservationId = grant.reservationId ?? null;
    }
    const preparationSnapshot = await this.#store.read({
      username
    });
    const reviewRows = preparationSnapshot.state.selections?.[selectionId]?.questions?.filter(q => q.scope === 'review') ?? [];
    const reviewEvidence = reviewRows.length ? await this.#evidence.readByRefs({
      username,
      refs: [...new Set(reviewRows.map(q => preparationSnapshot.state.pendingReviews?.find(r => r.id === q.proposalId)?.proposal.evidenceRef).filter(Boolean))],
      preview: false
    }) : [];
    let output;
    try {
      await mutateKnowledge({
        store: this.#store,
        username,
        runId: this.#id(),
        build: snapshot => {
          if (!this.#fresh(snapshot, asOf)) fail('KNOWLEDGE_UNAVAILABLE');
          const selection = snapshot.state.selections?.[selectionId];
          if (!selection || selection.askDate !== askDate || selection.kind !== channel) fail('KNOWLEDGE_SELECTION_MISMATCH');
          const deliveries = structuredClone(snapshot.state.deliveries ?? {});
          for (const delivery of Object.values(deliveries)) {
            if (['prepared', 'quarantined'].includes(delivery.status) && delivery.expiresAt <= asOf) delivery.status = 'expired';
          }
          const previous = Object.values(deliveries).filter(d => d.selectionId === selectionId && d.channel === channel);
          const live = previous.find(d => !['cancelled', 'expired'].includes(d.status));
          if (live) {
            output = {
              deliveryId: live.id,
              questions: live.displayQuestions,
              choices: live.choices,
              sendAllowed: false,
              status: live.status
            };
            return null;
          }
          if (previous.length >= 2) fail('KNOWLEDGE_DELIVERY_RETRY_LIMIT');
          let questions = [];
          if (selection.mode === 'legacy') {
            if (questionIds.some(id => !/^legacy\.[0-9]+$/.test(id))) fail('KNOWLEDGE_QUESTION_MISMATCH');
            questions = questionIds.map(id => ({
              id,
              objectId: null,
              legacy: true
            }));
          } else {
            if (questionIds.some(id => !selection.questions.some(q => q.id === id))) fail('KNOWLEDGE_QUESTION_MISMATCH');
            questions = selection.questions.filter(q => questionIds.includes(q.id)).map(q => {
              if (q.scope === 'review') {
                try {
                  reviewKnowledge({
                    snapshot,
                    reviewId: q.proposalId,
                    action: 'confirm',
                    evidence: reviewEvidence,
                    asOf,
                    timezone: this.#timezone(username),
                    receiptId: 'prepare:' + q.proposalId
                  });
                  return q;
                } catch {
                  return null;
                }
              }
              if (q.scope && q.scope !== 'loop') return q;
              const object = snapshot.objects[q.objectId];
              if (!object || !['open', 'waiting', 'stale'].includes(object.status) || !['normal', 'user_initiated'].includes(object.ask_policy)) return null;
              const eligible = selectQuestions({
                snapshot: {
                  ...snapshot,
                  objects: {
                    [object.id]: object
                  }
                },
                askDate,
                asOf,
                timezone: this.#timezone(username),
                max: channel === 'morning' ? 1 : 0
              });
              const fresh = (channel === 'morning' ? eligible.questions : eligible.quizCandidates).find(candidate => candidate.id === q.id);
              return fresh ?? null;
            }).filter(Boolean);
            if (channel === 'morning') {
              const used = snapshot.asks.filter(a => a.channel === 'morning' && a.arm === 'knowledge' && a.askDate === askDate && a.botMessageId && Number.isFinite(a.deliveredAt)).length;
              questions = questions.slice(0, Math.max(0, 2 - used));
            }
          }
          const id = this.#id(),
            tokens = {
              ...(snapshot.state.callbackTokens ?? {})
            },
            choices = [],
            nonces = [];
          const expiresAt = asOf + 7 * DAY;
          for (const [index, q] of questions.entries()) {
            if (q.legacy) continue;
            const nonce = this.#nonce(tokens),
              scope = q.scope ?? 'loop';
            nonces.push(nonce);
            const actions = scope === 'echo' ? ['looks_right'] : scope === 'review' ? ['confirm', 'reject'] : channel === 'quiz' ? ['yes', 'not_yet', 'drop', 'skip'] : ['yes', 'not_yet', 'drop'];
            tokens[nonce] = {
              nonce,
              deliveryId: id,
              selectionId,
              username,
              conversationId,
              channel,
              scope,
              objectId: q.objectId ?? null,
              questionId: q.id,
              proposalId: q.proposalId ?? null,
              runId: q.runId ?? null,
              allowedActions: actions,
              status: 'prepared',
              expiresAt
            };
            const labels = {
              yes: 'Yes',
              not_yet: 'Not yet',
              drop: 'Drop it',
              looks_right: 'Looks right',
              confirm: 'Confirm',
              reject: 'Reject'
            };
            choices.push(actions.filter(a => a !== 'skip').map(action => ({
              text: (questions.length > 1 ? `${index + 1}. ` : '') + labels[action],
              callback_data: this.#tokens.encode({
                nonce,
                action
              })
            })));
          }
          if (channel === 'quiz' && questions.length) {
            const nonce = this.#nonce(tokens);
            nonces.push(nonce);
            tokens[nonce] = {
              nonce,
              deliveryId: id,
              selectionId,
              username,
              conversationId,
              channel,
              scope: 'control',
              questionId: 'done',
              allowedActions: ['done'],
              status: 'prepared',
              expiresAt
            };
            choices.push([{
              text: 'Different question',
              callback_data: this.#tokens.encode({
                nonce: nonces[0],
                action: 'skip'
              })
            }, {
              text: 'Done',
              callback_data: this.#tokens.encode({
                nonce,
                action: 'done'
              })
            }]);
          }
          const displayQuestions = questions.filter(q => !q.legacy);
          const delivery = {
            explicitRequest,
            attentionReservationId: questions.length ? attentionReservationId : null,
            id,
            selectionId,
            username,
            conversationId,
            askDate,
            channel,
            arm: selection.mode === 'legacy' ? 'legacy' : 'knowledge',
            questions,
            displayQuestions,
            choices,
            nonces,
            createdAt: asOf,
            expiresAt,
            status: 'prepared',
            attempt: previous.length + 1
          };
          output = {
            attentionReservationId: delivery.attentionReservationId,
            deliveryId: id,
            questions: displayQuestions,
            choices,
            sendAllowed: true,
            status: 'prepared'
          };
          return stateBatch({
            deliveries: {
              ...deliveries,
              [id]: delivery
            },
            callbackTokens: tokens,
            ...(channel === 'quiz' ? {
              quizSession: {
                selectionId,
                deliveryId: id,
                questionId: questions[0]?.id ?? null
              }
            } : {})
          });
        }
      });
    } catch (error) {
      if (attentionReservationId) try {
        await this.#attention.fail({
          username,
          reservationId: attentionReservationId,
          uncertain: true,
          asOf
        });
      } catch {}
      throw error;
    }
    if (attentionReservationId && !output.attentionReservationId) await this.#attention.fail({
      username,
      reservationId: attentionReservationId,
      uncertain: false,
      asOf
    });
    return output;
  }
  async recordDelivery({
    username,
    deliveryId,
    botMessageId,
    asOf
  }) {
    const askDate = this.#date(username, asOf);
    if (!/^[1-9][0-9]*$/.test(String(botMessageId))) fail('KNOWLEDGE_MESSAGE_ACK_REQUIRED');
    const attentionId = this.#attention ? (await this.#store.read({
      username
    })).state.deliveries?.[deliveryId]?.attentionReservationId : null;
    let result;
    await mutateKnowledge({
      store: this.#store,
      username,
      runId: this.#id(),
      build: snapshot => {
        const delivery = snapshot.state.deliveries?.[deliveryId];
        if (!delivery) fail('KNOWLEDGE_DELIVERY_UNKNOWN');
        if (delivery.status === 'delivered') {
          if (delivery.botMessageId !== String(botMessageId)) fail('KNOWLEDGE_MESSAGE_MISMATCH');
          result = {
            status: 'already_recorded'
          };
          return null;
        }
        if (delivery.status !== 'prepared') fail('KNOWLEDGE_DELIVERY_NOT_PENDING');
        const tokens = {
          ...(snapshot.state.callbackTokens ?? {})
        };
        for (const nonce of delivery.nonces) tokens[nonce] = {
          ...tokens[nonce],
          status: 'delivered',
          botMessageId: String(botMessageId)
        };
        const asks = [...snapshot.asks];
        for (const q of delivery.questions) {
          if (q.scope && q.scope !== 'loop') continue;
          const id = deliveryId + ':' + q.id;
          if (!asks.some(a => a.id === id)) asks.push({
            id,
            questionId: q.id,
            objectId: q.objectId,
            deliveryId,
            channel: delivery.channel,
            arm: delivery.arm,
            askDate,
            intendedAskDate: delivery.askDate,
            deliveredAt: asOf,
            botMessageId: String(botMessageId),
            response: null
          });
        }
        result = {
          status: 'recorded'
        };
        return stateBatch({
          asks,
          callbackTokens: tokens,
          deliveries: {
            ...snapshot.state.deliveries,
            [deliveryId]: {
              ...delivery,
              status: 'delivered',
              botMessageId: String(botMessageId),
              deliveredAt: asOf,
              deliveredAskDate: askDate
            }
          }
        }, [{
          id: deliveryId + ':ack',
          type: 'knowledge.delivery.acknowledged',
          at: asOf,
          deliveryId,
          channel: delivery.channel,
          arm: delivery.arm
        }]);
      }
    });
    if (attentionId) await this.#attention.acknowledge({
      username,
      reservationId: attentionId,
      botMessageId: String(botMessageId),
      deliveredAt: asOf
    });
    return result;
  }
  async recordDeliveryFailure({
    username,
    deliveryId,
    uncertain,
    asOf
  }) {
    this.#date(username, asOf);
    const before = this.#attention ? (await this.#store.read({
      username
    })).state.deliveries?.[deliveryId] : null;
    await mutateKnowledge({
      store: this.#store,
      username,
      runId: this.#id(),
      build: snapshot => {
        const delivery = snapshot.state.deliveries?.[deliveryId];
        if (!delivery || delivery.status === 'delivered' || delivery.status !== 'prepared') return null;
        const status = uncertain ? 'quarantined' : 'cancelled',
          tokens = {
            ...snapshot.state.callbackTokens
          };
        for (const nonce of delivery.nonces) tokens[nonce] = {
          ...tokens[nonce],
          status
        };
        return stateBatch({
          callbackTokens: tokens,
          deliveries: {
            ...snapshot.state.deliveries,
            [deliveryId]: {
              ...delivery,
              status,
              failedAt: asOf
            }
          },
          ...(snapshot.state.quizSession?.deliveryId === deliveryId ? {
            quizSession: null
          } : {})
        });
      }
    });
    if (before?.attentionReservationId && before.status !== 'delivered') await this.#attention.fail({
      username,
      reservationId: before.attentionReservationId,
      uncertain,
      asOf
    });
  }
  async dispatchDelivery({
    username,
    deliveryId,
    asOf
  }) {
    const snapshot = await this.#store.read({
      username
    });
    const d = snapshot.state.deliveries?.[deliveryId];
    if (!this.#fresh(snapshot, asOf) || !d || d.status !== 'prepared' || d.askDate !== this.#date(username, asOf) || d.createdAt + DAY <= asOf) return {
      allowed: false
    };
    if (!d.explicitRequest && ['morning', 'review'].includes(d.channel)) {
      const allowance = await this.#allowance(username, d.askDate);
      if (d.questions.length > allowance) return {
        allowed: false
      };
    }
    return d.attentionReservationId && this.#attention?.dispatch ? this.#attention.dispatch({
      username,
      reservationId: d.attentionReservationId
    }) : {
      allowed: true
    };
  }
  async attentionHistory({
    username,
    asOf
  }) {
    const snapshot = await this.#store.read({
      username
    });
    if (!snapshot.health.available) return {
      available: false,
      deliveries: [],
      reservations: [],
      unansweredInvitations: []
    };
    const deliveries = [],
      reservations = [],
      unansweredInvitations = [],
      covered = new Set();
    for (const d of Object.values(snapshot.state.deliveries ?? {})) {
      if (!['morning', 'review'].includes(d.channel) || d.explicitRequest === true) continue;
      covered.add(d.id);
      if (d.status === 'delivered' && asOf - d.deliveredAt > 31 * DAY || ['cancelled', 'expired'].includes(d.status)) continue;
      const row = {
        id: 'kb:' + d.id,
        reservationId: d.attentionReservationId ?? null,
        day: d.status === 'delivered' ? this.#date(username, d.deliveredAt) : d.askDate,
        channel: d.channel,
        flowType: d.channel === 'review' ? 'knowledge_review' : 'morning',
        questionUnits: d.questions.length,
        refKey: null,
        status: d.status,
        createdAt: d.createdAt,
        expiresAt: Math.min(d.expiresAt, d.createdAt + DAY),
        deliveredAt: d.deliveredAt ?? null,
        botMessageId: d.botMessageId ?? null
      };
      if (d.status === 'delivered') deliveries.push(row);else if (['prepared', 'quarantined'].includes(d.status) && d.expiresAt > asOf) reservations.push(row);
      if (d.channel === 'review' && d.status === 'delivered' && d.expiresAt > asOf && !d.nonces.some(n => snapshot.state.callbackTokens?.[n]?.status === 'consumed')) unansweredInvitations.push(row);
    }
    const groups = new Map();
    for (const ask of snapshot.asks) {
      if (asOf - ask.deliveredAt > 31 * DAY || !['morning', 'review'].includes(ask.channel) || covered.has(ask.deliveryId) || !ask.botMessageId || !Number.isFinite(ask.deliveredAt)) continue;
      const id = 'kb:' + (ask.deliveryId ?? 'ask:' + ask.id),
        old = groups.get(id);
      if (old) old.questionUnits++;else groups.set(id, {
        id,
        day: this.#date(username, ask.deliveredAt),
        channel: ask.channel,
        flowType: ask.channel === 'review' ? 'knowledge_review' : 'morning',
        questionUnits: 1,
        status: 'delivered',
        deliveredAt: ask.deliveredAt,
        botMessageId: ask.botMessageId
      });
    }
    return {
      available: true,
      maxQuestionUnits: await this.#allowance(username, this.#date(username, asOf)),
      deliveries: [...deliveries, ...groups.values()],
      reservations,
      unansweredInvitations
    };
  }
  #callback(snapshot, principal, nonce, action, botMessageId, receiptId, asOf) {
    if (principal.kind !== 'callback' || principal.messageId !== String(botMessageId) || principal.receiptId !== receiptId) fail('KNOWLEDGE_CALLBACK_BINDING');
    const decoded = this.#tokens.decode(principal.callbackData);
    const token = snapshot.state.callbackTokens?.[nonce];
    const controlAction = {
      'journal:skip': 'skip',
      'journal:change': 'skip',
      'journal:done': 'done'
    }[principal.callbackData];
    const legacyControl = controlAction === action && token?.channel === 'quiz' && (action === 'skip' && token.scope === 'loop' || action === 'done' && token.scope === 'control');
    if ((!decoded || decoded.nonce !== nonce || decoded.action !== action) && !legacyControl) fail('KNOWLEDGE_CALLBACK_BINDING');
    if (!token || token.username !== principal.username || token.conversationId !== principal.conversationId || !token.allowedActions.includes(action)) fail('KNOWLEDGE_TOKEN_SCOPE');
    if (asOf >= token.expiresAt) fail('KNOWLEDGE_TOKEN_EXPIRED');
    if (token.botMessageId !== String(botMessageId) || !['delivered', 'consumed'].includes(token.status)) fail('KNOWLEDGE_DELIVERY_NOT_ACKNOWLEDGED');
    return token;
  }
  async #reviewEvidence(username, nonce) {
    const snapshot = await this.#store.read({
      username
    });
    const token = snapshot.state.callbackTokens?.[nonce];
    if (token?.scope !== 'review') return [];
    const review = snapshot.state.pendingReviews?.find(row => row.id === token.proposalId);
    return review ? this.#evidence.readByRefs({
      username,
      refs: [review.proposal.evidenceRef],
      preview: false
    }) : [];
  }
  async reply({
    principal,
    token: nonce,
    action,
    botMessageId,
    receiptId,
    asOf
  }) {
    const p = this.#principal(principal);
    this.#date(p.username, asOf);
    let result;
    const reviewEvidence = action === 'confirm' ? await this.#reviewEvidence(p.username, nonce) : [];
    await mutateKnowledge({
      store: this.#store,
      username: p.username,
      runId: this.#id(),
      build: snapshot => {
        this.#principal(p);
        const token = this.#callback(snapshot, p, nonce, action, botMessageId, receiptId, asOf);
        if (token.status === 'consumed' || snapshot.state.appliedReceipts?.[receiptId]) {
          result = {
            status: 'already_applied',
            channel: token.channel
          };
          return null;
        }
        if (token.scope === 'review') {
          const batch = reviewKnowledge({
            snapshot,
            reviewId: token.proposalId,
            action,
            evidence: reviewEvidence,
            asOf,
            timezone: this.#timezone(p.username),
            receiptId
          });
          batch.statePatch.callbackTokens = {
            ...snapshot.state.callbackTokens,
            [nonce]: {
              ...token,
              status: 'consumed',
              receiptId,
              action
            }
          };
          batch.statePatch.appliedReceipts = {
            ...(snapshot.state.appliedReceipts ?? {}),
            [receiptId]: {
              deliveryId: token.deliveryId,
              action,
              channel: 'review'
            }
          };
          result = {
            status: 'applied',
            channel: 'review',
            action
          };
          return batch;
        }
        if (token.scope === 'control') fail('KNOWLEDGE_CONTROL_ACTION_REQUIRED');
        const batch = stateBatch({}),
          tokens = {
            ...snapshot.state.callbackTokens,
            [nonce]: {
              ...token,
              status: 'consumed',
              receiptId,
              action
            }
          };
        if (token.scope === 'loop') {
          if (!['yes', 'not_yet', 'drop', 'skip'].includes(action)) fail('KNOWLEDGE_TOKEN_SCOPE');
          const object = snapshot.objects[token.objectId];
          if (!object) fail('KNOWLEDGE_TARGET_MISSING');
          batch.upserts = [applyUserReply({
            object,
            action,
            receiptId,
            asOf,
            timezone: this.#timezone(p.username)
          })];
          batch.statePatch.asks = snapshot.asks.map(ask => ask.deliveryId === token.deliveryId && ask.questionId === token.questionId ? {
            ...ask,
            response: ask.response ?? {
              at: asOf,
              action,
              by: 'tap',
              length: 0,
              attribution: 'reply_to',
              receiptId
            }
          } : ask);
        } else if (token.scope === 'echo' && action !== 'looks_right') fail('KNOWLEDGE_TOKEN_SCOPE');
        batch.statePatch = {
          ...batch.statePatch,
          callbackTokens: tokens,
          appliedReceipts: {
            ...(snapshot.state.appliedReceipts ?? {}),
            [receiptId]: {
              deliveryId: token.deliveryId,
              action,
              channel: token.channel
            }
          },
          ...(token.channel === 'quiz' ? {
            quizSession: null
          } : {})
        };
        batch.events = [{
          id: receiptId,
          type: token.scope === 'echo' ? 'knowledge.echo.confirmed' : 'knowledge.reply.applied',
          at: asOf,
          objectId: token.objectId,
          action,
          attribution: 'reply_to'
        }];
        result = {
          status: 'applied',
          channel: token.channel,
          action
        };
        return batch;
      }
    });
    return result;
  }
  #askOrigin(snapshot, p, askDate, asOf) {
    const delivery = Object.values(snapshot.state.deliveries ?? {}).find(row => row.status === 'delivered' && row.channel === 'morning' && row.botMessageId === p.messageId && row.conversationId === p.conversationId);
    if (!delivery) return {
      mode: 'unknown',
      status: 'unknown'
    };
    const selection = snapshot.state.selections?.[delivery.selectionId];
    if (!selection || selection.kind !== 'morning' || selection.askDate !== delivery.askDate) return {
      mode: 'unknown',
      status: 'unknown'
    };
    const mode = delivery.arm === 'knowledge' ? 'knowledge' : 'legacy';
    return {
      mode,
      status: delivery.expiresAt <= asOf || delivery.askDate !== askDate ? 'expired' : 'current',
      selectionId: delivery.selectionId,
      askDate: delivery.askDate
    };
  }
  async askOrigin({
    principal,
    asOf
  }) {
    const p = this.#principal(principal),
      askDate = this.#date(p.username, asOf);
    if (p.kind !== 'callback' || p.callbackData !== 'debrief:ask') fail('KNOWLEDGE_QUIZ_INTENT_REQUIRED');
    return this.#askOrigin(await this.#store.read({
      username: p.username
    }), p, askDate, asOf);
  }
  async #expireQuiz(username, asOf) {
    await mutateKnowledge({
      store: this.#store,
      username,
      runId: this.#id(),
      build: snapshot => {
        const id = snapshot.state.quizSession?.deliveryId,
          delivery = snapshot.state.deliveries?.[id];
        if (!id || !delivery || delivery.expiresAt > asOf && delivery.status !== 'expired') return null;
        const callbackTokens = {
          ...(snapshot.state.callbackTokens ?? {})
        };
        for (const nonce of delivery.nonces ?? []) if (callbackTokens[nonce]?.status !== 'consumed') callbackTokens[nonce] = {
          ...callbackTokens[nonce],
          status: 'expired'
        };
        return stateBatch({
          quizSession: null,
          callbackTokens,
          deliveries: {
            ...snapshot.state.deliveries,
            [id]: {
              ...delivery,
              status: 'expired'
            }
          }
        });
      }
    });
  }
  async nextQuiz({
    principal,
    asOf
  }) {
    const p = this.#principal(principal),
      askDate = this.#date(p.username, asOf);
    let selection;
    await this.#refreshRevocations(p.username);
    await this.#expireQuiz(p.username, asOf);
    await mutateKnowledge({
      store: this.#store,
      username: p.username,
      runId: this.#id(),
      build: snapshot => {
        if (!this.#fresh(snapshot, asOf)) fail('KNOWLEDGE_UNAVAILABLE');
        if (p.kind === 'callback') {
          const origin = Object.values(snapshot.state.deliveries ?? {}).find(d => d.status === 'delivered' && d.botMessageId === p.messageId && d.conversationId === p.conversationId);
          if (!origin) fail('KNOWLEDGE_MESSAGE_MISMATCH');
          if (p.callbackData === 'debrief:ask') {
            const source = this.#askOrigin(snapshot, p, askDate, asOf);
            if (source.mode !== 'knowledge') fail('KNOWLEDGE_QUIZ_INTENT_REQUIRED');
            if (source.status === 'expired') {
              selection = {
                expired: true
              };
              return null;
            }
          } else {
            if (origin.channel !== 'quiz' || !snapshot.state.appliedReceipts?.[p.receiptId]) fail('KNOWLEDGE_QUIZ_INTENT_REQUIRED');
            if (origin.expiresAt <= asOf || origin.askDate !== askDate) {
              selection = {
                expired: true
              };
              return null;
            }
          }
        }
        const active = snapshot.state.quizSession && snapshot.state.deliveries?.[snapshot.state.quizSession.deliveryId];
        if (active && !['cancelled', 'quarantined', 'expired'].includes(active.status)) {
          selection = {
            active
          };
          return null;
        }
        const queued = snapshot.quiz.filter(row => asOf - row.enqueuedAt < 7 * DAY);
        const view = eligibleView({
          ...snapshot,
          objects: Object.fromEntries(queued.map(row => [row.objectId, snapshot.objects[row.objectId]]).filter(([, o]) => o))
        }, asOf);
        const eligible = new Set(selectQuestions({
          snapshot: view,
          askDate,
          asOf,
          timezone: this.#timezone(p.username),
          max: 0
        }).quizCandidates.map(q => q.objectId));
        const next = queued.find(row => eligible.has(row.objectId));
        if (!next) {
          selection = {
            empty: true
          };
          return null;
        }
        const question = buildQuestion({
          object: snapshot.objects[next.objectId]
        });
        const key = askDate + ':' + question.id,
          existing = snapshot.state.quizSelections?.[key];
        if (existing) {
          selection = snapshot.state.selections[existing];
          return null;
        }
        const selectionId = this.#id();
        selection = {
          mode: 'knowledge',
          selectionId,
          askDate,
          kind: 'quiz',
          questions: [question],
          createdAt: asOf
        };
        return stateBatch({
          selections: {
            ...(snapshot.state.selections ?? {}),
            [selectionId]: selection
          },
          quizSelections: {
            ...(snapshot.state.quizSelections ?? {}),
            [key]: selectionId
          }
        });
      }
    });
    if (selection.active) return {
      deliveryId: selection.active.id,
      questions: selection.active.displayQuestions,
      choices: selection.active.choices,
      sendAllowed: false,
      status: 'active'
    };
    if (selection.expired) return {
      questions: [],
      choices: [],
      sendAllowed: false,
      status: 'expired'
    };
    if (selection.empty) return {
      questions: [],
      choices: [],
      sendAllowed: false,
      status: 'empty'
    };
    return this.prepareDelivery({
      username: p.username,
      conversationId: p.conversationId,
      selectionId: selection.selectionId,
      askDate,
      channel: 'quiz',
      questionIds: selection.questions.map(q => q.id),
      asOf
    });
  }
  async hasActiveQuiz({
    principal,
    asOf
  }) {
    const p = this.#principal(principal),
      snapshot = await this.#store.read({
        username: p.username
      });
    const active = snapshot.state.quizSession && snapshot.state.deliveries?.[snapshot.state.quizSession.deliveryId];
    return !!(active?.status === 'delivered' && active.expiresAt > (asOf ?? p.receivedAt) && active.conversationId === p.conversationId && active.botMessageId === p.messageId);
  }
  async quizControl({
    principal,
    asOf
  }) {
    const p = this.#principal(principal),
      action = {
        'journal:skip': 'skip',
        'journal:change': 'skip',
        'journal:done': 'done'
      }[p.callbackData];
    if (p.kind !== 'callback' || !action) fail('KNOWLEDGE_CONTROL_ACTION_REQUIRED');
    const snapshot = await this.#store.read({
      username: p.username
    });
    const active = snapshot.state.quizSession && snapshot.state.deliveries?.[snapshot.state.quizSession.deliveryId];
    if (active?.status !== 'delivered' || active.botMessageId !== p.messageId || active.conversationId !== p.conversationId) fail('KNOWLEDGE_QUIZ_NOT_ACTIVE');
    const nonce = active.nonces.find(n => snapshot.state.callbackTokens[n]?.allowedActions.includes(action));
    if (!nonce) fail('KNOWLEDGE_TOKEN_SCOPE');
    return action === 'done' ? this.done({
      principal: p,
      token: nonce,
      asOf
    }) : this.reply({
      principal: p,
      token: nonce,
      action,
      botMessageId: p.messageId,
      receiptId: p.receiptId,
      asOf
    });
  }
  async done({
    principal,
    token: nonce,
    asOf
  }) {
    const p = this.#principal(principal),
      decoded = this.#tokens.decode(p.callbackData) ?? (p.callbackData === 'journal:done' ? {
        nonce,
        action: 'done'
      } : null);
    this.#date(p.username, asOf);
    if (!decoded || decoded.action !== 'done') fail('KNOWLEDGE_CONTROL_ACTION_REQUIRED');
    let result;
    await mutateKnowledge({
      store: this.#store,
      username: p.username,
      runId: this.#id(),
      build: snapshot => {
        const token = this.#callback(snapshot, p, decoded.nonce, 'done', p.messageId, p.receiptId, asOf);
        if (token.scope !== 'control' || token.channel !== 'quiz') fail('KNOWLEDGE_TOKEN_SCOPE');
        if (token.status === 'consumed') {
          result = {
            status: 'already_applied'
          };
          return null;
        }
        if (snapshot.state.quizSession?.deliveryId !== token.deliveryId) fail('KNOWLEDGE_QUIZ_NOT_ACTIVE');
        result = {
          status: 'done'
        };
        return stateBatch({
          quizSession: null,
          callbackTokens: {
            ...snapshot.state.callbackTokens,
            [decoded.nonce]: {
              ...token,
              status: 'consumed',
              receiptId: p.receiptId,
              action: 'done'
            }
          }
        }, [{
          id: p.receiptId,
          type: 'knowledge.quiz.done',
          at: asOf
        }]);
      }
    });
    return result;
  }
  async attributeEntry({
    principal,
    sourceId,
    length,
    asOf
  }) {
    const p = this.#principal(principal);
    if (!['text', 'voice'].includes(p.kind)) fail('KNOWLEDGE_ENTRY_REQUIRED');
    await this.#refreshRevocations(p.username);
    this.#date(p.username, asOf);
    let result = {
      attribution: 'none',
      attributedAnswer: false
    };
    await mutateKnowledge({
      store: this.#store,
      username: p.username,
      runId: this.#id(),
      build: snapshot => {
        if (snapshot.state.attributedSources?.[sourceId]) {
          result = snapshot.state.attributedSources[sourceId];
          return null;
        }
        const recent = snapshot.asks.filter(ask => ask.botMessageId && Number.isFinite(ask.deliveredAt) && asOf >= ask.deliveredAt && asOf - ask.deliveredAt <= REPLY_WINDOW_MS);
        const candidates = recent.filter(ask => !ask.response);
        const direct = p.replyToMessageId ? recent.filter(ask => ask.botMessageId === p.replyToMessageId) : [];
        const found = p.replyToMessageId ? direct : candidates;
        const attribution = direct.length ? 'reply_to' : !p.replyToMessageId && found.length === 1 ? 'window' : 'none';
        // One message can contain independent loop questions. Engagement is known;
        // which loop was answered is not. Still extract a short explicitly linked reply.
        const selected = attribution !== 'none' && found.length === 1 && !found[0].response ? found : [];
        result = {
          attribution,
          attributedAnswer: attribution !== 'none',
          askIds: selected.map(ask => ask.id)
        };
        const response = {
          messageKey: p.conversationId + ':message:' + p.messageId,
          at: asOf,
          action: 'text',
          by: p.kind === 'voice' ? 'voice' : 'text',
          length,
          attribution,
          sourceId,
          receiptId: p.receiptId
        };
        const ids = new Set(result.askIds);
        const asks = snapshot.asks.map(ask => ids.has(ask.id) ? {
          ...ask,
          response
        } : ask);
        const messageReplies = {
          ...(snapshot.state.messageReplies ?? {})
        };
        if (attribution !== 'none') {
          const origin = found[0];
          messageReplies[response.messageKey] = {
            ...response,
            botMessageId: origin.botMessageId,
            deliveryId: origin.deliveryId,
            deliveredAt: origin.deliveredAt,
            askDate: origin.askDate,
            channel: origin.channel,
            arm: origin.arm
          };
        }
        return stateBatch({
          asks,
          messageReplies,
          attributedSources: {
            ...(snapshot.state.attributedSources ?? {}),
            [sourceId]: result
          }
        }, [{
          id: p.receiptId + ':attribution',
          type: 'knowledge.entry.attributed',
          at: asOf,
          sourceId,
          attribution
        }]);
      }
    });
    return result;
  }
}
