import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('getClientId', () => {
  let mockStorage;

  beforeEach(() => {
    vi.resetModules();

    // Fresh mock localStorage for each test
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => mockStorage[key] ?? null),
      setItem: vi.fn((key, val) => { mockStorage[key] = val; }),
    });

    // Mock crypto.randomUUID to return a predictable value
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'test-uuid-1234'),
    });
  });

  // -- Generates a new UUID on first call when localStorage is empty --
  it('generates a new UUID on first call when localStorage is empty', async () => {
    const { getClientId } = await import('#frontend/lib/clientId.js');
    const id = getClientId();

    expect(id).toBe('test-uuid-1234');
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  // -- Stores generated ID in localStorage --
  it('stores generated ID in localStorage', async () => {
    const { getClientId } = await import('#frontend/lib/clientId.js');
    getClientId();

    expect(localStorage.setItem).toHaveBeenCalledWith('daylight_client_id', 'test-uuid-1234');
  });

  // -- Returns stored ID from localStorage on subsequent calls --
  it('returns stored ID from localStorage on subsequent calls', async () => {
    mockStorage['daylight_client_id'] = 'existing-id-5678';

    const { getClientId } = await import('#frontend/lib/clientId.js');
    const id = getClientId();

    expect(id).toBe('existing-id-5678');
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  // -- Returns cached value without hitting localStorage after first call --
  it('returns cached value without hitting localStorage after first call', async () => {
    const { getClientId } = await import('#frontend/lib/clientId.js');

    const first = getClientId();
    // Reset call counts to verify second call skips localStorage
    localStorage.getItem.mockClear();

    const second = getClientId();

    expect(second).toBe(first);
    expect(localStorage.getItem).not.toHaveBeenCalled();
  });

  // -- Handles localStorage being unavailable (throws) --
  it('handles localStorage being unavailable (throws)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('SecurityError'); }),
      setItem: vi.fn(() => { throw new Error('SecurityError'); }),
    });

    const { getClientId } = await import('#frontend/lib/clientId.js');
    const id = getClientId();

    // Should still generate and return an ID even without localStorage
    expect(id).toBe('test-uuid-1234');
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });
});
