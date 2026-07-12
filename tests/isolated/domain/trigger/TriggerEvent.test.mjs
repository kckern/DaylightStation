import { describe, it, expect } from 'vitest';
import { TriggerEvent } from '#domains/trigger/TriggerEvent.mjs';

describe('TriggerEvent', () => {
  it('normalizes value to a lowercased string and defaults meta', () => {
    const e = TriggerEvent.create({ source: 'nfc', location: 'livingroom', value: '04_AB_CD' });
    expect(e.source).toBe('nfc');
    expect(e.location).toBe('livingroom');
    expect(e.value).toBe('04_ab_cd');
    expect(e.meta).toEqual({});
  });

  it('preserves meta and is immutable', () => {
    const e = TriggerEvent.create({ source: 'barcode', location: 'garage', value: 'plex:1', meta: { device: 'ds2278', transport: 'ws' } });
    expect(e.meta.device).toBe('ds2278');
    expect(() => { e.meta.device = 'x'; }).toThrow();
  });

  it('throws when source or location is missing', () => {
    expect(() => TriggerEvent.create({ source: '', location: 'x', value: 'v' })).toThrow();
    expect(() => TriggerEvent.create({ source: 'nfc', location: '', value: 'v' })).toThrow();
  });
});
