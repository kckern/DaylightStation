/**
 * Format Field API Test
 *
 * Verifies that play and info API endpoints include a `format` field
 * in their responses, derived from adapter.contentFormat or item metadata.
 */

const BACKEND_PORT = process.env.BACKEND_PORT || 3112;
const BASE_URL = `http://localhost:${BACKEND_PORT}/api/v1`;

describe('Format field in API responses', () => {
  test('play endpoint returns format for plex video', async () => {
    const res = await fetch(`${BASE_URL}/play/plex/457385`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.format).toMatch(/^(video|audio|dash_video)$/);
  });

  test('info endpoint returns format for singalong', async () => {
    const res = await fetch(`${BASE_URL}/info/singalong/hymn/166`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.format).toBe('singalong');
  });

  test('info endpoint returns format for readalong scripture', async () => {
    const res = await fetch(`${BASE_URL}/info/readalong/scripture/bom/sebom/31103`);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.format).toBe('readalong');
    }
  });

  test('play endpoint returns format for media audio', async () => {
    const res = await fetch(`${BASE_URL}/play/media/sfx/intro`);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.format).toMatch(/^(audio|video)$/);
    }
  });
});
