import { beforeEach, describe, expect, it, vi } from 'vitest';
import { teacherWorkspaceApi } from './teacherWorkspaceApi.js';

beforeEach(() => { globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })); });

describe('teacherWorkspaceApi', () => {
  it('encodes timeline filters', async () => {
    await teacherWorkspaceApi.timeline('a b', { limit: 20, unitId: 'math/one' });
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/learners/a%20b/timeline?limit=20&unitId=math%2Fone', expect.objectContaining({ method: 'GET' }));
  });

  it('sends agenda idempotency in both header and body for compatibility', async () => {
    await teacherWorkspaceApi.agendaDispatch('felix', { dispatchedBy: 'teacher', pin: '1234' }, 'agenda-1');
    expect(fetch).toHaveBeenCalledWith('/api/v1/school/teacher/learners/felix/agenda/dispatch', expect.objectContaining({
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
});
