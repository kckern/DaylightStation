// tests/unit/parity/endpoint-map.unit.test.mjs
import { describe, it, expect } from '@jest/globals';
import { loadEndpointMap, buildUrl, parseInput } from '../../lib/endpoint-map.mjs';

describe('endpoint-map', () => {
  describe('parseInput', () => {
    it('parses plex input', () => {
      const result = parseInput('plex: 663035');
      expect(result).toEqual({ type: 'plex', value: '663035' });
    });

    it('parses scripture input with path', () => {
      const result = parseInput('scripture: nt');
      expect(result).toEqual({ type: 'scripture', value: 'nt' });
    });

    it('parses scripture with version modifier', () => {
      const result = parseInput('scripture: gen 1; version nrsv');
      expect(result).toEqual({ type: 'scripture', value: 'gen 1; version nrsv' });
    });

    it('returns null for app inputs', () => {
      const result = parseInput('app: wrapup');
      expect(result).toBeNull();
    });

    it('returns null for invalid inputs', () => {
      const result = parseInput('unknown: foo');
      expect(result).toBeNull();
    });
  });

  describe('buildUrl', () => {
    it('builds legacy plex URL', () => {
      const url = buildUrl('plex', '663035', 'legacy');
      expect(url).toBe('/media/plex/info/663035');
    });

    it('builds ddd plex URL', () => {
      const url = buildUrl('plex', '663035', 'ddd');
      expect(url).toBe('/api/content/plex/663035');
    });

    it('builds scripture URL with path', () => {
      const url = buildUrl('scripture', 'bom/sebom/31103', 'legacy');
      expect(url).toBe('/data/scripture/bom/sebom/31103');
    });
  });
});
