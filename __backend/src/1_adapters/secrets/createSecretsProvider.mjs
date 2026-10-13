import { ConfigurationError } from '#system/utils/errors/index.mjs';
import { YamlSecretsProvider } from './YamlSecretsProvider.mjs';
import { EncryptedYamlSecretsProvider } from './EncryptedYamlSecretsProvider.mjs';
import { VaultSecretsProvider } from './VaultSecretsProvider.mjs';

/** Select the configured external secrets persistence implementation. */
export function createSecretsProvider(dataDir, systemConfig) {
  const providerType = systemConfig.secrets?.provider ?? 'yaml';
  switch (providerType) {
    case 'yaml': return new YamlSecretsProvider(dataDir);
    case 'encrypted': return new EncryptedYamlSecretsProvider(dataDir);
    case 'vault': return new VaultSecretsProvider(systemConfig.secrets?.vault);
    default:
      throw new ConfigurationError(`Unknown secrets provider: ${providerType}`, {
        code: 'UNKNOWN_SECRETS_PROVIDER', key: 'secrets.provider', value: providerType,
      });
  }
}

export default createSecretsProvider;
