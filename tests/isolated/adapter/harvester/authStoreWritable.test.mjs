import { describe, it, expect, vi } from 'vitest';
import { YamlAuthDatastore } from '#adapters/harvester/YamlAuthDatastore.mjs';
import { ReadOnlyConfigAuthStore } from '#adapters/auth/ReadOnlyConfigAuthStore.mjs';

describe('auth store writability', () => {
  it('YamlAuthDatastore persists tokens', () => {
    const store = new YamlAuthDatastore({ io: { userSaveAuth: vi.fn() }, logger: { warn() {} } });
    expect(store.writable).toBe(true);
  });

  it('ReadOnlyConfigAuthStore cannot persist tokens', () => {
    expect(new ReadOnlyConfigAuthStore({ configService: {} }).writable).toBe(false);
  });
});
