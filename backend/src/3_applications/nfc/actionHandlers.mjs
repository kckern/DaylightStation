/**
 * Pluggable action-handler registry for NFC scans.
 * @module applications/nfc/actionHandlers
 */

import { randomUUID } from 'node:crypto';

export class UnknownActionError extends Error {
  constructor(action) {
    super(`Unknown NFC action: ${action}`);
    this.name = 'UnknownActionError';
    this.action = action;
  }
}

function buildLoadOptions(intent) {
  return { dispatchId: intent.dispatchId || randomUUID() };
}

function buildLoadQuery(intent, key) {
  return { ...(intent.params || {}), [key]: intent.content };
}

export const actionHandlers = {
  queue: async (intent, { wakeAndLoadService }) =>
    wakeAndLoadService.execute(
      intent.target,
      buildLoadQuery(intent, 'queue'),
      buildLoadOptions(intent)
    ),

  play: async (intent, { wakeAndLoadService }) =>
    wakeAndLoadService.execute(
      intent.target,
      buildLoadQuery(intent, 'play'),
      buildLoadOptions(intent)
    ),

  open: async (intent, { deviceService }) => {
    const device = deviceService.get(intent.target);
    if (!device) throw new Error(`Unknown target device: ${intent.target}`);
    const path = intent.params?.path;
    if (!path) throw new Error('open action requires params.path');
    const query = { ...intent.params };
    delete query.path;
    return device.loadContent(path, query);
  },

  scene: async (intent, { haGateway }) =>
    haGateway.callService('scene', 'turn_on', { entity_id: intent.scene }),

  'ha-service': async (intent, { haGateway }) => {
    const [domain, service] = String(intent.service || '').split('.');
    if (!domain || !service) throw new Error(`Invalid ha-service: ${intent.service}`);
    const data = { ...(intent.data || {}) };
    if (intent.entity) data.entity_id = intent.entity;
    return haGateway.callService(domain, service, data);
  },
};

export async function dispatchAction(intent, deps) {
  const handler = actionHandlers[intent.action];
  if (!handler) throw new UnknownActionError(intent.action);
  return handler(intent, deps);
}

export default { actionHandlers, dispatchAction, UnknownActionError };
