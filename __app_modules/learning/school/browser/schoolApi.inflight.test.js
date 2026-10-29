import { describe, expect, it, vi, afterEach } from 'vitest';
import { schoolApi } from './schoolApi.js';

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch() {
  const resolvers = [];
  const fetchMock = vi.fn(() => new Promise((resolve) => { resolvers.push(resolve); }));
  vi.stubGlobal('fetch', fetchMock);
  const answer = (index, data) => resolvers[index]({ ok: true, status: 200, json: async () => data });
  return { fetchMock, answer };
}

describe('schoolApi — identical GETs in flight', () => {
  it('shares one request between callers, each with its own copy', async () => {
    const { fetchMock, answer } = stubFetch();
    const a = schoolApi.teacherDay('2026-10-28', { learnerId: 'kid' });
    const b = schoolApi.teacherDay('2026-10-28', { learnerId: 'kid' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/school/teacher/day?studyDay=2026-10-28&learnerId=kid');
    answer(0, { learners: [{ learnerId: 'kid' }] });
    const [first, second] = await Promise.all([a, b]);
    expect(second.data).toEqual(first.data);
    expect(second.data).not.toBe(first.data);
  });

  it('caches nothing once settled, and never merges writes', async () => {
    const { fetchMock, answer } = stubFetch();
    const first = schoolApi.teacherDay();
    answer(0, []);
    await first;
    const again = schoolApi.teacherDay();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    answer(1, []);
    await again;
    schoolApi.flashcardTeacherReport({ learnerId: 'kid', actorId: 'parent' });
    schoolApi.flashcardTeacherReport({ learnerId: 'kid', actorId: 'parent' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
