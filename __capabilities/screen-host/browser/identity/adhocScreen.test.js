import { describe, it, expect, vi } from 'vitest';
import { resolveScreenDevice, screenName, startScreenAnnounce, BROWSER_DEVICE, NAME_KEY } from './adhocScreen.js';

const adhoc = { screen: 'adhoc', websocket: { commands: true, publishState: true, guardrails: { device: BROWSER_DEVICE } } };

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

describe('resolveScreenDevice', () => {
  it('puts this browser id in place of $browser', () => {
    const { config, browserScreen } = resolveScreenDevice(adhoc, 'browser:abcd1234');
    expect(browserScreen).toBe(true);
    expect(config.websocket.guardrails.device).toBe('browser:abcd1234');
    expect(config.websocket.commands).toBe(true);
    expect(adhoc.websocket.guardrails.device).toBe(BROWSER_DEVICE); // not mutated
  });
  it('leaves a configured screen alone', () => {
    const office = { websocket: { guardrails: { device: 'office-tv' } } };
    expect(resolveScreenDevice(office, 'browser:abcd1234')).toEqual({ config: office, browserScreen: false });
  });
  it('takes no commands without a persistent browser id', () => {
    for (const id of ['ephemeral:abcd1234', 'fleet:office-tv', 'browser:x', null]) {
      const { config, browserScreen } = resolveScreenDevice(adhoc, id);
      expect(browserScreen).toBe(false);
      expect(config.websocket.guardrails.device).toBeNull();
      expect(config.websocket.commands).toBe(false);
    }
  });
});

describe('screenName', () => {
  it('takes ?name= and remembers it', () => {
    const s = memoryStorage();
    expect(screenName('?name=MacBook', s)).toBe('MacBook');
    expect(s.m.get(NAME_KEY)).toBe('MacBook');
    expect(screenName('', s)).toBe('MacBook');
  });
  it('is Browser until named, and cleans what it is given', () => {
    expect(screenName('', memoryStorage())).toBe('Browser');
    expect(screenName('?name=%20%20Den%0Alaptop%20', memoryStorage())).toBe('Den laptop');
    expect(screenName('?name=' + 'x'.repeat(80), memoryStorage())).toHaveLength(48);
  });
});

describe('startScreenAnnounce', () => {
  it('announces now and every minute until stopped; a failure is not thrown', async () => {
    vi.useFakeTimers();
    const post = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const stop = startScreenAnnounce({ id: 'browser:abcd1234', name: 'MacBook', post });
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ id: 'browser:abcd1234', name: 'MacBook' });
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(120_000);
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it('does nothing without an id', () => {
    const post = vi.fn();
    startScreenAnnounce({ id: null, name: 'x', post })();
    expect(post).not.toHaveBeenCalled();
  });
});
