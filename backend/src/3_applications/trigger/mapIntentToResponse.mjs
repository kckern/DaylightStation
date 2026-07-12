/**
 * Normalize a resolver intent into a Response. Keeps the existing resolvers
 * (NfcResolver/StateResolver) untouched — only their output is converged here.
 *
 * Layer: APPLICATION (3_applications/trigger).
 *
 * @module applications/trigger/mapIntentToResponse
 */
import { Response } from '#domains/trigger/Response.mjs';

const CONTENT_ACTIONS = new Set(['queue', 'play', 'play-next']);

export class UnknownActionError extends Error {
  constructor(action) {
    super(`mapIntentToResponse: unknown action "${action}"`);
    this.name = 'UnknownActionError';
    this.action = action;
  }
}

/**
 * @param {Object|null} intent  resolver output { action, target, params, content?, scene?, service?, entity?, data?, end?, endLocation? }
 * @param {Object} [opts]
 * @param {'authoritative'|'optimistic'} [opts.posture='authoritative']
 * @returns {Object|null} Response, or null if intent is null
 * @throws {Error} on an unknown action
 */
export function mapIntentToResponse(intent, { posture = 'authoritative' } = {}) {
  if (!intent) return null;
  const { action } = intent;

  if (CONTENT_ACTIONS.has(action)) {
    return Response.content({
      target: intent.target,
      expression: { action, contentId: intent.content, options: intent.params || {} },
      posture,
      end: intent.end,
      endLocation: intent.endLocation,
    });
  }
  if (action === 'open') {
    const { path, ...params } = intent.params || {};
    return Response.device({ target: intent.target, op: 'open', path, params });
  }
  if (action === 'clear') {
    return Response.device({ target: intent.target, op: 'clear', path: undefined, params: intent.params || {} });
  }
  if (action === 'scene') {
    return Response.ha({ op: 'scene', scene: intent.scene });
  }
  if (action === 'ha-service') {
    return Response.ha({ op: 'service', service: intent.service, entity: intent.entity, data: intent.data });
  }
  if (action === 'script') {
    return Response.script({ ref: intent.endpoint, params: intent.params });
  }
  throw new UnknownActionError(action);
}

export default mapIntentToResponse;
