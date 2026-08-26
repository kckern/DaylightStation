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
   * `location` is the READER the tap came from, and it is distinct from
   * `endLocation` (the room a tv-off applies to) and from `target` (the screen
   * the content loads on). It rides along for the same reason the learner
   * response carries one: an interceptor scopes itself to a reader, so a book
   * tapped in the living room can be claimed by the session open there and a
   * tap anywhere else in the house cannot.
   *
   * @param {string} a.target
   * @param {{action:string, contentId:string, options:Object}} a.expression
   * @param {'authoritative'|'optimistic'} [a.posture='authoritative']
   * @param {string} [a.location]  the reader this tap came from
   * @param {string} [a.end]
   * @param {string} [a.endLocation]
   */
  content({ target, expression, posture, location, end, endLocation } = {}) {
    if (!target) throw new ValidationError('Response.content target required', { code: 'RESPONSE_CONTENT_TARGET' });
    if (!expression || !expression.contentId) throw new ValidationError('Response.content expression.contentId required', { code: 'RESPONSE_CONTENT_EXPR' });
    return Object.freeze({ kind: 'content', target, expression, posture: posture || 'authoritative', location, end, endLocation });
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

  /**
   * A tap that named a PERSON rather than a piece of content. `op` is the
   * reader location's `learner_action`; what it does is the injected
   * learner-action registry's business, not this layer's. The legal ops are
   * deliberately NOT enumerated here — a new learner action must be a config
   * key plus a registered handler, never an edit to this file.
   *
   * Both fields end up in a log line and a registry lookup, and both originate
   * in a YAML tree shared with prod, so they are type-checked rather than
   * stringified: `[object Object]` as an op produces a refusal that names
   * nothing and points at no line of config.
   *
   * @param {{op:string, learnerId:string, location?:string, target?:string}} a
   */
  learner({ op, learnerId, location, target } = {}) {
    if (typeof op !== 'string' || op.trim().length === 0) {
      throw new ValidationError('Response.learner op required (non-empty string)', { code: 'RESPONSE_LEARNER_OP' });
    }
    if (typeof learnerId !== 'string' || learnerId.trim().length === 0) {
      throw new ValidationError('Response.learner learnerId required (non-empty string)', { code: 'RESPONSE_LEARNER_ID' });
    }
    return Object.freeze({ kind: 'learner', op, learnerId, location, target });
  },
};

export default Response;
