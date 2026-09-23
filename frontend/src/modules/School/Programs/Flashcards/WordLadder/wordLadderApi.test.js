import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWordLadderApi } from './wordLadderApi.js';

vi.mock('./wordLadderLog.js', () => ({ wordLadderLog: { apiRejected: vi.fn(), apiFailed: vi.fn() } }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('createWordLadderApi', () => {
  it('live mode calls the plain base and never sends a scenario', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sittingId: 's1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: false });
    await expect(api.open({ userId: 'kid', deckId: 'language/korean/week-01', scenario: 'exhausted' })).resolves.toEqual({ ok: true, status: 200, data: { sittingId: 's1' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/school/word-ladder/open', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ userId: 'kid', deckId: 'language/korean/week-01' }),
    }));
  });

  it('test mode calls the /test base and forwards a scenario', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sittingId: 's1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: true });
    await api.open({ userId: 'kid', deckId: 'language/korean/week-01', scenario: 'exhausted' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/school/word-ladder/test/open', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ userId: 'kid', deckId: 'language/korean/week-01', scenario: 'exhausted' }),
    }));
  });

  it('respond, get and close hit the right paths with the right verbs', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: false });
    await api.respond('sit1', { userId: 'kid', itemId: 'r1:s:0', response: { seen: true } });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/school/word-ladder/sittings/sit1/items/r1%3As%3A0', expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'kid', response: { seen: true } }) }));
    await api.get('sit1', 'kid');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/school/word-ladder/sittings/sit1?userId=kid', expect.objectContaining({ method: 'GET' }));
    await api.close('sit1', { userId: 'kid', reason: 'idle' });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/school/word-ladder/sittings/sit1/close', expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'kid', reason: 'idle' }) }));
  });

  it('never throws — a fetch rejection resolves {ok:false,status:0}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const api = createWordLadderApi({ test: false });
    await expect(api.get('sit1', 'kid')).resolves.toEqual({ ok: false, status: 0, data: null });
  });

  it('open forwards capabilities when given, and omits them when not', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: false });
    await api.open({ userId: 'kid', deckId: 'd', capabilities: { microphone: true } });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/school/word-ladder/open', expect.objectContaining({
      body: JSON.stringify({ userId: 'kid', deckId: 'd', capabilities: { microphone: true } }),
    }));
    await api.open({ userId: 'kid', deckId: 'd' });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/school/word-ladder/open', expect.objectContaining({
      body: JSON.stringify({ userId: 'kid', deckId: 'd' }),
    }));
  });

  it('uploadRecording sends the raw blob with its own Content-Type and userId/ext on the query', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ done: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: false });
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await api.uploadRecording('sit1', { userId: 'kid', itemId: 'r1:say:0', blob, ext: 'webm' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/school/word-ladder/sittings/sit1/recordings/r1%3Asay%3A0?userId=kid&ext=webm',
      expect.objectContaining({ method: 'POST', body: blob, headers: expect.objectContaining({ 'Content-Type': 'audio/webm' }) }),
    );
  });

  it('uploadRecording omits ext from the query when not given', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ done: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: false });
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await api.uploadRecording('sit1', { userId: 'kid', itemId: 'r1:say:0', blob });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/school/word-ladder/sittings/sit1/recordings/r1%3Asay%3A0?userId=kid',
      expect.anything(),
    );
  });

  it('practice posts mode/help/filter/chosen/frontSide', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: false });
    await api.practice('sit1', { userId: 'kid', mode: 'flashcards', help: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/school/word-ladder/sittings/sit1/practice', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        userId: 'kid', mode: 'flashcards', help: true,
      }),
    }));
  });

  it('words GETs with userId and deckId on the query', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ words: [] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: false });
    await api.words({ userId: 'kid', deckId: 'language/korean/week-01' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/school/word-ladder/words?userId=kid&deckId=language%2Fkorean%2Fweek-01',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('words passes the sitting id when given (the test mount requires it)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ words: [] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createWordLadderApi({ test: true });
    await api.words({ userId: 'kid', deckId: 'd', sittingId: 'test.p.t.1' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/school/word-ladder/test/words?userId=kid&deckId=d&sittingId=test.p.t.1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
