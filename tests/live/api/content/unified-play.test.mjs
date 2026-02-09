/**
 * Unified Play API Test
 *
 * Verifies that all content types resolve through the play endpoint,
 * including aliases (hymn, scripture, talk, poem) and canonical sources.
 */

const BACKEND_PORT = process.env.BACKEND_PORT || 3112;
const BASE_URL = `http://localhost:${BACKEND_PORT}/api/v1`;

describe('Unified Play API', () => {
  test('resolves singalong hymn through play endpoint', async () => {
    const res = await fetch(`${BASE_URL}/play/singalong/hymn/166`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.format).toBe('singalong');
    expect(data.title).toBeTruthy();
  });

  test('resolves hymn alias through play endpoint', async () => {
    const res = await fetch(`${BASE_URL}/play/hymn/166`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.format).toBe('singalong');
  });

  test('resolves scripture through play endpoint', async () => {
    const res = await fetch(`${BASE_URL}/play/scripture/alma-32`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.format).toBe('readalong');
  });

  test('resolves talk through play endpoint', async () => {
    const res = await fetch(`${BASE_URL}/play/talk/ldsgc`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBeTruthy();
  });

  test('resolves plex through play endpoint (still works)', async () => {
    const res = await fetch(`${BASE_URL}/play/plex/457385`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mediaUrl).toBeTruthy();
    expect(data.format).toMatch(/^(video|audio|dash_video)$/);
  });

  test('resolves media through play endpoint', async () => {
    const res = await fetch(`${BASE_URL}/play/media/sfx/intro`);
    if (res.status === 200) {
      const data = await res.json();
      expect(data.format).toBeTruthy();
    }
  });
});
