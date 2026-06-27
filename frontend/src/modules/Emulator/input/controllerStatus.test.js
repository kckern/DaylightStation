import { describe, it, expect } from 'vitest';
import { knownControllerStates, diffControllerConnections } from './controllerStatus.js';

const SFC30 = { id: 'sfc30', label: '8BitDo SFC30', address: 'E4:17:D8:C6:54:F0', match: '8Bitdo|SFC30|2dc8' };
const XBOX = { id: 'xbox', label: 'Xbox Wireless', match: 'Xbox|045e' }; // no address (generic)

describe('knownControllerStates', () => {
  it('reports an address-configured controller as connected (with battery) when present in the feed', () => {
    const inv = [{ address: 'e4:17:d8:c6:54:f0', name: '8Bitdo SFC30 GamePad', connected: true, battery: 75 }];
    const states = knownControllerStates(inv, [SFC30, XBOX]);
    expect(states).toEqual([{ key: 'e4:17:d8:c6:54:f0', label: '8BitDo SFC30', connected: true, battery: 75 }]);
  });

  it('reports an address-configured controller as disconnected when absent from the feed', () => {
    const states = knownControllerStates([], [SFC30]);
    expect(states).toEqual([{ key: 'e4:17:d8:c6:54:f0', label: '8BitDo SFC30', connected: false, battery: null }]);
  });

  it('includes an address-less controller only when a connected device matches its name regex', () => {
    const inv = [{ address: 'aa:bb:cc:dd:ee:ff', name: 'Xbox Wireless Controller', connected: true, battery: null }];
    const states = knownControllerStates(inv, [XBOX]);
    expect(states).toEqual([{ key: 'aa:bb:cc:dd:ee:ff', label: 'Xbox Wireless', connected: true, battery: null }]);
    // absent → not tracked at all
    expect(knownControllerStates([], [XBOX])).toEqual([]);
  });

  it('ignores connected devices that match no known controller (e.g. a speaker)', () => {
    const inv = [{ address: '54:15:89:f9:96:19', name: 'JBL PartyBox 710', connected: true, battery: null }];
    // Address-less controllers only → a non-matching speaker yields nothing tracked.
    expect(knownControllerStates(inv, [XBOX])).toEqual([]);
    // An address-configured controller is still always tracked (disconnected), and the
    // speaker is NOT added to the output.
    expect(knownControllerStates(inv, [SFC30])).toEqual([
      { key: 'e4:17:d8:c6:54:f0', label: '8BitDo SFC30', connected: false, battery: null },
    ]);
  });

  it('tolerates a null/absent feed without throwing', () => {
    expect(knownControllerStates(null, [SFC30])).toEqual([{ key: 'e4:17:d8:c6:54:f0', label: '8BitDo SFC30', connected: false, battery: null }]);
  });
});

describe('diffControllerConnections', () => {
  const conn = (key, connected) => ({ key, label: key, connected, battery: null });

  it('flags a controller that went disconnected → connected', () => {
    const d = diffControllerConnections([conn('a', false)], [conn('a', true)]);
    expect(d.connected.map((c) => c.key)).toEqual(['a']);
    expect(d.disconnected).toEqual([]);
  });

  it('flags a controller that went connected → disconnected', () => {
    const d = diffControllerConnections([conn('a', true)], [conn('a', false)]);
    expect(d.disconnected.map((c) => c.key)).toEqual(['a']);
    expect(d.connected).toEqual([]);
  });

  it('emits nothing when state is unchanged', () => {
    const d = diffControllerConnections([conn('a', true)], [conn('a', true)]);
    expect(d).toEqual({ connected: [], disconnected: [] });
  });

  it('toasts a newly-known controller only if it is connected (not initial-disconnected)', () => {
    expect(diffControllerConnections([], [conn('a', true)]).connected.map((c) => c.key)).toEqual(['a']);
    expect(diffControllerConnections([], [conn('a', false)])).toEqual({ connected: [], disconnected: [] });
  });
});
