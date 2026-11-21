import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DaylightAPI } from './api.mjs';
import { resolveParamOptions } from './appRegistry.js';

vi.mock('./api.mjs', () => ({
  DaylightAPI: vi.fn(),
  DaylightMediaPath: path => path,
}));

describe('resolveParamOptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes request cancellation to the household options read', async () => {
    DaylightAPI.mockResolvedValue({ users: [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', group_label: 'Bob' },
    ] });
    const controller = new AbortController();

    await expect(resolveParamOptions({ options: 'household' }, { signal: controller.signal })).resolves.toEqual([
      { value: 'alice', label: 'Alice', thumbnail: '/static/img/users/alice' },
      { value: 'bob', label: 'Bob', thumbnail: '/static/img/users/bob' },
    ]);
    expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/gratitude/bootstrap', {}, 'GET', { signal: controller.signal });
  });
});
