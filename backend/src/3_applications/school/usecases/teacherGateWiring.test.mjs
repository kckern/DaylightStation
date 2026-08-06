/**
 * The four console writes route their authorization through TeacherGate when
 * one is injected — and behave byte-identically to the legacy GrownUpGate
 * path when it is absent (every pre-console test in the suite is the
 * regression net for the latter; this file pins the former).
 */
import { describe, it, expect, vi } from 'vitest';
import { ResolveReviewItem } from './ResolveReviewItem.mjs';
import { SetAssignments } from './SetAssignments.mjs';
import { CloseAcademicPeriod } from './CloseAcademicPeriod.mjs';
import { PrintService } from '../PrintService.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';

const refusingGate = () => ({
  assert: vi.fn(() => { throw new GuestForbiddenError('The teacher PIN is missing or wrong.'); }),
});
const passingGate = () => ({ assert: vi.fn() });
const grownUps = { assert: vi.fn() };

describe('TeacherGate wiring', () => {
  it('ResolveReviewItem consults the gate with userId+pin+action and stops on refusal', async () => {
    const gate = refusingGate();
    const uc = new ResolveReviewItem({ reviewQueue: { resolve: vi.fn() }, grownUps, teacherGate: gate });
    await expect(uc.execute({ sessionId: 's', itemId: 'i', verdict: 'correct', gradedBy: 'kckern', pin: '9' }))
      .rejects.toThrow(GuestForbiddenError);
    expect(gate.assert).toHaveBeenCalledWith({ userId: 'kckern', pin: '9', action: 'review.resolve' });
    expect(grownUps.assert).not.toHaveBeenCalled();
  });

  it('SetAssignments consults the gate', async () => {
    const gate = passingGate();
    const store = { put: vi.fn(async (r) => r) };
    const uc = new SetAssignments({ assignments: store, grownUps, teacherGate: gate });
    await uc.execute({ learnerId: 'felix', courses: ['math'], units: [], assignedBy: 'kckern', pin: '4321' });
    expect(gate.assert).toHaveBeenCalledWith({ userId: 'kckern', pin: '4321', action: 'assignments.put' });
    expect(store.put).toHaveBeenCalled();
  });

  it('CloseAcademicPeriod consults the gate before generating anything', async () => {
    const gate = refusingGate();
    const getReportCard = { execute: vi.fn() };
    const uc = new CloseAcademicPeriod({ getReportCard, datastore: {}, grownUps, teacherGate: gate });
    await expect(uc.execute({ learnerId: 'felix', periodId: 'p', closedBy: 'kckern', pin: 'x' }))
      .rejects.toThrow(GuestForbiddenError);
    expect(getReportCard.execute).not.toHaveBeenCalled();
  });

  it('PrintService approve/deny consult the gate and stop on refusal', async () => {
    const gate = refusingGate();
    const ds = { readPrintPending: vi.fn(() => []), savePrintPending: vi.fn() };
    const svc = new PrintService({
      config: {}, datastore: ds, printerAdapter: {}, worksheetRenderer: {},
      bankReader: {}, pdfReader: {}, userService: { getHouseholdRoster: () => [] },
      teacherGate: gate,
    });
    await expect(svc.approve({ requestId: 'r', approver: 'kckern', pin: 'x' })).rejects.toThrow(GuestForbiddenError);
    await expect(svc.deny({ requestId: 'r', approver: 'kckern', pin: 'x' })).rejects.toThrow(GuestForbiddenError);
    expect(ds.readPrintPending).not.toHaveBeenCalled();
    expect(gate.assert).toHaveBeenCalledWith({ userId: 'kckern', pin: 'x', action: 'print.approve' });
    expect(gate.assert).toHaveBeenCalledWith({ userId: 'kckern', pin: 'x', action: 'print.deny' });
  });
});
