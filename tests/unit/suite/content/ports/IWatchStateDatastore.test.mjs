// tests/unit/content/ports/IWatchStateDatastore.test.mjs
import { validateWatchStateDatastore } from '#backend/src/3_applications/content/ports/IWatchStateDatastore.mjs';

describe('IWatchStateDatastore port', () => {
  test('validates store has required methods', () => {
    const validStore = {
      get: async () => null,
      set: async () => {},
      getAll: async () => [],
      clear: async () => {}
    };

    expect(() => validateWatchStateDatastore(validStore)).not.toThrow();
  });

  test('rejects store missing get method', () => {
    expect(() => validateWatchStateDatastore({})).toThrow('must implement get');
  });

  test('rejects store missing set method', () => {
    expect(() => validateWatchStateDatastore({ get: async () => {} })).toThrow('must implement set');
  });

  test('rejects store missing getAll method', () => {
    expect(() => validateWatchStateDatastore({
      get: async () => {},
      set: async () => {}
    })).toThrow('must implement getAll');
  });

  test('rejects store missing clear method', () => {
    expect(() => validateWatchStateDatastore({
      get: async () => {},
      set: async () => {},
      getAll: async () => []
    })).toThrow('must implement clear');
  });
});
