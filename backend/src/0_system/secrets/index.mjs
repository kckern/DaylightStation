// backend/src/0_system/secrets/index.mjs

/**
 * Secrets module exports.
 *
 * Usage:
 *   import { SecretsHandler, YamlSecretsProvider } from './secrets/index.mjs';
 *
 *   const provider = new YamlSecretsProvider(dataDir);
 *   await provider.initialize();
 *   const handler = new SecretsHandler(provider);
 */

// Interface
export { ISecretsProvider } from './ISecretsProvider.mjs';

// Handler
export { SecretsHandler } from './SecretsHandler.mjs';

// Providers
export { YamlSecretsProvider } from './providers/YamlSecretsProvider.mjs';
export { EncryptedYamlSecretsProvider } from './providers/EncryptedYamlSecretsProvider.mjs';
export { VaultSecretsProvider } from './providers/VaultSecretsProvider.mjs';
