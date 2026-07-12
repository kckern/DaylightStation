/**
 * Response — discriminated-union value object: the shared output of every
 * resolver and the shared input of every response handler. Discriminated by
 * `kind`. Additive-open: new kinds are new factories + handler entries.
 *
 * Layer: DOMAIN value object (2_domains/trigger). Pure.
 *
 * @module domains/trigger/Response
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const DEVICE_OPS = new Set(['open', 'clear']);
const HA_OPS = new Set(['scene', 'service']);

export const Response = {
  /**
   * @param {Object} a
   * @param {string} a.target
   * @param {{action:string, contentId:string, options:Object}} a.expression
   * @param {'authoritative'|'optimistic'} [a.posture='authoritative']
   * @param {string} [a.end]
   * @param {string} [a.endLocation]
   */
  content({ target, expression, posture, end, endLocation } = {}) {
    if (!target) throw new ValidationError('Response.content target required', { code: 'RESPONSE_CONTENT_TARGET' });
    if (!expression || !expression.contentId) throw new ValidationError('Response.content expression.contentId required', { code: 'RESPONSE_CONTENT_EXPR' });
    return Object.freeze({ kind: 'content', target, expression, posture: posture || 'authoritative', end, endLocation });
  },

  /** @param {{target:string, op:'open'|'clear', path?:string, params?:Object}} a */
  device({ target, op, path, params } = {}) {
    if (!target) throw new ValidationError('Response.device target required', { code: 'RESPONSE_DEVICE_TARGET' });
    if (!DEVICE_OPS.has(op)) throw new ValidationError(`Response.device op must be open|clear (got ${op})`, { code: 'RESPONSE_DEVICE_OP' });
    return Object.freeze({ kind: 'device', target, op, path, params });
  },

  /** @param {{op:'scene'|'service', scene?:string, service?:string, entity?:string, data?:Object}} a */
  ha({ op, scene, service, entity, data } = {}) {
    if (!HA_OPS.has(op)) throw new ValidationError(`Response.ha op must be scene|service (got ${op})`, { code: 'RESPONSE_HA_OP' });
    return Object.freeze({ kind: 'ha', op, scene, service, entity, data });
  },

  /** @param {{ref:string, params?:Object}} a */
  script({ ref, params } = {}) {
    if (!ref) throw new ValidationError('Response.script ref required', { code: 'RESPONSE_SCRIPT_REF' });
    return Object.freeze({ kind: 'script', ref, params });
  },
};

export default Response;
