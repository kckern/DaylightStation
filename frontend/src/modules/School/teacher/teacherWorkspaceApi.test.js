import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';

beforeEach(() => { globalThis.fetch = vi.fn(async () => ({
  ok: true, status: 200, json: async () => ({ ok: true }), blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
})); });

describe('teacherWorkspaceApi', () => {
  it('encodes timeline filters', async () => {
    await teacherWorkspaceApi.timeline('a b', { limit: 20, unitId: 'math/one' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/learners/a%20b/timeline?limit=20&unitId=math%2Fone', expect.objectContaining({ method: 'GET' }));
  });

  it('sends agenda idempotency in both header and body for compatibility', async () => {
    await teacherWorkspaceApi.agendaDispatch('learner-a', { dispatchedBy: 'teacher', pin: '1234' }, 'agenda-1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/learners/learner-a/agenda/dispatch', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': 'agenda-1' }),
      body: JSON.stringify({ dispatchedBy: 'teacher', pin: '1234', idempotencyKey: 'agenda-1' }),
    }));
  });

  it('keeps grade adjustment preview-first', async () => {
    await teacherWorkspaceApi.adjustGrade('session/1', { percent: 95, reason: 'eraser', apply: false });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/sessions/session%2F1/grade-adjustments', expect.objectContaining({
      body: JSON.stringify({ percent: 95, reason: 'eraser', apply: false }),
    }));
  });

  it('uses same-origin credentials for status and unlock without exposing a cookie token', async () => {
    await teacherWorkspaceApi.authStatus();
    await teacherWorkspaceApi.unlock('parent', '4321');
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/v1/school/teacher/auth/status', expect.objectContaining({ credentials: 'same-origin' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/school/teacher/auth/unlock', expect.objectContaining({
      credentials: 'same-origin', body: JSON.stringify({ userId: 'parent', pin: '4321' }),
    }));
  });

  it('attaches one-use grants only to the sensitive apply request', async () => {
    await teacherWorkspaceApi.adjustGrade('ses_1', { apply: false });
    await teacherWorkspaceApi.adjustGrade('ses_1', { apply: true }, 'grant-1');
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('X-Teacher-Step-Up');
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ 'X-Teacher-Step-Up': 'grant-1' });
  });

  it('returns a protected postview as a blob with the step-up header', async () => {
    const result = await teacherWorkspaceApi.artifactPostview('art/1', 'grant-2');
    expect(result.ok).toBe(true);
    expect(result.data).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/artifacts/art%2F1/postview.pdf', expect.objectContaining({
      credentials: 'same-origin', headers: { 'X-Teacher-Step-Up': 'grant-2' },
    }));
  });

  it('returns the retained original as an authenticated same-origin blob', async () => {
    const result = await teacherWorkspaceApi.artifactOriginal('art/1');
    expect(result.ok).toBe(true);
    expect(result.data).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/artifacts/art%2F1/original', expect.objectContaining({
      credentials: 'same-origin', headers: {},
    }));
  });

});
