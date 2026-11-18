import { canonicalWorkEvent } from '../domain/workCommands.mjs';
import { accountKey, workHash, workError } from '../domain/workState.mjs';
/** Inbound facts may acknowledge commands, but never dispatch one. */
export class ReconcileWork {
  #state;
  #policy;
  constructor({
    state,
    resolvePolicy
  }) {
    if (!state?.read || !state?.transact || typeof resolvePolicy !== 'function') throw new TypeError('Work reconciliation dependencies required');
    this.#state = state;
    this.#policy = resolvePolicy;
  }
  async observe({
    username,
    provider: explicitProvider,
    snapshot,
    events = [],
    asOf
  }) {
    const policy = this.#policy(username),
      coverage = {
        ...snapshot?.coverage
      };
    const empty = reason => ({
      newEvents: [],
      acknowledgedCommandIds: [],
      coverage: {
        ...coverage,
        complete: false,
        reason
      }
    });
    if (!policy.enabled || snapshot?.coverage?.complete !== true || !Number.isFinite(asOf) || !Number.isFinite(snapshot.observedAt) || snapshot.observedAt > asOf || asOf - snapshot.observedAt > policy.limits.snapshotMaxAgeHours * 3600000 || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.containers) || !Array.isArray(events)) return empty('incomplete_or_invalid_snapshot');
    const scope = snapshot.coverage.scope;
    if (!scope || typeof scope.accountId !== 'string' || !Array.isArray(scope.containerIds) || scope.containerIds.length === 0) return empty('unscoped_snapshot');
    const bindings = Object.values(policy.providers).filter(p => p.accountId === scope.accountId && (!explicitProvider || p.type === explicitProvider) && p.operations.includes('read'));
    const types = [...new Set(bindings.map(p => p.type))];
    if (types.length !== 1) return empty('ambiguous_provider');
    const provider = types[0],
      key = accountKey({
        provider,
        accountId: scope.accountId
      });
    const domains = Object.values(policy.domains).filter(d => policy.providers[d.provider]?.type === provider && policy.providers[d.provider]?.accountId === scope.accountId);
    if (scope.containerIds.some(id => !domains.some(d => d.containerId === id)) || snapshot.items.some(item => item.ref.provider !== provider || item.ref.accountId !== scope.accountId || !scope.containerIds.includes(item.containerRef?.id) || !domains.some(d => d.containerId === item.containerRef?.id && (!d.assigneeIds || d.assigneeIds.some(id => item.assigneeIds.includes(id)))))) return empty('out_of_scope_snapshot');
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      if (state.snapshots[key]?.observedAt > snapshot.observedAt) return empty('out_of_order_snapshot');
      const baseline = state.baselines?.[key],
        writes = [],
        newEvents = [],
        acknowledgedCommandIds = [];
      if (!baseline) writes.push({
        type: 'observation.baseline',
        provider,
        accountId: scope.accountId,
        at: snapshot.observedAt
      });else for (const raw of events) {
        const event = canonicalWorkEvent(raw, {
          username,
          policy,
          asOf
        });
        if (!event || event.ref.provider !== provider || event.ref.accountId !== scope.accountId || !scope.containerIds.includes(event.containerRef.id) || event.occurredAt <= baseline.at) continue;
        for (const record of Object.values(state.commands)) if (record.status === 'applied' && record.result?.observation?.id === event.id && !acknowledgedCommandIds.includes(record.command.id)) acknowledgedCommandIds.push(record.command.id);
        if (state.activities[event.id] || newEvents.some(e => e.id === event.id)) continue;
        newEvents.push(event);
        writes.push({
          type: 'activity.observed',
          event
        });
        for (const record of Object.values(state.commands)) {
          const command = record.command;
          if (!['dispatching', 'uncertain'].includes(record.status) || !command.ref || command.ref.provider !== event.ref.provider || command.ref.accountId !== event.ref.accountId || command.ref.id !== event.ref.id || event.occurredAt < command.createdAt || command.operation !== 'complete' || event.type !== 'completed') continue;
          // Only exact read-only reconciliation may resolve recurring or ambiguous effects.
          if (record.recurring && record.expectedOccurrenceId !== event.occurrenceId || acknowledgedCommandIds.includes(command.id)) continue;
          if (event.causationId !== command.id) continue;
          acknowledgedCommandIds.push(command.id);
          writes.push({
            type: 'command.finished',
            commandId: command.id,
            result: {
              outcome: 'already_applied',
              ref: event.ref,
              item: null,
              observation: event,
              reason: null,
              retryAfter: null
            }
          });
        }
      }
      if (!state.snapshots[key] || snapshot.observedAt > state.snapshots[key].observedAt || snapshot.revision !== state.snapshots[key].revision) writes.push({
        type: 'snapshot.observed',
        provider,
        accountId: scope.accountId,
        snapshot
      });
      if (!writes.length) return {
        newEvents,
        acknowledgedCommandIds,
        coverage
      };
      try {
        await this.#state.transact({
          username,
          id: 'observe:' + workHash([key, snapshot.observedAt, snapshot.revision, newEvents.map(e => e.id)]),
          expectedRevision: state.revision,
          events: writes,
          asOf
        });
        return {
          newEvents,
          acknowledgedCommandIds,
          coverage
        };
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    throw workError('STALE_WORK_REVISION');
  }
}
