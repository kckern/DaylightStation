import { describe, it, expect } from 'vitest';
import { goalSaveMessage } from './goalSaveError.js';

const apiError = (status, body) => new Error(`HTTP ${status}: Bad Request - ${JSON.stringify(body)}`);

describe('goalSaveMessage', () => {
  it('turns a GOALS_INVALID refusal into a sentence, with no JSON and no code', () => {
    const msg = goalSaveMessage(apiError(400, {
      error: "GOALS_INVALID: watchMicros.sodium.direction must be one of ceiling, floor",
      code: 'GOALS_INVALID',
    }));
    expect(msg).toBe("Those goals weren't saved — watchMicros.sodium.direction must be one of ceiling, floor.");
    expect(msg).not.toMatch(/[{}]/);
    expect(msg).not.toMatch(/GOALS_INVALID/);
    expect(msg).not.toMatch(/HTTP 400/);
  });

  it('unwraps a non-goals coded error to its explanation', () => {
    expect(goalSaveMessage(apiError(500, { error: 'GOALS_WRITE_FAILED: could not write goals', code: 'GOALS_WRITE_FAILED' })))
      .toBe('could not write goals');
  });

  it('keeps an uncoded server message intact', () => {
    expect(goalSaveMessage(apiError(500, { error: 'something broke' }))).toBe('something broke');
  });

  it('falls back to the raw message when the body is not JSON', () => {
    expect(goalSaveMessage(new Error('NetworkError: failed to fetch'))).toBe('NetworkError: failed to fetch');
  });

  it('falls back to the raw message when the body is malformed JSON', () => {
    expect(goalSaveMessage(new Error('HTTP 400: Bad Request - {not json'))).toBe('HTTP 400: Bad Request - {not json');
  });

  it('never renders empty', () => {
    expect(goalSaveMessage(undefined)).toBe('Something went wrong saving your goals.');
    expect(goalSaveMessage(new Error(''))).toBe('Something went wrong saving your goals.');
  });
});
