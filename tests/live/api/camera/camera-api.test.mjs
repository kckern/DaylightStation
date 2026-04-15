import { getAppPort } from '../../../_lib/configHelper.mjs';

const APP_PORT = getAppPort();
const BASE_URL = `http://localhost:${APP_PORT}`;

describe('Camera API', () => {
  test('GET /api/v1/camera returns list of cameras', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty('cameras');
    expect(Array.isArray(body.cameras)).toBe(true);
    expect(body.cameras.length).toBeGreaterThan(0);

    const cam = body.cameras[0];
    expect(cam).toHaveProperty('id');
    expect(cam).toHaveProperty('host');
    expect(cam).toHaveProperty('capabilities');
    expect(cam.capabilities).toContain('snapshot');
    expect(cam).not.toHaveProperty('username');
    expect(cam).not.toHaveProperty('password');
    expect(JSON.stringify(cam)).not.toContain('DAP9');
  });

  test('GET /api/v1/camera/driveway-camera/snap returns JPEG', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/driveway-camera/snap`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('no-cache');

    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  test('GET /api/v1/camera/nonexistent/snap returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/nonexistent/snap`);
    expect(res.status).toBe(404);
  });
});

describe('Camera Live Stream API', () => {
  const CAMERA_ID = 'driveway-camera';

  afterAll(async () => {
    await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live`, { method: 'DELETE' });
  });

  test('GET /api/v1/camera/:id/live/stream.m3u8 starts stream and returns playlist', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live/stream.m3u8`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toMatch(/mpegurl/);
    expect(res.headers.get('cache-control')).toBe('no-cache');

    const body = await res.text();
    expect(body).toContain('#EXTM3U');
  }, 15000);

  test('GET /api/v1/camera/:id/live/:segment.ts returns video segment', async () => {
    const playlistRes = await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live/stream.m3u8`);
    const playlist = await playlistRes.text();
    const segmentMatch = playlist.match(/^(stream\d+\.ts)$/m);
    expect(segmentMatch).not.toBeNull();

    const segmentName = segmentMatch[1];
    const segRes = await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live/${segmentName}`);
    expect(segRes.ok).toBe(true);
    expect(segRes.headers.get('content-type')).toMatch(/mp2t/);
  }, 10000);

  test('DELETE /api/v1/camera/:id/live stops the stream', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/${CAMERA_ID}/live`, { method: 'DELETE' });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('stopped', true);
  });

  test('GET /api/v1/camera/nonexistent/live/stream.m3u8 returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/camera/nonexistent/live/stream.m3u8`);
    expect(res.status).toBe(404);
  });
});
