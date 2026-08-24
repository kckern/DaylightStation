import { describe, it, expect, vi } from 'vitest';
import { TeacherAgendaDispatch } from './TeacherAgendaDispatch.mjs';

function fixture() {
  const previewAgenda = { execute: vi.fn(async () => ({ document: { id: 'agenda-kid' }, sections: [{ id: 'math' }], plan: { entries: [{ unitId: 'u1' }], errors: [] } })) };
  const buildAgenda = { execute: vi.fn(async () => ({ document: { id: 'agenda-kid' }, sections: [{ id: 'math' }], plan: { entries: [{ unitId: 'u1' }] } })) };
  const receipts = { print: vi.fn(async () => ({ printed: true, reason: null })) };
  const teacherGate = { assert: vi.fn() };
  return { previewAgenda, buildAgenda, receipts, teacherGate, useCase: new TeacherAgendaDispatch({
    previewAgenda, buildAgenda, receipts, teacherGate,
    clock: () => new Date('2026-08-24T12:00:00.000Z'), logger: { info() {} },
  }) };
}

describe('TeacherAgendaDispatch', () => {
  it('previews with the dry-run builder and never prints', async () => {
    const f = fixture();
    await expect(f.useCase.preview({ learnerId: 'kid' })).resolves.toMatchObject({ ready: true, entries: [{ unitId: 'u1' }] });
    expect(f.buildAgenda.execute).not.toHaveBeenCalled();
    expect(f.receipts.print).not.toHaveBeenCalled();
  });

  it('gate-checks and prints exactly once for an idempotency key', async () => {
    const f = fixture();
    const args = { learnerId: 'kid', dispatchedBy: 'parent', pin: '1234', idempotencyKey: 'dispatch-1' };
    const first = await f.useCase.execute(args);
    const second = await f.useCase.execute(args);
    expect(first).toMatchObject({ printed: true, idempotent: false, idempotencyKey: 'dispatch-1' });
    expect(second.idempotent).toBe(true);
    expect(f.teacherGate.assert).toHaveBeenCalledTimes(2);
    expect(f.buildAgenda.execute).toHaveBeenCalledTimes(1);
    expect(f.receipts.print).toHaveBeenCalledTimes(1);
  });

  it('refuses reuse of a key for another learner', async () => {
    const f = fixture();
    await f.useCase.execute({ learnerId: 'kid', dispatchedBy: 'parent', idempotencyKey: 'dispatch-1' });
    await expect(f.useCase.execute({ learnerId: 'other', dispatchedBy: 'parent', idempotencyKey: 'dispatch-1' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
