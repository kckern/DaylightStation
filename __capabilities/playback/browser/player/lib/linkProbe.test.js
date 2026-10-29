import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerPlaybackLinkProbe, probePlaybackLink, hasPlaybackLinkProbe, LINK_PROBE_TIMEOUT_MS } from './linkProbe.js';

let off = [];
afterEach(() => { off.forEach((f) => f()); off = []; vi.useRealTimers(); });

describe('linkProbe', () => {
  it('resolves null when no host registered a probe', async () => {
    expect(hasPlaybackLinkProbe()).toBe(false);
    await expect(probePlaybackLink()).resolves.toBeNull();
  });

  it('returns the probe answer', async () => {
    off.push(registerPlaybackLinkProbe(async () => ({ rssi: -61 })));
    await expect(probePlaybackLink()).resolves.toEqual({ rssi: -61 });
  });

  it('a throwing or rejecting probe becomes { error }, never a rejection', async () => {
    off.push(registerPlaybackLinkProbe(() => { throw new Error('boom'); }));
    await expect(probePlaybackLink()).resolves.toEqual({ error: 'boom' });
    off.push(registerPlaybackLinkProbe(() => Promise.reject(new Error('nope'))));
    await expect(probePlaybackLink()).resolves.toEqual({ error: 'nope' });
  });

  it('a probe that hangs is cut off at the timeout', async () => {
    vi.useFakeTimers();
    off.push(registerPlaybackLinkProbe(() => new Promise(() => {})));
    const p = probePlaybackLink();
    vi.advanceTimersByTime(LINK_PROBE_TIMEOUT_MS + 1);
    await expect(p).resolves.toEqual({ error: 'timeout' });
  });

  it('newest registration wins; a superseded unregister does not remove the newer one', async () => {
    const offA = registerPlaybackLinkProbe(async () => 'a');
    const offB = registerPlaybackLinkProbe(async () => 'b');
    off.push(offB);
    offA();
    await expect(probePlaybackLink()).resolves.toBe('b');
    offB();
    expect(hasPlaybackLinkProbe()).toBe(false);
  });
});
