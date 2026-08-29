import test from 'node:test';
import assert from 'node:assert/strict';
import { createFitnessSchoolCourseOperation } from './fitnessApi.mjs';

test('production fitness-school construction supplies a Date-returning clock function', async () => {
  const records = new Map();
  const service = createFitnessSchoolCourseOperation({
    attemptStore: {
      get: async (id) => records.get(id) ?? null,
      put: async (record) => records.set(record.workSessionId, record),
    },
    sessionService: null,
    logger: { info() {} },
  });
  const record = await service.prepare({
    workSessionId: 'ws-1', learnerId: 'learner', unitId: 'unit',
    activity: { courseRevision: 'c1', policyRevision: 'p1', segments: [], successPolicy: {} },
  });
  assert.match(record.preparedAt, /^\d{4}-\d{2}-\d{2}T/);
});
