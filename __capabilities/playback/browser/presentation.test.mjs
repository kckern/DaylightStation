import { describe, it, expect, vi, beforeEach } from 'vitest';

const appContract = (extra = {}) => ({
  useVideoPresentation: () => ({ overlay: 'app', debug: null }),
  subscribeLoadingSuppression: () => () => {},
  getLoadingSuppression: () => false,
  ...extra,
});

describe('playback presentation contract: intro slot', () => {
  beforeEach(() => { vi.resetModules(); });

  it('returns no intro when no contract is installed', async () => {
    const p = await import('./presentation.mjs');
    expect(p.useVideoIntro({})).toBeNull();
  });

  it('fills in the neutral intro for a contract without useVideoIntro', async () => {
    const p = await import('./presentation.mjs');
    p.configurePlaybackPresentation(appContract());
    expect(p.useVideoIntro({})).toBeNull();
    expect(p.useVideoPresentation({}).overlay).toBe('app');
  });

  it('calls the installed useVideoIntro with the args', async () => {
    const p = await import('./presentation.mjs');
    p.configurePlaybackPresentation(appContract({ useVideoIntro: (a) => ({ status: 'none', seen: a }) }));
    const args = { media: { key: 'x' } };
    expect(p.useVideoIntro(args)).toEqual({ status: 'none', seen: args });
  });

  it('rejects a useVideoIntro that is not a function', async () => {
    const p = await import('./presentation.mjs');
    expect(() => p.configurePlaybackPresentation(appContract({ useVideoIntro: 5 }))).toThrow(TypeError);
  });

  it('accepts a repeat configure with the same contract that omits useVideoIntro', async () => {
    const p = await import('./presentation.mjs');
    const contract = appContract();
    p.configurePlaybackPresentation(contract);
    expect(() => p.configurePlaybackPresentation(contract)).not.toThrow();
  });
});
