import { describe, it, expect, vi } from 'vitest';
import { createProxyRefusalHandler } from './proxyRefusalTrigger.mjs';

const PART = '/library/parts/494586/1599193403/file.mp4';
function setup({ resolve = async () => '59546', check = vi.fn(async () => ({ state: 'readable' })) } = {}) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const handler = createProxyRefusalHandler({ healer: { check }, resolveRatingKey: vi.fn(resolve), logger });
  return { handler, check, logger };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createProxyRefusalHandler', () => {
  it('ignores other services and reasons', async () => {
    const { handler, check } = setup();
    handler({ service: 'immich', path: PART, reason: 'source-unreadable' });
    handler({ service: 'plex', path: PART, reason: 'other' });
    await flush();
    expect(check).not.toHaveBeenCalled();
  });

  it('awaits the part resolution and then checks the item as a proxy-origin refusal', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { handler, check, logger } = setup({ resolve: async () => { await gate; return '59546'; } });
    handler({ service: 'plex', path: PART, reason: 'source-unreadable' });
    await flush();
    expect(check).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith('media.source.heal.proxy-unmapped', expect.anything());
    release();
    await flush();
    expect(check).toHaveBeenCalledWith('plex:59546', { origin: 'proxy' });
  });

  it('cooldown: repeated refusals of one file (and its sibling segments) trigger one resolve+check per 30s', async () => {
    let now = 0;
    const resolve = vi.fn(async () => '59546');
    const check = vi.fn(async () => ({ state: 'readable' }));
    const handler = createProxyRefusalHandler({ healer: { check }, resolveRatingKey: resolve, logger: { info: vi.fn(), warn: vi.fn() }, clock: () => now });
    const seg = (n) => `/video/:/transcode/universal/session/uuid-1/base/${n}.ts`;
    for (const n of ['00012', '00013', '00014']) { handler({ service: 'plex', path: seg(n), reason: 'source-unreadable' }); await flush(); }
    handler({ service: 'plex', path: PART, reason: 'source-unreadable' }); await flush(); // same item via another path
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledTimes(1);
    now = 31_000;
    handler({ service: 'plex', path: seg('00015'), reason: 'source-unreadable' }); await flush();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('logs proxy-unmapped only AFTER resolution came up empty', async () => {
    const { handler, check, logger } = setup({ resolve: async () => null });
    handler({ service: 'plex', path: PART, reason: 'source-unreadable' });
    await flush();
    expect(check).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('media.source.heal.proxy-unmapped', expect.objectContaining({ path: PART }));
  });

  it('survives a resolver or healer failure', async () => {
    const a = setup({ resolve: async () => { throw new Error('plex down'); } });
    a.handler({ service: 'plex', path: PART, reason: 'source-unreadable' });
    const b = setup({ check: vi.fn(async () => { throw new Error('boom'); }) });
    b.handler({ service: 'plex', path: PART, reason: 'source-unreadable' });
    await flush();
    expect(a.logger.warn).toHaveBeenCalledWith('media.source.heal.proxy-failed', expect.objectContaining({ error: 'plex down' }));
    expect(b.logger.warn).toHaveBeenCalledWith('media.source.heal.proxy-failed', expect.objectContaining({ ratingKey: '59546', error: 'boom' }));
  });

  it('handles segment paths the same way', async () => {
    const { handler, check } = setup();
    handler({ service: 'plex', path: '/video/:/transcode/universal/session/s1/base/00001.ts', reason: 'source-unreadable' });
    await flush();
    expect(check).toHaveBeenCalledWith('plex:59546', { origin: 'proxy' });
  });
});
