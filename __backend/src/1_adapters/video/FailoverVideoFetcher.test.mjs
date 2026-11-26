import { describe, it, expect, vi } from 'vitest';
import { FailoverVideoFetcher } from './FailoverVideoFetcher.mjs';

const quiet = { warn() {} };
const ok = { kind: 'downloaded', title: 't', duration: 1, media: {} };
const fetcher = (name, behaviour) => ({ name, fetch: vi.fn(behaviour), stored: vi.fn(async () => null), cancel: vi.fn(async () => {}) });

describe('FailoverVideoFetcher', () => {
  it('uses the first fetcher that fetches it', async () => {
    const a = fetcher('service', async () => ok);
    const b = fetcher('local', async () => ok);
    const out = await new FailoverVideoFetcher({ fetchers: [a, null, b], logger: quiet }).fetch('u', { name: 'n' });
    expect(out).toMatchObject({ kind: 'downloaded', fetcher: 'service' });
    expect(b.fetch).not.toHaveBeenCalled();
  });

  it('moves on when a fetcher is unreachable or fails', async () => {
    const a = fetcher('service', async () => { throw new Error('unreachable'); });
    const b = fetcher('local', async () => ({ kind: 'failed', error: 'x', reason: 'error' }));
    const c = fetcher('third', async () => ok);
    const attempts = [];
    const out = await new FailoverVideoFetcher({ fetchers: [a, b, c], logger: quiet }).fetch('u', { name: 'n', onAttempt: (x) => attempts.push(x.fetcher) });
    expect(out.fetcher).toBe('third');
    expect(attempts).toEqual(['service', 'local', 'third']);
  });

  it('does not try again a video too large to fetch, or a cancelled fetch', async () => {
    const a = fetcher('service', async () => ({ kind: 'failed', error: 'too large', reason: 'too_large' }));
    const b = fetcher('local', async () => ok);
    expect(await new FailoverVideoFetcher({ fetchers: [a, b], logger: quiet }).fetch('u', { name: 'n' })).toMatchObject({ reason: 'too_large' });
    expect(b.fetch).not.toHaveBeenCalled();
  });

  it('stops when its signal is aborted between fetchers', async () => {
    const ctrl = new AbortController();
    const a = fetcher('service', async () => { ctrl.abort(); return { kind: 'failed', error: 'lost', reason: 'error' }; });
    const b = fetcher('local', async () => ok);
    expect(await new FailoverVideoFetcher({ fetchers: [a, b], logger: quiet }).fetch('u', { name: 'n', signal: ctrl.signal })).toMatchObject({ reason: 'cancelled' });
    expect(b.fetch).not.toHaveBeenCalled();
  });

  it('asks every fetcher for a stored video and cancels in all of them', async () => {
    const a = fetcher('service', async () => ok);
    const b = fetcher('local', async () => ok);
    b.stored.mockResolvedValueOnce({ title: 'k' });
    const f = new FailoverVideoFetcher({ fetchers: [a, b], logger: quiet });
    expect(await f.stored('n')).toEqual({ title: 'k' });
    await f.cancel('n');
    expect(a.cancel).toHaveBeenCalledWith('n');
    expect(b.cancel).toHaveBeenCalledWith('n');
  });
});
