// tests/isolated/domain/trigger/services/BarcodeResolver.test.mjs
import { describe, it, expect } from 'vitest';
import { BarcodeResolver } from '#domains/trigger/services/BarcodeResolver.mjs';

const registry = { locations: { 'ds2278': { target: 'living-room', default_action: 'queue', actions: ['queue', 'play', 'open'] } } };

describe('BarcodeResolver', () => {
  it('maps a bare content code to a content Response (optimistic, source default action + target)', () => {
    const r = BarcodeResolver.resolve({ location: 'ds2278', value: 'plex:595104', registry });
    expect(r.kind).toBe('content');
    expect(r.target).toBe('living-room');
    expect(r.posture).toBe('optimistic');
    expect(r.expression).toEqual({ action: 'queue', contentId: 'plex:595104', options: {} });
  });

  it('honors an explicit screen + action + options in the code', () => {
    const r = BarcodeResolver.resolve({ location: 'ds2278', value: 'office:play:plex:1+shuffle', registry });
    expect(r.target).toBe('office');
    expect(r.expression.action).toBe('play');
    expect(r.expression.contentId).toBe('plex:1');
    expect(r.expression.options).toEqual({ shuffle: true });
  });

  it('maps a command code to a transport response', () => {
    const r = BarcodeResolver.resolve({ location: 'ds2278', value: 'volume:30', registry });
    expect(r).toEqual({ kind: 'transport', target: 'living-room', command: 'volume', arg: '30' });
  });

  it('returns null for an unknown location or unparseable code', () => {
    expect(BarcodeResolver.resolve({ location: 'nope', value: 'plex:1', registry })).toBeNull();
    expect(BarcodeResolver.resolve({ location: 'ds2278', value: '', registry })).toBeNull();
  });
});
