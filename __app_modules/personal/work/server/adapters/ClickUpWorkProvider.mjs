import { IWorkProvider } from '../application/ports/IWorkProvider.mjs';
import { readWorkSnapshot, getWorkItem, readCapabilities, normalizeItem } from './workObservationProjection.mjs';
import { CLICKUP_WORK_OPERATIONS, clickUpRequest } from './ClickUpWorkClient.mjs';
import { validateWorkRef, WORK_OPERATIONS } from '../domain/workModel.mjs';
import { workHash, stableWorkJson } from '../domain/workState.mjs';
const result = (outcome, reason, extra = {}) => ({
  outcome,
  reason,
  ref: null,
  item: null,
  observation: null,
  retryAfter: null,
  ...extra
});
const failure = response => response.status === 401 || response.status === 403 ? result('denied', 'provider_permission') : response.status === 429 ? result('failed', 'rate_limited', {
  retryAfter: response.retryAfter ?? null
}) : response.status >= 500 ? result('uncertain', 'provider_unavailable') : result('failed', 'provider_rejected');
/** Board workflow remains provider-owned; every mutation is explicitly confirmed. */
export class ClickUpWorkProvider extends IWorkProvider {
  #options;
  #client;
  #verify;
  constructor({
    loadCurrent,
    loadHistory,
    resolvePolicy,
    accountId,
    client = null,
    verifyDispatch = async () => false
  }) {
    super();
    if (typeof loadCurrent !== 'function' || typeof loadHistory !== 'function' || typeof resolvePolicy !== 'function' || typeof accountId !== 'string' || typeof verifyDispatch !== 'function') throw new TypeError('ClickUp work dependencies required');
    this.#options = {
      loadCurrent,
      loadHistory,
      resolvePolicy,
      accountId,
      provider: 'clickup'
    };
    this.#client = client;
    this.#verify = verifyDispatch;
  }
  readSnapshot({
    username,
    scope,
    asOf
  }) {
    return readWorkSnapshot({
      ...this.#options,
      username,
      scope,
      asOf
    });
  }
  async getItem({
    username,
    ref,
    asOf
  }) {
    if (!this.#client) return getWorkItem({
      ...this.#options,
      username,
      ref,
      asOf
    });
    try {
      validateWorkRef(ref);
      const policy = this.#options.resolvePolicy(username);
      if (!policy?.enabled || ref.provider !== 'clickup' || ref.accountId !== this.#options.accountId) return null;
      for (const domain of Object.values(policy.domains)) {
        const provider = policy.providers[domain.provider];
        if (provider.type !== 'clickup' || provider.accountId !== this.#options.accountId || !provider.operations.includes('read')) continue;
        const live = await this.#live({
          username,
          ref,
          asOf,
          route: {
            policy,
            domain
          }
        });
        if (!live.failure) return live.item;
      }
      return null;
    } catch {
      return null;
    }
  }
  capabilities({
    username
  }) {
    const read = readCapabilities({
        ...this.#options,
        username
      }),
      policy = this.#options.resolvePolicy(username);
    return Object.fromEntries(WORK_OPERATIONS.map(operation => [operation, operation === 'read' ? read.read : Boolean(read.read && this.#client && policy.providerWrites && policy.writer.write && CLICKUP_WORK_OPERATIONS.includes(operation) && Object.values(policy.providers).some(p => p.type === 'clickup' && p.accountId === this.#options.accountId && p.operations.includes(operation)))]));
  }
  #route(username, command) {
    const policy = this.#options.resolvePolicy(username),
      domain = policy?.domains?.[command?.domainId],
      provider = domain && policy.providers[domain.provider];
    if (!policy?.enabled || !policy.writer.write || !policy.providerWrites || !this.#client || command?.username !== username || typeof command.id !== 'string' || !command.id || !command.confirmationId || !CLICKUP_WORK_OPERATIONS.includes(command.operation) || command.operation === 'read' || provider?.type !== 'clickup' || provider.accountId !== this.#options.accountId || !provider.operations.includes('read') || !provider.operations.includes(command.operation) || command.policyRevision && command.policyRevision !== policy.revision) return null;
    const create = command.operation.startsWith('create_');
    if (create) {
      if (command.ref !== null) return null;
    } else {
      validateWorkRef(command.ref);
      if (command.ref.provider !== 'clickup' || command.ref.accountId !== this.#options.accountId || command.ref.kind === 'container' && command.ref.id !== domain.containerId) return null;
    }
    if (command.operation === 'create_task' && command.payload.containerId !== domain.containerId || command.operation === 'create_container' && (!domain.creationParentId || command.payload.parentId !== domain.creationParentId)) return null;
    if (command.operation === 'create_task' && domain.assigneeIds && (!command.payload.assigneeIds?.length || !command.payload.assigneeIds.every(id => domain.assigneeIds.includes(id)))) return null;
    return {
      policy,
      domain
    };
  }
  async #live({
    username,
    ref,
    asOf,
    route
  }) {
    const folder = ref.kind === 'container' && ref.id === route.domain.creationParentId && ref.id !== route.domain.containerId;
    if (ref.kind === 'container' && ref.id !== route.domain.containerId && !folder) return {
      failure: result('denied', 'out_of_scope')
    };
    const response = await this.#client.request({
      username,
      operation: 'read',
      ref,
      payload: folder ? {
        nativeKind: 'folder'
      } : {}
    });
    if (!response.ok) return {
      failure: response.status === 404 ? result('conflict', 'missing_live_item') : failure(response)
    };
    const row = response.data;
    if (ref.kind === 'container') return {
      row,
      item: {
        ref,
        title: row.name,
        nativeKind: folder ? 'folder' : 'list',
        version: workHash(row)
      }
    };
    const item = normalizeItem({
      row,
      provider: 'clickup',
      accountId: this.#options.accountId,
      observedAt: asOf,
      timezone: route.policy.timezone
    });
    if (item.containerRef?.id !== route.domain.containerId || route.domain.assigneeIds && !route.domain.assigneeIds.some(id => item.assigneeIds.includes(id))) return {
      failure: result('denied', 'out_of_scope')
    };
    return {
      row,
      item
    };
  }
  async #payload({
    username,
    command,
    route,
    asOf
  }) {
    let payload = command.payload;
    if (['transition', 'complete', 'reopen'].includes(command.operation)) {
      if (!payload || Object.keys(payload).some(k => command.operation !== 'transition' || k !== 'transition')) return {
        failure: result('denied', 'invalid_transition')
      };
      const semantic = command.operation === 'transition' ? payload.transition : command.operation,
        status = route.domain.transitions?.[semantic];
      if (!status) return {
        failure: result('denied', 'unmapped_transition')
      };
      const list = await this.#live({
        username,
        ref: {
          provider: 'clickup',
          accountId: this.#options.accountId,
          kind: 'container',
          id: route.domain.containerId
        },
        asOf,
        route
      });
      if (list.failure || !Array.isArray(list.row.statuses)) return {
        failure: result('conflict', 'list_statuses_unavailable')
      };
      const definition = list.row.statuses.find(s => s.status === status);
      if (!definition || command.operation === 'complete' && !['done', 'closed'].includes(definition.type) || command.operation === 'reopen' && ['done', 'closed'].includes(definition.type)) return {
        failure: result('conflict', 'invalid_native_status')
      };
      payload = {
        status
      };
    }
    clickUpRequest({
      operation: command.operation,
      ref: command.ref,
      payload
    });
    return {
      payload
    };
  }
  #matches(command, payload, live) {
    if (live.failure) return false;
    if (['transition', 'complete', 'reopen'].includes(command.operation)) return live.item.status?.native === payload.status;
    if (command.operation === 'archive_task') return live.row.archived === true;
    if (command.operation === 'update_task' || command.operation === 'rename_container') return Object.entries(payload).every(([key, value]) => live.item[key] === value);
    return false;
  }
  #unrequestedChange(command, before, after) {
    const omitted = new Set(['version', 'observedAt', 'modifiedAt', 'completedAt']);
    if (command.operation === 'update_task') Object.keys(command.payload).forEach(k => omitted.add(k));
    if (['transition', 'complete', 'reopen'].includes(command.operation)) omitted.add('status');
    if (command.operation === 'rename_container') omitted.add('title');
    const select = item => Object.fromEntries(Object.entries(item).filter(([key]) => !omitted.has(key)));
    return stableWorkJson(select(before.item)) !== stableWorkJson(select(after.item));
  }
  async execute({
    username,
    command,
    asOf
  }) {
    let dispatched = false;
    try {
      const route = this.#route(username, command);
      if (!route || !(await this.#verify({
        username,
        command,
        asOf
      }))) return result('denied', 'dispatch_not_authorized');
      const create = command.operation.startsWith('create_'),
        ref = create ? {
          provider: 'clickup',
          accountId: this.#options.accountId,
          kind: 'container',
          id: command.operation === 'create_task' ? route.domain.containerId : route.domain.creationParentId
        } : command.ref;
      const before = await this.#live({
        username,
        ref,
        asOf,
        route
      });
      if (before.failure) return before.failure;
      if (!command.expectedVersion || command.expectedVersion !== before.item.version) return result('conflict', 'version_changed', {
        ref
      });
      const prepared = await this.#payload({
        username,
        command,
        route,
        asOf
      });
      if (prepared.failure) return prepared.failure;
      if (['transition', 'complete', 'reopen'].includes(command.operation)) {
        const latest = await this.#live({
          username,
          ref,
          asOf,
          route
        });
        if (latest.failure) return latest.failure;
        if (latest.item.version !== before.item.version) return result('conflict', 'version_changed', {
          ref
        });
      }
      const current = this.#route(username, command);
      if (!current || current.policy.revision !== route.policy.revision || !(await this.#verify({
        username,
        command,
        asOf
      }))) return result('denied', 'dispatch_not_authorized');
      dispatched = true;
      const response = await this.#client.request({
        username,
        operation: command.operation,
        authorizeSend: now => this.#verify({
          username,
          command,
          asOf: now
        }),
        ref: command.ref,
        payload: prepared.payload
      });
      if (!response.ok) return failure(response);
      if (command.operation === 'delete_task') {
        const after = await this.#client.request({
          username,
          operation: 'read',
          ref
        });
        return after.status === 404 ? result('applied', null, {
          ref
        }) : result('uncertain', 'delete_not_verified', {
          ref
        });
      }
      const createdRef = create && typeof response.data?.id === 'string' ? {
        provider: 'clickup',
        accountId: this.#options.accountId,
        kind: command.operation === 'create_task' ? 'task' : 'container',
        id: response.data.id
      } : null;
      if (create && !createdRef) return result('uncertain', 'created_ref_unknown');
      const nextRoute = command.operation === 'create_container' ? {
        ...route,
        domain: {
          ...route.domain,
          containerId: createdRef.id
        }
      } : route;
      const after = await this.#live({
        username,
        ref: createdRef ?? ref,
        asOf,
        route: nextRoute
      });
      if (after.failure) return result('uncertain', 'readback_unavailable', {
        ref: createdRef ?? ref
      });
      if (create) {
        if (after.item.title !== command.payload.title || command.operation === 'create_container' && after.row.folder?.id !== route.domain.creationParentId || command.operation === 'create_task' && (command.payload.description !== undefined && after.item.description !== command.payload.description || command.payload.assigneeIds && stableWorkJson([...after.item.assigneeIds].sort()) !== stableWorkJson([...command.payload.assigneeIds].sort()))) return result('conflict', 'create_readback_conflict', {
          ref: createdRef
        });
        return result('applied', null, {
          ref: createdRef,
          item: createdRef.kind === 'task' ? after.item : null
        });
      }
      if (this.#unrequestedChange(command, before, after)) return result('conflict', 'concurrent_provider_change', {
        ref
      });
      return this.#matches(command, prepared.payload, after) ? result('applied', null, {
        ref,
        item: ref.kind === 'task' ? after.item : null
      }) : result('conflict', 'mutation_not_verified', {
        ref
      });
    } catch {
      return result(dispatched ? 'uncertain' : 'denied', dispatched ? 'transport_or_readback_failed' : 'invalid_or_unavailable_command');
    }
  }
  async reconcile({
    username,
    command,
    asOf
  }) {
    try {
      const route = this.#route(username, command);
      if (!route) return result('denied', 'reconciliation_not_authorized');
      if (!command.ref || command.operation === 'delete_task') return result('uncertain', 'manual_resolution_required');
      const live = await this.#live({
          username,
          ref: command.ref,
          asOf,
          route
        }),
        prepared = await this.#payload({
          username,
          command,
          route,
          asOf
        });
      if (prepared.failure) return prepared.failure;
      return this.#matches(command, prepared.payload, live) ? result('already_applied', null, {
        ref: command.ref,
        item: command.ref.kind === 'task' ? live.item : null
      }) : result('uncertain', 'mutation_not_verified');
    } catch {
      return result('uncertain', 'reconciliation_unavailable');
    }
  }
}
