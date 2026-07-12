/**
 * Open response-handler registry. Generalizes actionHandlers: dispatch by
 * Response.kind. deps = { wakeAndLoadService, deviceService, haGateway }.
 *
 * Layer: APPLICATION (3_applications/trigger).
 *
 * @module applications/trigger/responseHandlers
 */
import { randomUUID } from 'node:crypto';

export class UnknownResponseKindError extends Error {
  constructor(kind) {
    super(`Unknown response kind: ${kind}`);
    this.name = 'UnknownResponseKindError';
    this.kind = kind;
  }
}

function buildContentQuery(expression) {
  const { action, contentId, options } = expression;
  if (action === 'play-next') {
    return { ...(options || {}), 'play-next': contentId, op: 'play-next' };
  }
  return { ...(options || {}), [action]: contentId };
}

function buildLoadOptions(response) {
  const opts = { dispatchId: response.dispatchId || randomUUID() };
  if (response.end) {
    opts.endBehavior = response.end;
    if (response.endLocation) opts.endLocation = response.endLocation;
  }
  return opts;
}

export const responseHandlers = {
  // Content: authoritative goes straight to wake-and-load. Optimistic posture
  // (broadcast + ack + fallback) is provided by an injected contentDispatcher
  // in Plan 3; absent that, fall back to authoritative (real behavior).
  content: async (response, deps) => {
    const query = buildContentQuery(response.expression);
    const loadOptions = buildLoadOptions(response);
    if (response.posture === 'optimistic' && deps.contentDispatcher?.optimistic) {
      return deps.contentDispatcher.optimistic(response.target, query, loadOptions);
    }
    return deps.wakeAndLoadService.execute(response.target, query, loadOptions);
  },

  device: async (response, deps) => {
    const device = deps.deviceService.get(response.target);
    if (!device) throw new Error(`Unknown target device: ${response.target}`);
    if (response.op === 'clear') return device.clearContent();
    if (!response.path) throw new Error('device open requires a path');
    return device.loadContent(response.path, response.params || {});
  },

  ha: async (response, deps) => {
    if (response.op === 'scene') {
      return deps.haGateway.callService('scene', 'turn_on', { entity_id: response.scene });
    }
    const [domain, service] = String(response.service || '').split('.');
    if (!domain || !service) throw new Error(`Invalid ha service: ${response.service}`);
    const data = { ...(response.data || {}) };
    if (response.entity) data.entity_id = response.entity;
    return deps.haGateway.callService(domain, service, data);
  },

  transport: async (response, deps) => {
    const payload = deps.commandResolver?.(response.command, response.arg);
    if (!payload) {
      deps.logger?.warn?.('trigger.transport.unknown', { command: response.command, target: response.target });
      return;
    }
    return deps.screenBroadcast?.(response.target, payload);
  },
};

export async function dispatchResponse(response, deps) {
  const handler = responseHandlers[response.kind];
  if (!handler) throw new UnknownResponseKindError(response.kind);
  return handler(response, deps);
}

export default { responseHandlers, dispatchResponse, UnknownResponseKindError };
