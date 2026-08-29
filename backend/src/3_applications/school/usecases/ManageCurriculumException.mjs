import { sha256Text } from '#system/utils/sha256.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const LEARNER_KINDS = new Set(['excused', 'deferred', 'replaced']);
const PAUSE_REASONS = new Set(['defective', 'garbled', 'missing', 'broken', 'inappropriate']);
const TARGETS = new Set(['lesson', 'module']);
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const idFor = (value) => `exc_${sha256Text(JSON.stringify(value)).slice(0, 16)}`;

export class ManageCurriculumException {
  #store; #curriculum; #teacherGate; #clock;
  constructor({ store, curriculum, teacherGate, clock = () => new Date() } = {}) {
    if (!store || !curriculum || !teacherGate) throw new Error('ManageCurriculumException requires store, curriculum and teacherGate');
    this.#store = store; this.#curriculum = curriculum; this.#teacherGate = teacherGate; this.#clock = clock;
  }
  async list() { return { schema: 'school.curriculum-exceptions/v1', active: await this.#store.active(), history: await this.#store.list() }; }
  async execute({ kind, learnerId = null, targetType, targetId, courseId = null, replacementLessonId = null,
    reason, decidedBy, pin, apply = false } = {}) {
    this.#teacherGate.assert({ userId: decidedBy, pin, action: apply ? 'curriculum-exception.apply' : 'curriculum-exception.preview', context: { kind, targetId } });
    if (![...LEARNER_KINDS, 'paused'].includes(kind)) throw new ValidationError('kind must be excused, deferred, replaced, or paused');
    if (!TARGETS.has(targetType) || !text(targetId)) throw new ValidationError('targetType and targetId are required');
    if (!text(reason)) throw new ValidationError('a reason is required');
    if (kind === 'paused') {
      if (learnerId) throw new ValidationError('paused is global and cannot name a learner');
      if (!PAUSE_REASONS.has(reason)) throw new ValidationError(`paused reason must be one of ${[...PAUSE_REASONS].join(', ')}`);
    } else if (!text(learnerId)) throw new ValidationError(`${kind} requires learnerId`);
    if (kind === 'replaced' && !text(replacementLessonId)) throw new ValidationError('replaced requires replacementLessonId');
    const units = await this.#curriculum.listUnits();
    const resolvedLessonIds = targetType === 'lesson'
      ? (units.some((unit) => unit.unitId === targetId) ? [targetId] : [])
      : units.filter((unit) => unit.module === targetId && (!courseId || unit.courseId === courseId)).map((unit) => unit.unitId);
    if (!resolvedLessonIds.length) throw new EntityNotFoundError('curriculum exception target', targetId);
    if (replacementLessonId && !units.some((unit) => unit.unitId === replacementLessonId)) throw new EntityNotFoundError('replacement lesson', replacementLessonId);
    const seed = { kind, learnerId, targetType, targetId, courseId, replacementLessonId, reason, decidedBy, resolvedLessonIds };
    const record = { schema: 'school.curriculum-exception/v1', operation: 'applied', exceptionId: idFor(seed),
      ...seed, decidedAt: this.#clock().toISOString() };
    if (apply) await this.#store.append(record);
    return { schema: 'school.curriculum-exception-preview/v1', applied: apply, exception: record,
      effects: { advancesGate: kind === 'excused' || kind === 'replaced', grantsMastery: false,
        remainsOutstanding: kind === 'deferred', blocksNewWork: kind === 'paused' } };
  }
  async retract({ exceptionId, reason, retractedBy, pin, apply = false } = {}) {
    this.#teacherGate.assert({ userId: retractedBy, pin, action: apply ? 'curriculum-exception.retract' : 'curriculum-exception.retract-preview', context: { exceptionId } });
    if (!text(exceptionId) || !text(reason)) throw new ValidationError('exceptionId and reason are required');
    const target = (await this.#store.active()).find((record) => record.exceptionId === exceptionId);
    if (!target) throw new EntityNotFoundError('active curriculum exception', exceptionId);
    const record = { schema: 'school.curriculum-exception/v1', operation: 'retracted', exceptionId,
      reason: reason.trim(), retractedBy, retractedAt: this.#clock().toISOString() };
    if (apply) await this.#store.append(record);
    return { schema: 'school.curriculum-exception-retraction/v1', applied: apply, retraction: record, previous: target };
  }
}

export default ManageCurriculumException;
