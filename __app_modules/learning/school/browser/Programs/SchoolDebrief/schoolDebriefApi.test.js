import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSchoolDebriefApi } from "./schoolDebriefApi.js";
vi.mock("./schoolDebriefLog.js", () => ({ schoolDebriefLog: { apiRejected: vi.fn(), apiFailed: vi.fn() } }));
beforeEach(() => { global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ phase: 'entry' }) })); });
describe('schoolDebriefApi', () => {
  it('sends the grant header and JSON body', async () => {
    const api = createSchoolDebriefApi({ learnerId: 'test-learner', grant: 'g' });
    await api.entry('2026-10-21', { promptId: 'classes', text: 'math', via: 'typed' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/school/debrief/test-learner/day/2026-10-21/entry');
    expect(init.headers['X-School-Debrief-Grant']).toBe('g');
    expect(JSON.parse(init.body)).toEqual({ promptId: 'classes', text: 'math', via: 'typed' });
  });
  it('never throws on a network failure', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await createSchoolDebriefApi({ learnerId: 'test-learner', grant: 'g' }).day('2026-10-21')).toEqual({ ok: false, status: 0, data: null });
  });
});
