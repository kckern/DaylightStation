import { describe, it, expect } from 'vitest';
import { playLogOrigin } from './playOrigin.js';

describe('playLogOrigin (origin reported on play/log)', () => {
  it('passes a routine or another device that started the playback', () => {
    expect(playLogOrigin({ kind: 'routine', id: 'automation:k1', name: 'Kitchen', triggerId: 't' }, 'c1'))
      .toEqual({ kind: 'routine', id: 'automation:k1', name: 'Kitchen' });
    expect(playLogOrigin({ kind: 'device', id: 'browser:phone' }, 'c1')).toEqual({ kind: 'device', id: 'browser:phone' });
  });
  it('reports nothing for a person at this device (the ledger reads null as "here")', () => {
    expect(playLogOrigin({ kind: 'device', id: 'browser:c1' }, 'c1')).toBeNull();
    expect(playLogOrigin(null, 'c1')).toBeNull();
    expect(playLogOrigin({ kind: 'device' }, 'c1')).toBeNull();
  });
});
