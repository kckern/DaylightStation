import { afterEach, describe, expect, it, vi } from 'vitest';
import { schoolAdminApi } from './schoolAdminApi.js';

afterEach(() => vi.unstubAllGlobals());

describe('schoolAdminApi.putAssignment', () => {
  it('carries the complete program enrollment list across the HTTP boundary', async () => {
    const programs = [{
      programId: 'book-log', subject: 'english',
      obligation: { metric: 'checkins', quantity: 1, per: 'day' },
    }];
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"learnerId":"user_4"}',
    }));
    vi.stubGlobal('fetch', fetch);

    await schoolAdminApi.putAssignment('user_4', {
      courses: ['math'], units: [], programs,
      assignedBy: 'parent', pin: '1234', baseUpdatedAt: '2026-09-03T12:00:00.000Z',
    });

    expect(fetch).toHaveBeenCalledWith('/api/v1/school/lifecycle/assignments/user_4', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courses: ['math'], units: [], programs,
        assignedBy: 'parent', pin: '1234', baseUpdatedAt: '2026-09-03T12:00:00.000Z',
      }),
    });
  });
});
