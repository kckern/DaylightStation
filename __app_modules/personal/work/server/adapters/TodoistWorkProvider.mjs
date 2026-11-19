import { createHash } from 'node:crypto';
import { IWorkProvider } from '../application/ports/IWorkProvider.mjs';
import { readWorkSnapshot, getWorkItem, readCapabilities, normalizeItem } from './workObservationProjection.mjs';
import { TODOIST_WORK_OPERATIONS, todoistRequest } from './TodoistWorkClient.mjs';
import { keyOf, validateWorkRef, WORK_OPERATIONS } from '../domain/workModel.mjs';
const result = (outcome, reason, extra = {}) => ({
  outcome,
  reason,
  ref: null,
  item: null,
  observation: null,
  retryAfter: null,
  ...extra
});
const confirmed = new Set(['reopen', 'create_task', 'update_task', 'delete_task', 'create_container', 'rename_container', 'archive_container']);
const same = (a, b) => keyOf(a) === keyOf(b);
const failed = response => response.status === 401 || response.status === 403 ? result('denied', 'provider_permission') : response.status === 429 ? result('failed', 'rate_limited', {
  retryAfter: response.retryAfter ?? null
}) : response.status >= 500 ? result('uncertain', 'provider_unavailable') : result('failed', 'provider_rejected');
/** Cached observations and live, independently authorized command dispatch. */
export class TodoistWorkProvider extends IWorkProvider {
  /** Provider vocabulary the application layer reads instead of keying on a provider type. */
  static descriptor = Object.freeze({
    containerNoun: 'project',
    assigneeField: 'single'
  });
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
    if (typeof loadCurrent !== 'function' || typeof loadHistory !== 'function' || typeof resolvePolicy !== 'function' || typeof accountId !== 'string' || typeof verifyDispatch !== 'function') throw new TypeError('Todoist work dependencies required');
    this.#options = {
      loadCurrent,
      loadHistory,
      resolvePolicy,
      accountId,
      provider: 'todoist'
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
      if (!policy?.enabled || ref.provider !== 'todoist' || ref.accountId !== this.#options.accountId) return null;
      const domains = Object.values(policy.domains).filter(d => {
        const p = policy.providers[d.provider];
        return p.type === 'todoist' && p.accountId === this.#options.accountId && p.operations.includes('read');
      });
      for (const domain of domains) {
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
    });
    const policy = this.#options.resolvePolicy(username);
    return Object.fromEntries(WORK_OPERATIONS.map(operation => [operation, operation === 'read' ? read.read : Boolean(read.read && this.#client && policy.providerWrites && policy.writer.write && TODOIST_WORK_OPERATIONS.includes(operation) && Object.values(policy.providers).some(p => p.type === 'todoist' && p.accountId === this.#options.accountId && p.operations.includes(operation)))]));
  }
  #route(username, command) {
    const policy = this.#options.resolvePolicy(username),
      domain = policy?.domains?.[command?.domainId],
      provider = domain && policy.providers[domain.provider];
    if (!policy?.enabled || !policy.writer.write || !policy.providerWrites || !this.#client || command?.username !== username || typeof command.id !== 'string' || !command.id || !TODOIST_WORK_OPERATIONS.includes(command.operation) || command.operation === 'read' || provider?.type !== 'todoist' || provider.accountId !== this.#options.accountId || !provider.operations.includes('read') || !provider.operations.includes(command.operation)) return null;
    if (confirmed.has(command.operation) && !command.confirmationId) return null;
    if (command.policyRevision && command.policyRevision !== policy.revision) return null;
    const create = command.operation.startsWith('create_');
    if (!create) {
      validateWorkRef(command.ref);
      if (command.ref.provider !== 'todoist' || command.ref.accountId !== this.#options.accountId) return null;
    } else if (command.ref !== null) return null;
    if (!create && command.ref.kind === 'container' && command.ref.id !== domain.containerId) return null;
    if (command.operation === 'create_task' && command.payload.containerId !== domain.containerId) return null;
    if (command.operation === 'create_container' && (!domain.creationParentId || command.payload.parentId !== domain.creationParentId)) return null;
    if (domain.assigneeIds && command.payload.assigneeId && !domain.assigneeIds.includes(command.payload.assigneeId) || domain.assigneeIds && command.operation === 'create_task' && !domain.assigneeIds.includes(command.payload.assigneeId)) return null;
    todoistRequest({
      operation: command.operation,
      ref: command.ref,
      payload: command.payload
    });
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
    const response = await this.#client.request({
      username,
      operation: 'read',
      ref
    });
    if (!response.ok) return {
      failure: response.status === 404 ? result('conflict', 'missing_live_item') : failed(response)
    };
    const row = response.data;
    if (!row || typeof row.id !== 'string' || row.id !== ref.id || row.is_deleted === true) return {
      failure: result('conflict', 'live_ref_mismatch')
    };
    if (ref.kind === 'container') {
      if (ref.id !== route.domain.containerId && ref.id !== route.domain.creationParentId) return {
        failure: result('denied', 'out_of_scope')
      };
      const version = createHash('sha256').update(JSON.stringify({
        id: row.id,
        name: row.name,
        parent_id: row.parent_id ?? null,
        is_archived: row.is_archived === true,
        is_deleted: row.is_deleted === true
      })).digest('hex');
      return {
        row,
        item: {
          ref,
          title: row.name,
          version,
          archived: row.is_archived === true
        }
      };
    }
    const item = normalizeItem({
      row,
      provider: 'todoist',
      accountId: this.#options.accountId,
      observedAt: asOf,
      timezone: route.policy.timezone
    });
    if (!same(item.ref, ref) || item.containerRef?.id !== route.domain.containerId || route.domain.assigneeIds && !route.domain.assigneeIds.some(id => item.assigneeIds.includes(id))) return {
      failure: result('denied', 'out_of_scope')
    };
    return {
      row,
      item
    };
  }
  #readback(command, live) {
    if (live.failure) return null;
    if (command.operation === 'complete') return !live.item.due?.recurring && live.item.status?.category === 'done';
    if (command.operation === 'reopen') return live.item.status?.category === 'open' && live.item.version !== command.expectedVersion;
    if (command.operation === 'archive_container') return live.item.archived === true;
    if (command.operation === 'rename_container') return live.item.title === command.payload.title;
    if (command.operation === 'update_task') return Object.entries(command.payload).every(([key, value]) => key === 'title' ? live.item.title === value : key === 'description' ? live.item.description === value : key === 'dueDate' ? live.item.due?.date === value : key === 'assigneeId' ? live.item.assigneeIds.includes(value) : false);
    return false;
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
      const create = command.operation.startsWith('create_');
      const ref = create ? {
        provider: 'todoist',
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
      if (!command.expectedVersion || before.item.version !== command.expectedVersion) return result('conflict', 'version_changed', {
        ref
      });
      if (!before.item.due?.recurring && (command.operation === 'complete' && before.item.status?.category === 'done' || command.operation === 'reopen' && before.item.status?.category === 'open')) return result('already_applied', null, {
        ref,
        item: before.item
      });
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
        payload: command.payload
      });
      if (!response.ok) return failed(response);
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
        provider: 'todoist',
        accountId: this.#options.accountId,
        kind: command.operation === 'create_task' ? 'task' : 'container',
        id: response.data.id
      } : null;
      if (create && !createdRef) return result('uncertain', 'created_ref_unknown');
      // New projects are only visible under their explicitly configured parent.
      const readRoute = command.operation === 'create_container' ? {
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
        route: readRoute
      });
      if (create) {
        const taskFields = Object.fromEntries(Object.entries(command.payload).filter(([key]) => key !== 'containerId'));
        const valid = !after.failure && after.item.title === command.payload.title && (command.operation === 'create_task' ? this.#readback({
          ...command,
          operation: 'update_task',
          payload: taskFields
        }, after) : after.row.parent_id === route.domain.creationParentId);
        return valid ? result('applied', null, {
          ref: createdRef,
          item: (createdRef ?? ref).kind === 'container' ? null : after.item
        }) : result('uncertain', 'create_not_verified', {
          ref: createdRef
        });
      }
      const recurringConfirmed = command.operation === 'complete' && before.item.due?.recurring && !after.failure && Number.isSafeInteger(before.row.completed_count) && after.row.completed_count === before.row.completed_count + 1;
      return recurringConfirmed || this.#readback(command, after) ? result('applied', null, {
        ref,
        item: (createdRef ?? ref).kind === 'container' ? null : after.item
      }) : result('uncertain', 'mutation_not_verified', {
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
      if (!command.ref || command.operation === 'delete_task' || command.operation.startsWith('create_')) return result('uncertain', 'manual_resolution_required');
      const live = await this.#live({
        username,
        ref: command.ref,
        asOf,
        route
      });
      return this.#readback(command, live) ? result('already_applied', null, {
        ref: command.ref,
        item: command.ref.kind === 'container' ? null : live.item
      }) : result('uncertain', 'mutation_not_verified', {
        ref: command.ref
      });
    } catch {
      return result('uncertain', 'reconciliation_unavailable');
    }
  }
}
