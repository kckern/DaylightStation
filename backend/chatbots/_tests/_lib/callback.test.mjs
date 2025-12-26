/**
 * Tests for callback encoder/decoder utilities
 */

import { encodeCallback, decodeCallback } from '../../_lib/callback.mjs';

describe('callback utilities', () => {
  it('should encode action and params into JSON string', () => {
    const result = encodeCallback('f', { id: 'abc123', f: 0.5 });
    expect(result).toBe('{"a":"f","id":"abc123","f":0.5}');
  });

  it('should decode JSON callback payloads', () => {
    const payload = '{"a":"f","id":"abc123","f":0.5}';
    const decoded = decodeCallback(payload);
    expect(decoded).toEqual({ a: 'f', id: 'abc123', f: 0.5 });
  });

  it('should mark legacy strings as legacy', () => {
    const legacy = 'adj_factor_0.25_18835f8e-2fa6-4d1a-ba74-e09720cebfaa';
    const decoded = decodeCallback(legacy);
    expect(decoded.legacy).toBe(true);
    expect(decoded.raw).toBe(legacy);
  });
});
