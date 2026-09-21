import { describe, expect, it, vi } from 'vitest';
import { createPlexHlsSessionCleanup } from './plexHlsSessionCleanup.js';

const origin = 'http://localhost:5174';
const sessionA = '84cc0c4c-8160-4e89-a240-26a165440d1e';
const sessionB = '35f14d6c-82e8-483b-87e1-7d66fc8c843d';
const sessionPath = id => `/api/v1/proxy/plex/video/:/transcode/universal/session/${id}/base/`;
const stopPath = id => `/api/v1/proxy/plex/video/:/transcode/universal/stop?session=${id}`;
const setup = (options = {}) => {
  const request = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  const logger = { info: vi.fn(), warn: vi.fn() };
  return { request, logger, owner: createPlexHlsSessionCleanup({ isPlex: true, origin, request, logger, ...options }) };
};

describe('Plex HLS observed-session teardown', () => {
  it('stops only observed sessions once, deduplicating playlist and fragment observations', async () => {
    const { owner, request } = setup();
    owner.observe(`${origin}${sessionPath(sessionA)}index.m3u8?X-Plex-Token=not-for-logs`);
    owner.observe(`${sessionPath(sessionA)}00000.ts`);
    owner.observe(`${sessionPath(sessionB)}00001.ts`);
    expect(request).not.toHaveBeenCalled();
    await owner.destroy();
    await owner.destroy();
    expect(request.mock.calls).toEqual([
      [stopPath(sessionA), { method: 'GET', credentials: 'same-origin', keepalive: true }],
      [stopPath(sessionB), { method: 'GET', credentials: 'same-origin', keepalive: true }],
    ]);
  });

  it('rejects foreign origins, other routes, invalid identifiers and client/session query guesses', async () => {
    const { owner, request } = setup();
    for (const url of [
      `https://foreign.test${sessionPath(sessionA)}index.m3u8`,
      `http://user:secret@localhost:5174${sessionPath(sessionA)}index.m3u8`,
      `/other/session/${sessionA}/index.m3u8`,
      `${sessionPath('not-a-uuid')}index.m3u8`,
      `/api/v1/proxy/plex/stream/697368?session=${sessionA}`,
      `/api/v1/proxy/plex/video/:/transcode/universal/start.m3u8?X-Plex-Session-Identifier=${sessionA}`,
      `//foreign.test${sessionPath(sessionA)}index.m3u8`,
      null,
    ]) owner.observe(url);
    await owner.destroy();
    expect(request).not.toHaveBeenCalled();
  });

  it('does not register late observations after its owner is destroyed', async () => {
    const { owner, request } = setup();
    await owner.destroy();
    owner.observe(`${sessionPath(sessionB)}00000.ts`);
    await owner.destroy();
    expect(request).not.toHaveBeenCalled();
  });

  it('never sends a Plex stop for non-Plex HLS', async () => {
    const { owner, request } = setup({ isPlex: false });
    owner.observe(`${sessionPath(sessionA)}index.m3u8`);
    await owner.destroy();
    expect(request).not.toHaveBeenCalled();
  });

  it('reports best-effort failures without leaking input URL credentials or throwing during destruction', async () => {
    const { owner, request, logger } = setup();
    request.mockRejectedValue(new Error('secret URL must not be logged'));
    owner.observe(`${sessionPath(sessionA)}00000.ts?X-Plex-Token=secret`);
    await expect(owner.destroy()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('video.hls.session-stop', {
      sessionId: sessionA, outcome: 'failed', reason: 'request-rejected',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
  });
});
