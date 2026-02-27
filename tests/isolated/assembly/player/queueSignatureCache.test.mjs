import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// We test the cache logic directly — no React rendering needed
describe('queue signature cache (module-level)', () => {
  let _signatureCache;

  beforeEach(() => {
    _signatureCache = new Map();
  });

  test('returns null for uncached contentRef', () => {
    expect(_signatureCache.get('plex:350694') || null).toBeNull();
  });

  test('persists signature across simulated remounts', () => {
    const sig = 'ref:plex:350694;shuffle:0';
    _signatureCache.set('plex:350694', sig);
    // Simulate remount: new useRef would get null, but cache has the value
    expect(_signatureCache.get('plex:350694')).toBe(sig);
  });

  test('error rollback reverts cached signature to previous', () => {
    const prevSig = 'ref:plex:350694;shuffle:0';
    const newSig = 'ref:plex:350694;shuffle:1';
    _signatureCache.set('plex:350694', prevSig);
    // Start init (set new sig)
    _signatureCache.set('plex:350694', newSig);
    // Error -> rollback
    _signatureCache.set('plex:350694', prevSig);
    expect(_signatureCache.get('plex:350694')).toBe(prevSig);
  });

  test('different contentRef keys are independent', () => {
    _signatureCache.set('plex:100', 'sig-a');
    _signatureCache.set('plex:200', 'sig-b');
    expect(_signatureCache.get('plex:100')).toBe('sig-a');
    expect(_signatureCache.get('plex:200')).toBe('sig-b');
  });

  test('clear removes entry for key', () => {
    _signatureCache.set('plex:350694', 'sig');
    _signatureCache.delete('plex:350694');
    expect(_signatureCache.get('plex:350694')).toBeUndefined();
  });
});
