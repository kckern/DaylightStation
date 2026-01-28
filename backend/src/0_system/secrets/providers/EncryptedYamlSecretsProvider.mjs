// backend/src/0_system/secrets/providers/EncryptedYamlSecretsProvider.mjs

import { ISecretsProvider } from '../ISecretsProvider.mjs';

/**
 * Encrypted YAML secrets provider.
 * Wraps YamlSecretsProvider with encryption layer.
 *
 * TODO: Implement when encryption is needed
 * - Requires AesEncryptionService from 0_system/encryption
 * - Master key from DAYLIGHT_MASTER_KEY env or keyfile
 * - Encrypts values before writing, decrypts on read
 * - File structure same as YamlSecretsProvider (values are encrypted strings)
 */
export class EncryptedYamlSecretsProvider extends ISecretsProvider {
  /**
   * @param {string} dataDir - Path to data directory
   * @param {import('../../encryption/IEncryptionService.mjs').IEncryptionService} encryptionService
   */
  constructor(dataDir, encryptionService) {
    super();
    throw new Error(
      'EncryptedYamlSecretsProvider not yet implemented. ' +
      'See docs/plans/2026-01-28-secrets-handler-design.md for planned implementation.'
    );
  }
}

export default EncryptedYamlSecretsProvider;
