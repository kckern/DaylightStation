/**
 * Barcode resolver: parses a self-describing barcode string into a Response.
 * Wraps BarcodePayload (grammar) — the value carries its own intent; the source
 * slice supplies defaults (target screen, default action, known actions).
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless.
 * @module domains/trigger/services/BarcodeResolver
 */
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';
import { KNOWN_COMMANDS } from '#domains/barcode/BarcodeCommandMap.mjs';
import { Response } from '#domains/trigger/Response.mjs';

export class BarcodeResolver {
  /**
   * @param {Object} args
   * @param {string} args.location  scanner location id (keys registry.locations)
   * @param {string} args.value     the raw barcode string
   * @param {Object} args.registry  the `barcode` slice: { locations }
   * @returns {Object|null} a Response (content) or a transport response, or null
   */
  static resolve({ location, value, registry }) {
    const loc = registry?.locations?.[location];
    if (!loc) return null;

    const knownActions = loc.actions || ['queue', 'play', 'open'];
    const payload = BarcodePayload.parse(
      { barcode: value, device: location, timestamp: null },
      knownActions,
      KNOWN_COMMANDS,
    );
    if (!payload) return null;

    const target = payload.targetScreen || loc.target;

    if (payload.type === 'command') {
      return Object.freeze({ kind: 'transport', target, command: payload.command, arg: payload.commandArg });
    }
    return Response.content({
      target,
      expression: { action: payload.action || loc.default_action, contentId: payload.contentId, options: payload.options || {} },
      posture: 'optimistic',
    });
  }
}

export default BarcodeResolver;
