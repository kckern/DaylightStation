import { beforeEach, describe, expect, it, vi } from 'vitest';

const { record } = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('../../performance/attemptEvidence.js', () => ({
  pianoAttemptClient: { record },
}));

import { createPianoChallengeApi } from './pianoChallengeApi.js';

describe('Piano challenge API', () => {
  beforeEach(() => record.mockReset());

  it('preserves the standard attempt outcome', async () => {
    const outcome = { ok: true, status: 201, data: { attempt_id: 'attempt-1' } };
    record.mockResolvedValue(outcome);
    await expect(createPianoChallengeApi().recordAttempt('kid-1', { status: 'completed' }))
      .resolves.toBe(outcome);
  });

  it('turns a rejected attempt outcome into an error', async () => {
    record.mockResolvedValue({ ok: false, status: 422, error: 'Malformed attempt' });
    await expect(createPianoChallengeApi().recordAttempt('kid-1', {}))
      .rejects.toMatchObject({ message: 'Malformed attempt', status: 422 });
  });
});
