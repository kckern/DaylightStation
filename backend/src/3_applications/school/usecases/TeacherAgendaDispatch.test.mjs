import { describe, it, expect, vi } from 'vitest';
import { TeacherAgendaDispatch } from './TeacherAgendaDispatch.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

class MemoryReceiptStore {
  records = new Map();
  async claim({ key, fingerprint }) {
    const record = this.records.get(key);
    if (!record) { this.records.set(key, { fingerprint, status: 'pending' }); return { kind: 'new' }; }
    if (record.fingerprint !== fingerprint) return { kind: 'conflict' };
    if (record.status === 'completed') return { kind: 'replay', receipt: record.receipt };
    return { kind: 'pending' };
  }
  async complete({ key, fingerprint, receipt }) {
    this.records.set(key, { fingerprint, status: 'completed', receipt });
    return receipt;
  }
}

function fixture() {
  const previewAgenda = { execute: vi.fn(async () => ({ document: { id: 'agenda-kid' }, sections: [{ id: 'math' }], plan: { entries: [{ unitId: 'u1' }], errors: [] } })) };
  const buildAgenda = { execute: vi.fn(async () => ({ document: { id: 'agenda-kid' }, sections: [{ id: 'math' }], plan: { entries: [{ unitId: 'u1' }] } })) };
  const receipts = { print: vi.fn(async () => ({ printed: true, reason: null })) };
  const teacherGate = { assert: vi.fn() };
  const receiptStore = new MemoryReceiptStore();
  const deps = {
    previewAgenda, buildAgenda, receipts, teacherGate, receiptStore,
    clock: () => new Date('2026-08-24T12:00:00.000Z'), logger: { info() {} },
  };
  return { previewAgenda, buildAgenda, receipts, teacherGate, useCase: new TeacherAgendaDispatch({
    ...deps,
  }), receiptStore, deps };
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

  it('replays a completed receipt after the use case is reconstructed', async () => {
    const f = fixture();
    const args = { learnerId: 'kid', dispatchedBy: 'parent', idempotencyKey: 'dispatch-restart' };
    const first = await f.useCase.execute(args);
    const reconstructed = new TeacherAgendaDispatch(f.deps);
    const replay = await reconstructed.execute(args);
    expect(replay).toEqual({ ...first, idempotent: true });
    expect(f.receipts.print).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a prior process left a pending reservation', async () => {
    const f = fixture();
    const args = { learnerId: 'kid', dispatchedBy: 'parent', idempotencyKey: 'dispatch-pending' };
    const fingerprint = stableRecordDigest({ learnerId: 'kid', learnerName: null, dispatchedBy: 'parent' });
    f.receiptStore.records.set(args.idempotencyKey, { fingerprint, status: 'pending' });
    await expect(f.useCase.execute(args)).rejects.toMatchObject({ code: 'IDEMPOTENCY_INDETERMINATE' });
    expect(f.receipts.print).not.toHaveBeenCalled();
  });
});
