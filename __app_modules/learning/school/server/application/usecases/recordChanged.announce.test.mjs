// @vitest-environment node
// Teacher and plan changes tell the School tablet which learner's day moved
// (`record-changed`), after the change is stored and only when it was.
import { describe, it, expect, vi } from 'vitest';
import { RecordAttestation } from './RecordAttestation.mjs';
import { RecordEnrichment } from './RecordEnrichment.mjs';
import { RetractTeacherRecord } from './RetractTeacherRecord.mjs';
import { SetPassOverride } from './SetPassOverride.mjs';
import { ManageCurriculumException } from './ManageCurriculumException.mjs';
import { ReassignEvidence } from './ReassignEvidence.mjs';
import { MarkSessionAbandoned } from './MarkSessionAbandoned.mjs';

const gate = { assert: vi.fn() };
const refusing = { assert: () => { throw new Error('Only a listed teacher can do this.'); } };
const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const realtime = () => ({ recordChanged: vi.fn() });
const clock = () => new Date('2026-11-13T18:00:00Z');

describe('record-changed announcements', () => {
  it('an attestation names its learner', async () => {
    const rt = realtime();
    await new RecordAttestation({ log: { append: vi.fn() }, teacherGate: gate, clock, realtime: rt })
      .execute({ learnerId: 'learner_a', unitId: 'u1', reason: 'done on paper', attestedBy: 'teacher' });
    expect(rt.recordChanged).toHaveBeenCalledWith(expect.objectContaining({ learnerIds: ['learner_a'], kind: 'attestation' }));
  });

  it('a refused attestation says nothing', async () => {
    const rt = realtime();
    await expect(new RecordAttestation({ log: { append: vi.fn() }, teacherGate: refusing, clock, realtime: rt })
      .execute({ learnerId: 'learner_a', unitId: 'u1', reason: 'r', attestedBy: 'kid' })).rejects.toThrow();
    expect(rt.recordChanged).not.toHaveBeenCalled();
  });

  it('an enrichment names every learner it covers', async () => {
    const rt = realtime();
    await new RecordEnrichment({ log: { append: vi.fn() }, teacherGate: gate, clock, logger: logger(), realtime: rt })
      .execute({ recordedBy: 'teacher', learnerIds: ['learner_a', 'learner_b'], from: '2026-11-13', title: 'Museum' });
    expect(rt.recordChanged).toHaveBeenCalledWith(expect.objectContaining({ learnerIds: ['learner_a', 'learner_b'], kind: 'enrichment' }));
  });

  it('a retraction names the learner of the retracted entry', async () => {
    const rt = realtime();
    const store = { list: () => [{ id: 'att_1', learnerId: 'learner_a', unitId: 'u1' }], retract: vi.fn() };
    await new RetractTeacherRecord({ stores: { attestation: store }, teacherGate: gate, clock, logger: logger(), realtime: rt })
      .execute({ kind: 'attestation', entryId: 'att_1', retractedBy: 'teacher' });
    expect(rt.recordChanged).toHaveBeenCalledWith(expect.objectContaining({ learnerIds: ['learner_a'], kind: 'retract' }));
  });

  it('a pass-mark change is household-wide', async () => {
    const rt = realtime();
    await new SetPassOverride({ store: { set: vi.fn() }, teacherGate: gate, clock, logger: logger(), realtime: rt })
      .execute({ unitId: 'u1', percent: 70, editedBy: 'teacher' });
    expect(rt.recordChanged).toHaveBeenCalledWith(expect.objectContaining({ learnerIds: [], kind: 'pass-override' }));
  });

  it('a curriculum exception announces only when applied, naming its learner', async () => {
    const rt = realtime();
    const exceptions = new ManageCurriculumException({
      store: { append: vi.fn(), active: async () => [], list: async () => [] },
      curriculum: { listUnits: async () => [{ unitId: 'u1', module: 'm1', courseId: 'c1' }] },
      teacherGate: gate, clock, realtime: rt,
    });
    const args = { kind: 'excused', learnerId: 'learner_a', targetType: 'lesson', targetId: 'u1', reason: 'r', decidedBy: 'teacher' };
    await exceptions.execute(args);
    expect(rt.recordChanged).not.toHaveBeenCalled();
    await exceptions.execute({ ...args, apply: true });
    expect(rt.recordChanged).toHaveBeenCalledWith(expect.objectContaining({ learnerIds: ['learner_a'], kind: 'curriculum-exception' }));
  });

  it('reassigned evidence names both learners', async () => {
    const rt = realtime();
    await new ReassignEvidence({ datastore: { moveAttempts: () => 2 }, teacherGate: gate, clock, logger: logger(), realtime: rt })
      .execute({ fromLearnerId: 'learner_a', toLearnerId: 'learner_b', day: '2026-11-13', assessmentId: 'q1', reassignedBy: 'teacher' });
    expect(rt.recordChanged).toHaveBeenCalledWith(expect.objectContaining({ learnerIds: ['learner_a', 'learner_b'], kind: 'reassign', studyDay: '2026-11-13' }));
  });

  it('an abandoned session names its learner', async () => {
    const rt = realtime();
    const sessions = {
      listForLearner: async () => [{ sessionId: 's1', state: 'issued', terminal: false, unitId: 'u1' }],
      appendEvent: vi.fn(),
    };
    await new MarkSessionAbandoned({ sessions, teacherGate: gate, clock, logger: logger(), realtime: rt })
      .execute({ sessionId: 's1', learnerId: 'learner_a', reason: 'lost', decidedBy: 'teacher' });
    expect(rt.recordChanged).toHaveBeenCalledWith(expect.objectContaining({ learnerIds: ['learner_a'], kind: 'abandon' }));
  });

  it('a broken announcement never fails the change', async () => {
    const rt = { recordChanged: vi.fn(() => { throw new Error('bus down'); }) };
    const log = logger();
    await expect(new SetPassOverride({ store: { set: vi.fn() }, teacherGate: gate, clock, logger: log, realtime: rt })
      .execute({ unitId: 'u1', percent: 70, editedBy: 'teacher' })).resolves.toEqual({ unitId: 'u1', percent: 70 });
    expect(log.warn).toHaveBeenCalledWith('school.record.broadcast-failed', expect.objectContaining({ kind: 'pass-override' }));
  });
});
