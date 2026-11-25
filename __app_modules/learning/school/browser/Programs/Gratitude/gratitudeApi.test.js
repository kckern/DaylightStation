import { it, expect, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
const log = vi.hoisted(() => ({ apiRejected: vi.fn(), apiFailed: vi.fn() }));
vi.mock('../../runtime/schoolEndpointClient.js', () => ({
  createSchoolEndpointClient: () => ({ request, finish: (r) => r }),
}));
vi.mock('./gratitudeLog.js', () => ({ gratitudeLog: log }));
const { createGratitudeApi } = await import('./gratitudeApi.js');

it('logs the server\'s reason with a rejection', async () => {
  request.mockResolvedValue({ ok: false, status: 409, data: { error: 'Gratitude is not assigned today.' } });
  await createGratitudeApi({ learnerId: 'kid', grant: 'g' }).take('2026-11-25', new Blob(['a']), 't1');
  expect(log.apiRejected).toHaveBeenCalledWith(expect.objectContaining({
    path: '/take', status: 409, error: 'Gratitude is not assigned today.',
  }));
});
