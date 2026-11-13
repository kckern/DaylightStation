import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teacherWorkspaceApi } from "./teacherWorkspaceApi.js";

beforeEach(() => { globalThis.fetch = vi.fn(async () => ({
  ok: true, status: 200, json: async () => ({ ok: true }), blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
})); });

describe('teacherWorkspaceApi', () => {
  it('encodes timeline filters', async () => {
    await teacherWorkspaceApi.timeline('a b', { limit: 20, unitId: 'math/one' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/learners/a%20b/timeline?limit=20&unitId=math%2Fone', expect.objectContaining({ method: 'GET' }));
  });

  it('sends agenda idempotency in both header and body for compatibility', async () => {
    await teacherWorkspaceApi.agendaDispatch('user_4', { dispatchedBy: 'teacher' }, 'agenda-1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/learners/user_4/agenda/dispatch', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': 'agenda-1' }),
      body: JSON.stringify({ dispatchedBy: 'teacher', idempotencyKey: 'agenda-1' }),
    }));
  });

  it('keeps grade adjustment preview-first', async () => {
    await teacherWorkspaceApi.adjustGrade('session/1', { percent: 95, reason: 'eraser', apply: false });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/sessions/session%2F1/grade-adjustments', expect.objectContaining({
      body: JSON.stringify({ percent: 95, reason: 'eraser', apply: false }),
    }));
  });

  it('sends no step-up header on any write', async () => {
    await teacherWorkspaceApi.adjustGrade('ses_1', { apply: false });
    await teacherWorkspaceApi.adjustGrade('ses_1', { apply: true });
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('X-Teacher-Step-Up');
    expect(fetch.mock.calls[1][1].headers).not.toHaveProperty('X-Teacher-Step-Up');
  });

  it('returns a postview as a blob, read as the named teacher', async () => {
    const result = await teacherWorkspaceApi.artifactPostview('art/1', 'parent');
    expect(result.ok).toBe(true);
    expect(result.data).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/artifacts/art%2F1/postview.pdf?by=parent', expect.objectContaining({
      credentials: 'same-origin', headers: {},
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

  it('reads who has a book, same-origin, under the teacher prefix', async () => {
    await teacherWorkspaceApi.bookReaders('9780000000002');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/books/9780000000002/readers', expect.objectContaining({
      method: 'GET', credentials: 'same-origin',
    }));
  });
});
