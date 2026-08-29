import test from 'node:test';
import assert from 'node:assert/strict';
import { gamingResult, validateGamingResult } from './result.mjs';

test('creates a normalized cross-surface result envelope', () => {
  const result = gamingResult({
    sessionId: 'game:1', experienceId: 'chess', status: 'completed',
    outcome: { kind: 'win', winner_ids: ['learner'] },
    scores: [{ subject_id: 'learner', value: 1 }], durationMs: 42000,
    evidence: { moves: 18 },
  });
  assert.equal(validateGamingResult(result).valid, true);
  assert.equal(result.schema, 'gaming-result/v1');
});

test('rejects invalid score and evidence contracts', () => {
  const validation = validateGamingResult({
    schema: 'gaming-result/v1', session_id: 'game:1', experience_id: 'chess',
    status: 'completed', outcome: { kind: 'win' }, scores: [{ subject_id: 'learner', value: NaN }],
    duration_ms: 1, evidence: [],
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('scores are invalid'));
  assert.ok(validation.errors.includes('evidence must be an object'));
});
