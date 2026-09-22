import { afterEach, describe, expect, it, vi } from 'vitest';
import { wordLadderApi } from './wordLadderApi.js';

vi.mock('./wordLadderLog.js', () => ({ wordLadderLog: { apiRejected: vi.fn(), apiFailed: vi.fn() } }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('wordLadderApi', () => {
  it('posts JSON and never throws', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sessionId: 's1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(wordLadderApi.open({ userId: 'kid', deckId: 'language/korean/week-01-classroom' })).resolves.toEqual({ ok: true, status: 200, data: { sessionId: 's1' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/school/word-ladder/open', expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'kid', deckId: 'language/korean/week-01-classroom' }) }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(wordLadderApi.plan('s1', 'kid')).resolves.toEqual({ ok: false, status: 0, data: null });
  });
  it('uploads a take as a raw body with its own content type', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ take: 1 }) }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob(['abc'], { type: 'audio/ogg' });
    await wordLadderApi.uploadRecording('s1', { userId: 'kid', wordId: 'gawi', blob });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/school/word-ladder/s1/cards/gawi/recording?userId=kid&ext=ogg');
    expect(init.headers['Content-Type']).toBe('audio/ogg');
    expect(init.body).toBe(blob);
  });
});
