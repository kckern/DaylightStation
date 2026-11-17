import { keyOf, validateWorkRef, WORK_OPERATIONS } from './workModel.mjs';
import { routeWork } from './workPolicy.mjs';
import { workHash } from './workState.mjs';
const same = (a, b) => a && b && keyOf(a) === keyOf(b);
const exactCompletion = (statement, title) => typeof statement === 'string' && typeof title === 'string' && new RegExp('^I (?:have |just )?(?:finished|completed) ' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[.!]?$', 'i').test(statement.trim());
/** The caller verifies principal/source trust; this pure function only narrows authority. */
export function planCommand({
  intent,
  item,
  link,
  policy,
  principal,
  asOf
}) {
  try {
    if (!principal?.authored || typeof principal.username !== 'string' || !Number.isFinite(asOf) || !intent || typeof intent.sourceReceipt !== 'string' || !intent.sourceReceipt || !WORK_OPERATIONS.includes(intent.operation) || intent.operation === 'read' || typeof intent.payload !== 'object' || !intent.payload || Array.isArray(intent.payload)) return {
      denied: 'invalid_command_intent'
    };
    const route = routeWork({
      policy,
      domainId: intent.domainId,
      operation: intent.operation
    });
    if (route.denied) return route;
    if (policy.username && policy.username !== principal.username) return {
      denied: 'wrong_user'
    };
    const domain = policy.domains[intent.domainId],
      create = intent.operation.startsWith('create_');
    if (!item?.ref || item.ref.provider !== route.provider || item.ref.accountId !== route.accountId) return {
      denied: 'wrong_account'
    };
    validateWorkRef(item.ref);
    if (create) {
      const destination = intent.operation === 'create_task' ? domain.containerId : domain.creationParentId;
      if (intent.ref !== null || !destination || item.ref.kind !== 'container' || item.ref.id !== destination || intent.operation === 'create_task' && intent.payload.containerId !== destination || intent.operation === 'create_container' && intent.payload.parentId !== destination) return {
        denied: 'wrong_destination'
      };
    } else if (!same(item.ref, intent.ref) || item.ref.kind === 'container' && item.ref.id !== domain.containerId || item.ref.kind === 'task' && item.containerRef?.id !== domain.containerId || item.ref.kind === 'task' && domain.assigneeIds && !domain.assigneeIds.some(id => item.assigneeIds.includes(id))) return {
      denied: 'wrong_destination'
    };
    if (link && link.username !== principal.username) return {
      denied: 'wrong_user'
    };
    const eligible = intent.operation === 'complete' && intent.mode === 'auto' && principal.kind === 'text' && !principal.edited && domain.role === 'tasks' && domain.autoComplete === 'linked_explicit' && link?.relation === 'same_commitment' && Number.isFinite(link.confirmedAt) && same(link.workRef, item.ref) && exactCompletion(intent.statement, item.title);
    const command = {
      id: 'command.' + workHash([principal.username, intent.sourceReceipt, intent.domainId, intent.operation, create ? null : item.ref, intent.payload]),
      username: principal.username,
      ref: create ? null : structuredClone(item.ref),
      domainId: intent.domainId,
      operation: intent.operation,
      payload: structuredClone(intent.payload),
      expectedVersion: item.version,
      sourceReceipt: intent.sourceReceipt,
      confirmationId: null,
      createdAt: principal.receivedAt
    };
    if (typeof command.expectedVersion !== 'string' || !command.expectedVersion || !Number.isFinite(command.createdAt) || command.createdAt > asOf) return {
      denied: 'invalid_command_version'
    };
    return {
      command,
      requiresConfirmation: !eligible
    };
  } catch {
    return {
      denied: 'invalid_command_intent'
    };
  }
}
/** Native event identity is scoped to the actual occurrence, never the dispatch receipt. */
export function canonicalWorkEvent(event, {
  username,
  policy,
  asOf
}) {
  try {
    if (!event || !['provider', 'journal'].includes(event.origin) || event.actorId !== null && event.actorId !== undefined && (typeof event.actorId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(event.actorId)) || event.username !== username || !['created', 'updated', 'completed', 'reopened', 'archived', 'deleted'].includes(event.type) || !Number.isFinite(event.occurredAt) || event.occurredAt < 0 || event.occurredAt > asOf || event.occurredAtEstimated === true || typeof event.occurrenceId !== 'string' || !event.occurrenceId || event.occurrenceId.length > 256 || typeof event.providerVersion !== 'string' || !event.providerVersion || event.providerVersion.length > 256 || !Array.isArray(event.sourceRefs) || !event.sourceRefs.length || event.sourceRefs.some(ref => typeof ref !== 'string' || !ref || ref.length > 2048)) return null;
    validateWorkRef(event.ref);
    validateWorkRef(event.containerRef);
    if (event.ref.kind !== 'task' || event.containerRef.kind !== 'container' || event.containerRef.provider !== event.ref.provider || event.containerRef.accountId !== event.ref.accountId) return null;
    const allowed = Object.values(policy.domains).some(d => {
      const p = policy.providers[d.provider];
      return p?.type === event.ref.provider && p.accountId === event.ref.accountId && p.operations.includes('read') && d.containerId === event.containerRef.id && (!d.assigneeIds || d.assigneeIds.some(id => event.assigneeIds?.includes(id)));
    });
    if (!policy.enabled || !allowed) return null;
    return {
      ...structuredClone(event),
      id: 'work:' + workHash([username, event.ref, event.type, event.occurrenceId]),
      observedAt: asOf,
      actorId: event.actorId ?? null,
      occurredAtEstimated: false
    };
  } catch {
    return null;
  }
}
