// backend/src/0_system/encryption/AesEncryptionService.mjs

import { IEncryptionService } from './IEncryptionService.mjs';

/**
 * AES-256-GCM encryption service.
 *
 * TODO: Implement when encrypted secrets are needed
 * - Key source: DAYLIGHT_MASTER_KEY env or keyfile path
 * - Format: base64(nonce + ciphertext + tag)
 * - Use Node.js crypto module
 */
export class AesEncryptionService extends IEncryptionService {
  /**
   * @param {object} options
   * @param {string} [options.keyEnvVar='DAYLIGHT_MASTER_KEY'] - Env var containing key
   * @param {string} [options.keyFile] - Path to key file (alternative to env)
   */
  constructor(options = {}) {
    super();
    throw new Error(
      'AesEncryptionService not yet implemented. ' +
      'See docs/plans/2026-01-28-secrets-handler-design.md for planned implementation.'
    );
  }
}

export default AesEncryptionService;
