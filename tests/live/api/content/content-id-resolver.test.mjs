/**
 * ContentIdResolver API Integration Test
 *
 * Tests that the ContentIdResolver correctly resolves content IDs
 * through the info and play API endpoints.
 */

const BACKEND_PORT = process.env.BACKEND_PORT || 3112;
const BASE_URL = `http://localhost:${BACKEND_PORT}/api/v1`;

describe('ContentIdResolver via API', () => {
  test('resolves canonical singalong ID via info endpoint', async () => {
    const res = await fetch(`${BASE_URL}/info/singalong/hymn/166`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBeTruthy();
  });

  test('resolves hymn alias via info endpoint', async () => {
    const res = await fetch(`${BASE_URL}/info/hymn/166`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBeTruthy();
  });

  test('resolves scripture alias via info endpoint', async () => {
    const res = await fetch(`${BASE_URL}/info/scripture/alma-32`);
    expect(res.status).toBe(200);
  });

  test('resolves plex ID via play endpoint', async () => {
    const res = await fetch(`${BASE_URL}/play/plex/457385`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mediaUrl).toBeTruthy();
  });

  test('resolves hymn alias via play endpoint', async () => {
    const res = await fetch(`${BASE_URL}/play/hymn/166`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBeTruthy();
  });
});
