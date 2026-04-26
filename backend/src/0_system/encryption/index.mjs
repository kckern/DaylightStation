// backend/src/0_system/encryption/index.mjs

/**
 * Encryption module exports.
 *
 * Currently provides interfaces only.
 * Implementations will be added when encrypted secrets are needed.
 */

export { IEncryptionService } from './IEncryptionService.mjs';
export { AesEncryptionService } from './AesEncryptionService.mjs';
