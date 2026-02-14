// backend/tests/unit/agents/health-coach/dashboard-schema.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Ajv from 'ajv';
import { dashboardSchema } from '../../../../src/3_applications/agents/health-coach/schemas/dashboard.mjs';

const ajv = new Ajv({ allErrors: true });

describe('Dashboard Schema', () => {
  it('should be a valid JSON Schema', () => {
    const validate = ajv.compile(dashboardSchema);
    assert.ok(validate, 'Schema should compile without errors');
  });

  it('should accept a valid full dashboard', () => {
    const validate = ajv.compile(dashboardSchema);
    const valid = validate({
      generated_at: '2026-02-14T04:12:00Z',
      curated: {
        up_next: {
          primary: {
            content_id: 'plex:12345',
            title: 'P90X - Day 23: Shoulders & Arms',
            duration: 60,
            program_context: 'P90X Week 4, Day 2',
          },
          alternates: [
            { content_id: 'plex:12399', title: 'Yoga X', duration: 92, reason: 'rest_day_option' },
          ],
        },
        playlist_suggestion: [
          { content_id: 'plex:99001', title: '5-Min Warm-Up', duration: 5 },
          { content_id: 'plex:12345', title: 'Shoulders & Arms', duration: 60 },
        ],
      },
      coach: {
        briefing: 'Down 1.2 lbs this week.',
        cta: [
          { type: 'data_gap', message: 'No meals logged yesterday.', action: 'open_nutrition' },
        ],
        prompts: [
          { type: 'multiple_choice', question: 'Ready for today?', options: ['Yes', 'Something lighter', 'Rest'] },
        ],
      },
    });

    assert.strictEqual(valid, true, `Validation errors: ${JSON.stringify(validate.errors)}`);
  });

  it('should accept a minimal dashboard (no alternates, no playlist, no prompts)', () => {
    const validate = ajv.compile(dashboardSchema);
    const valid = validate({
      generated_at: '2026-02-14T04:12:00Z',
      curated: {
        up_next: {
          primary: { content_id: 'plex:123', title: 'Workout', duration: 30 },
        },
      },
      coach: {
        briefing: 'Good morning.',
      },
    });

    assert.strictEqual(valid, true, `Validation errors: ${JSON.stringify(validate.errors)}`);
  });

  it('should reject missing required fields', () => {
    const validate = ajv.compile(dashboardSchema);

    assert.strictEqual(validate({}), false, 'Empty object should fail');
    assert.strictEqual(validate({ generated_at: 'x', curated: {} }), false, 'Missing coach should fail');
    assert.strictEqual(
      validate({ generated_at: 'x', curated: { up_next: { primary: {} } }, coach: { briefing: 'hi' } }),
      false,
      'Primary missing content_id should fail'
    );
  });

  it('should reject invalid CTA types', () => {
    const validate = ajv.compile(dashboardSchema);
    const valid = validate({
      generated_at: 'x',
      curated: { up_next: { primary: { content_id: 'a', title: 'b', duration: 1 } } },
      coach: {
        briefing: 'hi',
        cta: [{ type: 'invalid_type', message: 'test' }],
      },
    });

    assert.strictEqual(valid, false, 'Invalid CTA type should fail');
  });
});
