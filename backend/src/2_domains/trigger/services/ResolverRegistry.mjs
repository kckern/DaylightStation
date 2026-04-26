/**
 * Resolver registry: modality string -> resolver class. Single entry point
 * for TriggerDispatchService to convert (modality, location, value) into an
 * intent object.
 *
 * Layer: DOMAIN service (2_domains/trigger/services). Stateless dispatch.
 *
 * To add a new modality (voice, barcode, etc.):
 *   1. Add a parser under 1_adapters/trigger/parsers/ and wire it into
 *      buildTriggerRegistry.
 *   2. Add a resolver class under 2_domains/trigger/services/ that
 *      consumes the modality slice of the registry.
 *   3. Register the resolver class here in the `resolvers` map.
 *
 * Each resolver receives the modality slice of the registry (e.g.
 * `registry.nfc` for NfcResolver) — NOT the whole registry. This keeps
 * resolvers from peeking across modalities.
 *
 * @module domains/trigger/services/ResolverRegistry
 */

import { NfcResolver } from './NfcResolver.mjs';
import { StateResolver } from './StateResolver.mjs';

export class UnknownModalityError extends Error {
  constructor(modality) {
    super(`Unknown trigger modality: ${modality}`);
    this.name = 'UnknownModalityError';
    this.modality = modality;
  }
}

export const resolvers = {
  nfc: NfcResolver,
  state: StateResolver,
};

/**
 * Stateless dispatch facade.
 *
 * @class ResolverRegistry
 * @stateless
 */
export class ResolverRegistry {
  /**
   * @param {Object} args
   * @param {string} args.modality  e.g. 'nfc' or 'state'
   * @param {string} args.location
   * @param {string} args.value
   * @param {Object} args.registry  the unified registry from buildTriggerRegistry
   * @param {Object} [args.contentIdResolver]  required by some modalities (nfc)
   * @returns {Object|null} resolved intent or null if unregistered
   * @throws {UnknownModalityError} if no resolver is registered for the modality
   */
  static resolve({ modality, location, value, registry, contentIdResolver }) {
    const Resolver = resolvers[modality];
    if (!Resolver) throw new UnknownModalityError(modality);

    const modalityRegistry = registry?.[modality];
    return Resolver.resolve({ location, value, registry: modalityRegistry, contentIdResolver });
  }
}

export default ResolverRegistry;
