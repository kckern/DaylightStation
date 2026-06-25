import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
import { DaylightAPI } from '../../lib/api.mjs';
import { pollFeedbackTranscript, deleteFeedback } from './feedbackApi.js';

beforeEach(() => { DaylightAPI.mockReset(); });

describe('pollFeedbackTranscript', () => {
  it('resolves the item once transcriptStatus is done', async () => {
    DaylightAPI
      .mockResolvedValueOnce({ id: '1', transcriptStatus: 'pending' })
      .mockResolvedValueOnce({ id: '1', transcriptStatus: 'done', transcript: 'hi there' });
    const item = await pollFeedbackTranscript({ app: 'piano', id: '1', intervalMs: 1, timeoutMs: 1000 });
    expect(item.transcript).toBe('hi there');
    // GET must not carry a body (else DaylightAPI converts to POST)
    expect(DaylightAPI).toHaveBeenLastCalledWith('api/v1/feedback/piano/1');
  });

  it('resolves a timeout marker if it never finishes', async () => {
    DaylightAPI.mockResolvedValue({ id: '1', transcriptStatus: 'pending' });
    const item = await pollFeedbackTranscript({ app: 'piano', id: '1', intervalMs: 1, timeoutMs: 8 });
    expect(item.transcriptStatus).toBe('timeout');
  });
});

describe('deleteFeedback', () => {
  it('issues a DELETE for the item', async () => {
    DaylightAPI.mockResolvedValue({ ok: true, id: '1' });
    await deleteFeedback({ app: 'piano', id: '1' });
    expect(DaylightAPI).toHaveBeenCalledWith('api/v1/feedback/piano/1', {}, 'DELETE');
  });
});
