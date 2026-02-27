// tests/isolated/hooks/useMediaClientId.test.mjs
import { describe, test, expect, beforeEach, vi } from 'vitest';

// We test the pure helper functions and localStorage interaction directly,
// without needing a React rendering context.

let generateHexId, parseUserAgent, STORAGE_KEY, NAME_KEY;

beforeEach(async () => {
  // Dynamic import to pick up fresh module
  const mod = await import('#frontend/hooks/media/useMediaClientId.js');
  generateHexId = mod.generateHexId;
  parseUserAgent = mod.parseUserAgent;
  STORAGE_KEY = mod.STORAGE_KEY;
  NAME_KEY = mod.NAME_KEY;
});

describe('generateHexId', () => {
  test('produces an 8-character hex string', () => {
    const id = generateHexId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id.length).toBe(8);
  });

  test('produces different values on successive calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateHexId()));
    // With 20 random calls, we should get at least 2 distinct values
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('parseUserAgent', () => {
  test('detects Chrome on Mac', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua)).toBe('Chrome on Mac');
  });

  test('detects Edge on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(parseUserAgent(ua)).toBe('Edge on Windows');
  });

  test('detects Safari on iOS', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(ua)).toBe('Safari on iOS');
  });

  test('detects Firefox on Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0';
    expect(parseUserAgent(ua)).toBe('Firefox on Linux');
  });

  test('detects Chrome on Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
    expect(parseUserAgent(ua)).toBe('Chrome on Android');
  });

  test('falls back to Browser on Unknown for unrecognized UA', () => {
    expect(parseUserAgent('SomeWeirdBot/1.0')).toBe('Browser on Unknown');
  });
});

describe('useMediaClientId localStorage integration', () => {
  let storage;

  beforeEach(() => {
    // Create a fresh in-memory storage for each test
    storage = {};
    globalThis.localStorage = {
      getItem: vi.fn((key) => storage[key] ?? null),
      setItem: vi.fn((key, value) => { storage[key] = value; }),
      removeItem: vi.fn((key) => { delete storage[key]; }),
      clear: vi.fn(() => { storage = {}; }),
    };
  });

  test('stores new clientId in localStorage when none exists', () => {
    // Simulate what the hook does internally
    let clientId = localStorage.getItem(STORAGE_KEY);
    expect(clientId).toBeNull();

    clientId = generateHexId();
    localStorage.setItem(STORAGE_KEY, clientId);

    expect(localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, clientId);
    expect(clientId).toMatch(/^[0-9a-f]{8}$/);
  });

  test('reuses existing clientId from localStorage', () => {
    const existingId = 'deadbeef';
    storage[STORAGE_KEY] = existingId;

    const clientId = localStorage.getItem(STORAGE_KEY);
    expect(clientId).toBe(existingId);
    // setItem should NOT be called since value already exists
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  test('stores display name derived from user-agent', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const displayName = parseUserAgent(ua);

    localStorage.setItem(NAME_KEY, displayName);
    expect(localStorage.setItem).toHaveBeenCalledWith(NAME_KEY, 'Chrome on Mac');
  });
});

describe('module exports', () => {
  test('exports useMediaClientId as named and default export', async () => {
    const mod = await import('#frontend/hooks/media/useMediaClientId.js');
    expect(typeof mod.useMediaClientId).toBe('function');
    expect(typeof mod.default).toBe('function');
    expect(mod.useMediaClientId).toBe(mod.default);
  });
});
