# Secrets Handler Abstraction

## Status: Future

## Summary

Abstract secrets and auth handling behind a provider interface to enable:
- Clean separation of sensitive data from ConfigService
- Future encrypted flat-file secrets
- Future HashiCorp Vault integration

## Architecture

```
ConfigService (API unchanged)
       │ delegates
       ▼
SecretsHandler (orchestration, logging/metrics)
       │ uses
       ▼
ISecretsProvider
  ├── YamlSecretsProvider (current behavior)
  ├── EncryptedYamlSecretsProvider (future)
  └── VaultSecretsProvider (future)
```

## Key Design Points

### ISecretsProvider Interface
- `getSecret(key)` / `setSecret(key, value)` - system secrets
- `getUserAuth(username, service)` / `setUserAuth(...)` - per-user credentials
- `getHouseholdAuth(householdId, service)` / `setHouseholdAuth(...)` - household credentials
- `getSystemAuth(platform, key)` / `setSystemAuth(...)` - bot tokens, platform credentials
- `initialize()` / `flush()` - lifecycle

### IEncryptionService Interface (for encrypted provider)
- `encrypt(plaintext)` → base64 ciphertext
- `decrypt(ciphertext)` → plaintext

### Configuration
```yaml
# system.yml
secrets:
  provider: yaml | encrypted | vault
  vault:
    address: https://vault.example.com
    mount: secret/daylight
```

## File Structure
```
backend/src/0_system/
├── secrets/
│   ├── ISecretsProvider.mjs
│   ├── SecretsHandler.mjs
│   └── providers/
│       ├── YamlSecretsProvider.mjs
│       ├── EncryptedYamlSecretsProvider.mjs
│       └── VaultSecretsProvider.mjs
└── encryption/
    ├── IEncryptionService.mjs
    └── AesEncryptionService.mjs
```

## Implementation Notes

1. **ConfigService API unchanged** - existing callers work without modification
2. **YamlSecretsProvider** moves current loading logic from configLoader.mjs
3. **Stubs throw on construction** for clear errors if accidentally selected
4. **Bootstrap change**: init secrets provider first, then pass to ConfigService

## Benefits

- Secrets loading isolated from config loading
- Easy to swap providers per environment (dev=yaml, prod=vault)
- Path to encrypted secrets without code changes
- Testable - can mock ISecretsProvider

## Related Work

- Depends on: ConfigService refactoring complete
- Enables: Encrypted secrets, Vault integration, multi-tenant secrets
