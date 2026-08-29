// backend/src/0_system/secrets/index.mjs

/**
 * Secrets module exports.
 *
 * Usage:
 *   import { SecretsHandler } from './secrets/index.mjs';
 *
 *   const provider = new YamlSecretsProvider(dataDir);
 *   await provider.initialize();
 *   const handler = new SecretsHandler(provider);
 */

// Interface
export { ISecretsProvider } from './ISecretsProvider.mjs';

// Handler
export { SecretsHandler } from './SecretsHandler.mjs';
