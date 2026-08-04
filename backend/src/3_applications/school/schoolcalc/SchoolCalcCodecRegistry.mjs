import { DomainInvariantError, EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

const REQUIRED_METHODS = Object.freeze([
  'describeCapabilities',
  'encodeDeviceIdentity',
  'recognizesDeviceIdentity',
  'decodeDeviceIdentity',
  'encodeLearnerRoster',
  'encodeProgressProjection',
  'projectFollowUpKey',
  'decodeInteractionRequest',
  'encodeInteractionResponse',
  'encodeCatalog',
  'decodeDeliveryRequests',
  'supports',
  'compile',
  'decodeResult',
  'recognizesResult',
  'decodeResultQueue',
  'encodeAcknowledgements',
  'encodeSyncManifest',
]);

/** Registry of injected calculator-family adapters with no family branches. */
export class SchoolCalcCodecRegistry {
  #byPlatform;

  constructor({ codecs = [] } = {}) {
    if (!Array.isArray(codecs) || codecs.length === 0) {
      throw new Error('SchoolCalcCodecRegistry requires at least one codec');
    }
    this.#byPlatform = new Map();
    codecs.forEach((codec) => {
      if (!codec || typeof codec.platformId !== 'string' || !codec.platformId) {
        throw new Error('SchoolCalc codec must expose platformId');
      }
      const missing = REQUIRED_METHODS.filter((method) => typeof codec[method] !== 'function');
      if (missing.length) throw new Error(`SchoolCalc codec '${codec.platformId}' lacks ${missing.join(', ')}`);
      if (this.#byPlatform.has(codec.platformId)) {
        throw new DomainInvariantError(`Duplicate SchoolCalc codec '${codec.platformId}'`, {
          code: 'DUPLICATE_SCHOOLCALC_CODEC',
        });
      }
      this.#byPlatform.set(codec.platformId, codec);
    });
  }

  get(platformId) {
    const codec = this.#byPlatform.get(platformId);
    if (!codec) throw new EntityNotFoundError('SchoolCalc codec', platformId);
    return codec;
  }

  listPlatformIds() { return [...this.#byPlatform.keys()].sort(); }

  /** Select exactly one family adapter for a provisioned identity record. */
  decodeDeviceIdentity(record) {
    return this.#decodeClaimed({
      record,
      recognizes: 'recognizesDeviceIdentity',
      decode: 'decodeDeviceIdentity',
      kind: 'device identity',
      missingCode: 'UNRECOGNIZED_SCHOOLCALC_DEVICE_IDENTITY',
      ambiguousCode: 'AMBIGUOUS_SCHOOLCALC_DEVICE_IDENTITY_CODEC',
    });
  }

  /** Select exactly one adapter by its cheap record recognizer, then decode. */
  decodeResult(record) {
    return this.#decodeClaimed({
      record,
      recognizes: 'recognizesResult',
      decode: 'decodeResult',
      kind: 'result record',
      missingCode: 'UNRECOGNIZED_SCHOOLCALC_RESULT',
      ambiguousCode: 'AMBIGUOUS_SCHOOLCALC_RESULT_CODEC',
    });
  }

  #decodeClaimed({ record, recognizes, decode, kind, missingCode, ambiguousCode }) {
    const candidates = [...this.#byPlatform.values()].filter((codec) => codec[recognizes](record));
    if (candidates.length === 0) {
      throw new ValidationError(`No SchoolCalc codec recognizes the ${kind}`, {
        code: missingCode,
      });
    }
    if (candidates.length > 1) {
      throw new DomainInvariantError(`More than one SchoolCalc codec claims the ${kind}`, {
        code: ambiguousCode,
        details: { platforms: candidates.map((codec) => codec.platformId) },
      });
    }
    const codec = candidates[0];
    const value = codec[decode](record);
    return decode === 'decodeResult' ? { codec, result: value } : { codec, identity: value };
  }
}

export default SchoolCalcCodecRegistry;
