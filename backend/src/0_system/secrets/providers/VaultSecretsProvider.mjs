// backend/src/0_system/secrets/providers/VaultSecretsProvider.mjs

import { ISecretsProvider } from '../ISecretsProvider.mjs';

/**
 * HashiCorp Vault secrets provider.
 *
 * TODO: Implement when migrating to Vault
 * - Config via system.yml: secrets.vault.address, secrets.vault.mount
 * - Auth: AppRole recommended, or Kubernetes service account
 * - Paths: {mount}/system/secrets, {mount}/users/{username}, etc.
 * - Consider caching with TTL for performance
 */
export class VaultSecretsProvider extends ISecretsProvider {
  /**
   * @param {object} vaultConfig
   * @param {string} vaultConfig.address - Vault server address
   * @param {string} vaultConfig.mount - Secrets mount path
   * @param {string} [vaultConfig.roleId] - AppRole role ID
   * @param {string} [vaultConfig.secretId] - AppRole secret ID
   */
  constructor(vaultConfig) {
    super();
    throw new Error(
      'VaultSecretsProvider not yet implemented. ' +
      'See docs/plans/2026-01-28-secrets-handler-design.md for planned implementation.'
    );
  }
}

export default VaultSecretsProvider;
