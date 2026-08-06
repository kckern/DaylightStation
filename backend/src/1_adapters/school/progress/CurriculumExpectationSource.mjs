import { ILearningExpectationSource } from '#apps/school/ports/ILearningExpectationSource.mjs';
import { validateLearningExpectation } from '#domains/school/progress/index.mjs';

const FAR_FUTURE_DUE_AT = '9999-12-31T00:00:00.000Z';
const ID_UNSAFE = /[^a-z0-9-]+/g;

/** Slugify into the `^[a-z0-9][a-z0-9-]{0,63}$` shape validateLearningExpectation requires. */
function toExpectationId(text) {
  const slug = String(text).toLowerCase().replace(ID_UNSAFE, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 64).replace(/-+$/g, '');
}

/**
 * Derives the authored outline directly from the curriculum catalog itself:
 * one expectation per cataloged unit, targeting that unit, ordered by the
 * unit's own authored `sequence` within its course. This is what lets
 * `curriculumHistory` (Task 11) finally annotate a unit's tree node with "an
 * outline exists for you" instead of only ever describing evidence that
 * already happened.
 *
 * A unit with no `courseId` is not part of any course's outline and is
 * skipped — this source names an outline only where the catalog actually
 * authored a course/unit relationship, never invents one. A course that
 * never appears in `curriculum.listUnits()` (i.e. not cataloged) simply never
 * produces an expectation — the honesty rule `buildCurriculumHistory` already
 * enforces stays intact; this source can only ever narrow that gap, never
 * paper over it.
 *
 * Unlike `ConfiguredLearningExpectationSource` (whose expectations are fixed
 * at construction and merely filtered by scope at query time),
 * `CurriculumExpectationSource` has no natural single scope of its own — a
 * course outline is equally true for a household dashboard or one learner's
 * report card — so it answers at WHATEVER scope the caller asks for. Its
 * scope-matching is therefore a no-op on purpose, not an oversight.
 *
 * The curriculum's units carry no due dates. `dueAt` is synthesized so an
 * outline item never accidentally falls outside a query's `[from, to)`
 * window: it lands one millisecond before `to` (still within a bounded
 * window like a report-card period), or effectively "no deadline" when the
 * caller leaves the window open.
 */
export class CurriculumExpectationSource extends ILearningExpectationSource {
  #curriculum; #expectedCompletedPercent;

  constructor({ curriculum, expectedCompletedPercent = 100 } = {}) {
    super();
    if (!curriculum) throw new Error('CurriculumExpectationSource requires a curriculum accessor');
    if (!Number.isInteger(expectedCompletedPercent)
        || expectedCompletedPercent < 1 || expectedCompletedPercent > 100) {
      throw new Error('CurriculumExpectationSource expectedCompletedPercent must be an integer from 1 to 100');
    }
    this.#curriculum = curriculum;
    this.#expectedCompletedPercent = expectedCompletedPercent;
  }

  async listExpectations({ scope, from = null, to = null } = {}) {
    const units = await this.#curriculum.listUnits();
    const byCourse = new Map();
    for (const unit of units ?? []) {
      if (!unit?.courseId || !unit?.unitId) continue;
      const list = byCourse.get(unit.courseId) ?? [];
      list.push(unit);
      byCourse.set(unit.courseId, list);
    }

    const dueAt = this.#dueAt(to);
    const seenIds = new Set();
    const expectations = [];
    for (const [courseId, courseUnits] of [...byCourse.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const ordered = [...courseUnits].sort((left, right) => (
        (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
        || String(left.unitId).localeCompare(String(right.unitId))
      ));
      ordered.forEach((unit) => {
        let expectationId = toExpectationId(`outline-${courseId}-${unit.unitId}`) || `outline-${expectations.length}`;
        while (seenIds.has(expectationId)) expectationId = `${expectationId.slice(0, 60)}-${expectations.length}`;
        seenIds.add(expectationId);

        const result = validateLearningExpectation({
          schema: 'school.learning-expectation/v1',
          expectationId,
          scopeType: scope?.type ?? 'household',
          scopeId: scope?.id ?? 'household',
          target: { kind: 'unit', id: unit.unitId },
          dueAt,
          expectedCompletedPercent: this.#expectedCompletedPercent,
        }, { path: `curriculum-outline[${courseId}/${unit.unitId}]` });
        if (result.errors.length) throw new Error(result.errors.join('; '));
        expectations.push(result.expectation);
      });
    }

    return expectations.filter((entry) => (
      (from === null || entry.dueAt >= from) && (to === null || entry.dueAt < to)
    ));
  }

  #dueAt(to) {
    if (!to) return FAR_FUTURE_DUE_AT;
    const beforeTo = Date.parse(to) - 1;
    return Number.isFinite(beforeTo) ? new Date(beforeTo).toISOString() : FAR_FUTURE_DUE_AT;
  }
}

export default CurriculumExpectationSource;
