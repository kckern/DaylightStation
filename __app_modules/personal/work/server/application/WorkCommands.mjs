import { planCommand, canonicalWorkEvent } from '../domain/workCommands.mjs';
import { routeWork } from '../domain/workPolicy.mjs';
import { keyOf } from '../domain/workModel.mjs';
import { accountKey, workHash, workError } from '../domain/workState.mjs';
const outcome = (value, reason) => ({
  outcome: value,
  reason,
  ref: null,
  item: null,
  observation: null,
  retryAfter: null
});
const terminal = new Set(['applied', 'conflict', 'denied', 'failed']);
/** External effects occur only after the canonical log records a dispatch attempt. */
export class WorkCommands {
  #state;
  #providers;
  #context;
  #policy;
  #verify;
  #clock;
  #active = new Map();
  #logger;
  constructor({
    state,
    providers,
    context,
    resolvePolicy,
    verifyPrincipal,
    clock,
    logger
  }) {
    if (!state?.read || !state?.transact || !(providers instanceof Map) || typeof context?.execute !== 'function' || typeof resolvePolicy !== 'function' || typeof verifyPrincipal !== 'function' || typeof clock !== 'function') throw new TypeError('Work command dependencies required');
    this.#state = state;
    this.#providers = providers;
    this.#context = context;
    this.#policy = resolvePolicy;
    this.#verify = verifyPrincipal;
    this.#clock = clock;
    this.#logger = logger;
  }
  async #change(username, id, asOf, build) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await this.#state.read({
        username
      });
      if (!state.health.available) throw workError('WORK_STATE_UNAVAILABLE');
      const events = build(state);
      if (!events?.length) return {
        ...state,
        transactionApplied: false
      };
      try {
        const receipt = await this.#state.transact({
          username,
          id,
          expectedRevision: state.revision,
          events,
          asOf
        });
        return {
          ...(await this.#state.read({
            username
          })),
          transactionApplied: receipt.applied
        };
      } catch (error) {
        if (error.code !== 'STALE_WORK_REVISION') throw error;
      }
    }
    throw workError('STALE_WORK_REVISION');
  }
  #actor(principal) {
    const actor = this.#verify(principal);
    if (!actor?.authored) throw workError('WORK_PRINCIPAL_REQUIRED');
    return actor;
  }
  #provider(record) {
    const p = this.#policy(record.command.username).providers?.[this.#policy(record.command.username).domains?.[record.command.domainId]?.provider];
    return p ? this.#providers.get(accountKey({
      provider: p.type,
      accountId: p.accountId
    })) : null;
  }
  #allowed(record) {
    const policy = this.#policy(record.command.username);
    return policy.revision === record.policyRevision && !routeWork({
      policy,
      domainId: record.command.domainId,
      operation: record.command.operation
    }).denied && this.#provider(record)?.capabilities({
      username: record.command.username
    })?.[record.command.operation] === true;
  }
  async #source(principal, record, asOf) {
    if (typeof this.#context.verifySource !== 'function') return false;
    return (await this.#context.verifySource({
      principal,
      intent: record.intent,
      command: record.command,
      asOf
    })) === true;
  }
  async propose({
    principal,
    intent,
    asOf = this.#clock()
  }) {
    const actor = this.#actor(principal),
      username = actor.username,
      policy = this.#policy(username);
    if (!(await this.#source(principal, {
      intent,
      command: null
    }, asOf))) throw workError('WORK_SOURCE_REQUIRED');
    const context = await this.#context.execute({
      username,
      domainIds: [intent.domainId],
      asOf
    });
    if (!context.coverage.complete) throw workError('WORK_CONTEXT_UNAVAILABLE');
    const domain = policy.domains[intent.domainId],
      binding = domain && policy.providers[domain.provider];
    if (!binding) throw workError('WORK_ROUTE_DENIED');
    const provider = this.#providers.get(accountKey({
      provider: binding.type,
      accountId: binding.accountId
    }));
    if (!provider?.capabilities({
      username
    })?.[intent.operation]) throw workError('WORK_CAPABILITY_DENIED');
    const create = intent.operation.startsWith('create_'),
      target = create ? {
        provider: binding.type,
        accountId: binding.accountId,
        kind: 'container',
        id: intent.operation === 'create_task' ? domain.containerId : domain.creationParentId
      } : intent.ref;
    const found = [...context.items, ...context.containers].find(item => keyOf(item.ref) === keyOf(target));
    const stored = intent.operation === 'reopen' ? await this.#state.read({
      username
    }) : null;
    const knownCompleted = intent.operation === 'reopen' && ((context.events ?? []).some(e => e.type === 'completed' && keyOf(e.ref) === keyOf(target)) || Object.values(stored.commands).some(r => r.status === 'applied' && r.command.operation === 'complete' && keyOf(r.command.ref) === keyOf(target)));
    if (!found && !knownCompleted && !(intent.operation === 'create_container' && target.id === domain.creationParentId)) throw workError('WORK_REF_NOT_AVAILABLE');
    const item = await provider.getItem({
      username,
      ref: target,
      asOf
    });
    if (!item || keyOf(item.ref) !== keyOf(target)) throw workError('WORK_REF_NOT_AVAILABLE');
    const expected = intent.expectedVersion ?? (target.kind === 'task' ? found?.version : null);
    if (expected && item.version !== expected || intent.mode === 'auto' && (!expected || expected !== found?.version || context.items.filter(row => row.title === item.title).length !== 1) || intent.expectedOccurrenceId !== undefined && intent.expectedOccurrenceId !== (item.due?.occurrenceId ?? null)) throw workError('WORK_SELECTION_CHANGED');
    const links = context.links.filter(link => keyOf(link.workRef) === keyOf(item.ref) && link.relation === 'same_commitment');
    const planned = planCommand({
      intent,
      item,
      link: links.length === 1 ? links[0] : null,
      policy,
      principal: actor,
      asOf
    });
    if (planned.denied) throw workError(planned.denied);
    const record = {
      command: planned.command,
      status: 'queued',
      requiresConfirmation: planned.requiresConfirmation,
      policyRevision: policy.revision,
      intent: structuredClone(intent),
      sourceActorReceipt: actor.receiptId,
      destination: structuredClone(target),
      display: {
        title: item.title,
        destinationTitle: create ? item.title : context.containers.find(row => row.ref.id === domain.containerId && row.ref.provider === binding.type && row.ref.accountId === binding.accountId)?.title ?? context.containers.find(row => row.ref.id === domain.containerId && row.ref.provider === binding.type && row.ref.accountId === binding.accountId)?.name ?? intent.domainId
      },
      recurring: item.due?.recurring === true,
      expectedOccurrenceId: item.due?.occurrenceId ?? null,
      result: null
    };
    const state = await this.#change(username, 'queue:' + planned.command.id, asOf, current => current.commands[planned.command.id] ? [] : [{
      type: 'command.queued',
      record
    }]);
    const saved = state.commands[planned.command.id];
    if (state.transactionApplied) this.#logger?.info?.('work.command.queued', {
      operation: saved.command.operation,
      requiresConfirmation: saved.requiresConfirmation
    });
    return {
      decisionId: null,
      command: saved.command,
      requiresConfirmation: saved.requiresConfirmation
    };
  }
  async verifyDispatch({
    username,
    command,
    asOf = this.#clock()
  }) {
    const active = this.#active.get(command.id);
    if (!active || active.username !== username || !this.#verify(active.principal)) return false;
    const state = await this.#state.read({
        username
      }),
      record = state.commands[command.id];
    return state.health.available && record?.status === 'dispatching' && workHash(record.command) === workHash(command) && this.#allowed(record) && (await this.#source(active.principal, record, asOf));
  }
  async #finish(record, result, asOf, {
    reconciled = false
  } = {}) {
    const username = record.command.username,
      policy = this.#policy(username);
    if (['applied', 'already_applied'].includes(result?.outcome)) {
      const expected = record.destination ?? record.command.ref;
      const ref = result.ref;
      if (!ref || ref.provider !== expected.provider || ref.accountId !== expected.accountId || record.command.ref && keyOf(ref) !== keyOf(record.command.ref) || result.item && keyOf(result.item.ref) !== keyOf(ref)) result = outcome('uncertain', 'provider_result_scope_mismatch');
    }
    const observed = (result.outcome === 'applied' || reconciled && result.outcome === 'already_applied') && result.observation ? canonicalWorkEvent(result.observation, {
      username,
      policy,
      asOf
    }) : null;
    const safe = {
      ...result,
      observation: observed
    };
    await this.#change(username, `finish:${record.command.id}:${reconciled ? 'reconciled' : 'dispatch'}:${workHash(safe)}${reconciled ? ':' + asOf : ''}`, asOf, state => {
      const current = state.commands[record.command.id];
      if (terminal.has(current.status)) return [];
      return [{
        type: 'command.finished',
        ...(reconciled ? {
          reconciledAt: asOf
        } : {}),
        commandId: record.command.id,
        result: safe
      }, ...(observed && !state.activities[observed.id] ? [{
        type: 'activity.observed',
        event: observed
      }] : [])];
    });
    this.#logger?.info?.('work.command.finished', {
      operation: record.command.operation,
      outcome: safe.outcome,
      observed: Boolean(observed)
    });
    return safe;
  }
  async execute({
    principal,
    commandId,
    confirmationId = null,
    asOf = this.#clock()
  }) {
    let actor;
    try {
      actor = this.#actor(principal);
    } catch {
      return outcome('denied', 'principal_required');
    }
    const username = actor.username;
    let record,
      active = null;
    try {
      const initial = await this.#state.read({
        username
      });
      record = initial.commands[commandId];
      if (!initial.health.available || !record) return outcome('denied', 'command_unavailable');
      if (terminal.has(record.status)) return record.result;
      if (record.status === 'dispatching' || record.status === 'uncertain') return outcome('uncertain', 'reconciliation_required');
      if (!this.#allowed(record) || !(await this.#source(principal, record, asOf))) return outcome('denied', 'route_or_source_revoked');
      if (record.requiresConfirmation) {
        if (typeof this.#context.verifyConfirmation !== 'function' || !(await this.#context.verifyConfirmation({
          principal,
          command: record.command,
          confirmationId,
          asOf
        }))) return outcome('denied', 'bound_confirmation_required');
      } else if (actor.receiptId !== record.sourceActorReceipt) return outcome('denied', 'wrong_source_principal');
      let reserved = false;
      const state = await this.#change(username, 'dispatch:' + commandId, asOf, current => {
        reserved = false;
        if (current.commands[commandId].status !== 'queued') return [];
        reserved = true;
        return [{
          type: 'command.dispatched',
          commandId,
          confirmationId,
          at: asOf
        }];
      });
      if (!reserved || !state.transactionApplied) return state.commands[commandId].result ?? outcome('uncertain', 'dispatch_already_reserved');
      record = state.commands[commandId];
      active = {
        username,
        principal
      };
      this.#active.set(commandId, active);
      if (!(await this.verifyDispatch({
        username,
        command: record.command,
        asOf
      }))) return await this.#finish(record, outcome('denied', 'dispatch_authority_revoked'), asOf);
      this.#logger?.info?.('work.command.reserved', {
        operation: record.command.operation
      });
      let result;
      try {
        result = await this.#provider(record).execute({
          username,
          command: structuredClone(record.command),
          asOf
        });
      } catch {
        result = outcome('uncertain', 'provider_threw_after_dispatch');
      }
      return await this.#finish(record, result, asOf);
    } catch {
      return outcome('uncertain', 'durable_boundary_failed');
    } finally {
      if (record && active && this.#active.get(record.command.id) === active) this.#active.delete(record.command.id);
    }
  }
  async reconcile({
    username,
    commandId,
    asOf = this.#clock()
  }) {
    try {
      let state = await this.#state.read({
          username
        }),
        record = state.commands[commandId];
      if (!state.health.available || !record) return outcome('denied', 'command_unavailable');
      if (terminal.has(record.status)) return record.result;
      if (record.status === 'queued') return outcome('failed', 'not_dispatched');
      if (record.status === 'dispatching') {
        state = await this.#change(username, 'quarantine:' + commandId, asOf, current => current.commands[commandId].status === 'dispatching' ? [{
          type: 'command.quarantined',
          commandId,
          at: asOf
        }] : []);
        record = state.commands[commandId];
      }
      if (!this.#allowed(record)) return outcome('denied', 'route_revoked');
      const result = await this.#provider(record).reconcile({
        username,
        command: structuredClone(record.command),
        asOf
      });
      return await this.#finish(record, result, asOf, {
        reconciled: true
      });
    } catch {
      return outcome('uncertain', 'reconciliation_unavailable');
    }
  }
}
