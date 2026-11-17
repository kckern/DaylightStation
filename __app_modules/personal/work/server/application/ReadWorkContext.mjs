import { keyOf, validateWorkRef } from '../domain/workModel.mjs';
import { accountKey, assertWorkUser, workHash, workError } from '../domain/workState.mjs';
const allowedItem = (item, domains) => domains.some(d => item.containerRef?.id === d.containerId && (!d.assigneeIds || d.assigneeIds.some(id => item.assigneeIds.includes(id))));
const quietRelevance = ref => ({
  key: keyOf(ref),
  state: 'unconfirmed',
  confirmedAt: null,
  reviewAt: null,
  snoozedUntil: null,
  lastOfferedAt: null,
  ignoredOffers: 0
});
/** Read joins never mutate relevance. Explicit authenticated decisions own links. */
export class ReadWorkContext {
  #state;
  #providers;
  #policy;
  #verify;
  constructor({
    state,
    providers,
    resolvePolicy,
    verifyPrincipal
  }) {
    if (typeof state?.read !== 'function' || !(providers instanceof Map) || typeof resolvePolicy !== 'function' || typeof verifyPrincipal !== 'function') throw new TypeError('Work context dependencies required');
    this.#state = state;
    this.#providers = providers;
    this.#policy = resolvePolicy;
    this.#verify = verifyPrincipal;
  }
  async execute({
    username,
    domainIds,
    asOf
  }) {
    assertWorkUser(username);
    const empty = reason => ({
      items: [],
      containers: [],
      events: [],
      links: [],
      relevance: {},
      coverage: {
        complete: false,
        reason,
        sources: []
      },
      revision: 'unavailable'
    });
    const policy = this.#policy(username);
    if (!policy?.enabled) return empty('work_disabled');
    if (!Number.isFinite(asOf) || domainIds !== undefined && (!Array.isArray(domainIds) || domainIds.some(id => !Object.hasOwn(policy.domains, id)))) return empty('unconfigured_domain');
    const selected = (domainIds ?? Object.keys(policy.domains)).map(id => policy.domains[id]),
      state = await this.#state.read({
        username
      });
    if (!state.health.available) return empty('state_unavailable');
    const groups = new Map();
    for (const domain of selected) {
      const p = policy.providers[domain.provider],
        key = accountKey({
          provider: p.type,
          accountId: p.accountId
        });
      if (!groups.has(key)) groups.set(key, {
        provider: p.type,
        accountId: p.accountId,
        domains: []
      });
      groups.get(key).domains.push(domain);
    }
    const items = new Map(),
      containers = new Map(),
      events = new Map(),
      sources = [];
    for (const [key, group] of groups) {
      const provider = this.#providers.get(key),
        scope = {
          accountId: group.accountId,
          containerIds: [...new Set(group.domains.map(d => d.containerId))],
          assigneeIds: group.domains.every(d => Array.isArray(d.assigneeIds)) ? [...new Set(group.domains.flatMap(d => d.assigneeIds))] : null
        };
      let live;
      try {
        live = await provider?.readSnapshot({
          username,
          scope,
          asOf
        });
      } catch {/* retain known context as unavailable below */}
      const saved = state.snapshots[key];
      const liveKnown = Number.isFinite(live?.observedAt) && live.observedAt <= asOf;
      const savedKnown = Number.isFinite(saved?.observedAt) && saved.observedAt <= asOf;
      const view = liveKnown && (live.items?.length || live.coverage?.complete) ? live : savedKnown ? saved : null;
      const complete = live?.coverage?.complete === true && Number.isFinite(live.observedAt) && live.observedAt <= asOf && asOf - live.observedAt <= policy.limits.snapshotMaxAgeHours * 3600000;
      sources.push({
        provider: group.provider,
        accountId: group.accountId,
        complete,
        reason: complete ? null : live?.observedAt > asOf ? 'future_snapshot' : live?.coverage?.reason ?? 'provider_unavailable',
        revision: live?.revision ?? saved?.revision ?? 'unavailable',
        from: live?.coverage?.from ?? null,
        to: live?.coverage?.to ?? null
      });
      for (const item of view?.items ?? []) if (item.ref.provider === group.provider && item.ref.accountId === group.accountId && allowedItem(item, group.domains)) items.set(keyOf(item.ref), item);
      for (const container of view?.containers ?? []) if (container.ref.provider === group.provider && container.ref.accountId === group.accountId && scope.containerIds.includes(container.ref.id)) containers.set(keyOf(container.ref), container);
      for (const event of view?.events ?? []) if (event.occurredAt <= asOf && event.occurredAt >= asOf-90*86400000 && event.username === username && event.ref.provider === group.provider && event.ref.accountId === group.accountId && allowedItem({
        ...event,
        assigneeIds: event.assigneeIds ?? []
      }, group.domains)) events.set(event.id, event);
    }
    const refs = new Set([...items.keys(), ...containers.keys(), ...[...events.values()].map(e => keyOf(e.ref))]);
    const links = Object.values(state.links).filter(link => refs.has(keyOf(link.workRef))),
      relevance = Object.fromEntries([...items.values()].map(item => [keyOf(item.ref), state.relevance[keyOf(item.ref)] ?? quietRelevance(item.ref)]));
    return {
      items: [...items.values()],
      containers: [...containers.values()],
      events: [...events.values()],
      links,
      relevance,
      coverage: {
        complete: sources.every(s => s.complete),
        reason: sources.some(s => !s.complete) ? 'provider_unavailable' : null,
        sources
      },
      revision: workHash({
        state: state.revision,
        sources,
        domains: domainIds ?? Object.keys(policy.domains),
        policy: policy.revision
      })
    };
  }
  async confirmLink({
    principal,
    kbObjectId,
    workRef,
    relation,
    basisRefs,
    expectedRevision,
    asOf
  }) {
    const actor = this.#verify(principal);
    if (!actor || actor.authored !== true) throw workError('WORK_PRINCIPAL_REQUIRED');
    const username = actor.username;
    assertWorkUser(username);
    validateWorkRef(workRef);
    if (!this.#policy(username)?.enabled || !Number.isFinite(asOf) || !/^(loop|person)\.[a-z0-9][a-z0-9-]{0,95}$/.test(kbObjectId) || !['action_for', 'same_commitment', 'context_for'].includes(relation) || !Array.isArray(basisRefs)) throw workError('INVALID_WORK_LINK');
    const state = await this.#state.read({
      username
    });
    if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
    const id = 'link.' + workHash([username, kbObjectId, keyOf(workRef)]),
      old = state.links[id];
    if (old) {
      if (old.relation !== relation) throw workError('WORK_LINK_CONFLICT');
      return {
        applied: false,
        link: old,
        revision: state.revision
      };
    }
    const context = await this.execute({
        username,
        asOf
      }),
      found = [...context.items, ...context.containers].some(item => keyOf(item.ref) === keyOf(workRef));
    if (!found || !context.coverage.complete) throw workError('WORK_REF_NOT_AVAILABLE');
    const link = {
      id,
      username,
      kbObjectId,
      workRef: {provider:workRef.provider,accountId:workRef.accountId,kind:workRef.kind,id:workRef.id},
      relation,
      basisRefs: [...basisRefs],
      confirmedAt: asOf
    };
    const result = await this.#state.transact({
      username,
      id: 'confirm:' + id,
      expectedRevision,
      events: [{
        type: 'link.confirmed',
        link
      }],
      asOf
    });
    return {
      ...result,
      link
    };
  }
}
