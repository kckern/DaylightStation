// tests/unit/content/ports/IWatchStateStore.test.mjs
import { validateWatchStateStore } from '../../../../backend/src/domains/content/ports/IWatchStateStore.mjs';

describe('IWatchStateStore port', () => {
  test('validates store has required methods', () => {
    const validStore = {
      get: async () => null,
      set: async () => {},
      getAll: async () => [],
      clear: async () => {}
    };

    expect(() => validateWatchStateStore(validStore)).not.toThrow();
  });

  test('rejects store missing get method', () => {
    expect(() => validateWatchStateStore({})).toThrow('must implement get');
  });

  test('rejects store missing set method', () => {
    expect(() => validateWatchStateStore({ get: async () => {} })).toThrow('must implement set');
  });

  test('rejects store missing getAll method', () => {
    expect(() => validateWatchStateStore({
      get: async () => {},
      set: async () => {}
    })).toThrow('must implement getAll');
  });

  test('rejects store missing clear method', () => {
    expect(() => validateWatchStateStore({
      get: async () => {},
      set: async () => {},
      getAll: async () => []
    })).toThrow('must implement clear');
  });
});
