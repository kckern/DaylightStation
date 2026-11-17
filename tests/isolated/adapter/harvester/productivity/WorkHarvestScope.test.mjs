import { describe, it, expect } from 'vitest';
import { TodoistHarvester } from '#adapters/harvester/productivity/TodoistHarvester.mjs';
import { ClickUpHarvester } from '#adapters/harvester/productivity/ClickUpHarvester.mjs';
import { AS_OF, stores, quiet } from '../../../../_lib/work/observations.mjs';
function make(provider, authScope, missing = false) {
  const s = stores(),
    headers = [];
  const httpClient = {
    get: async (url, options) => {
      headers.push(options.headers.Authorization);
      if (provider === 'todoist') return {
        data: url.endsWith('/by_completion_date') ? {
          items: [],
          next_cursor: null
        } : {
          results: [],
          next_cursor: null
        }
      };
      return {
        data: url.endsWith('/space') ? {
          spaces: []
        } : {
          tasks: [],
          last_page: true
        }
      };
    }
  };
  const Harvester = provider === 'todoist' ? TodoistHarvester : ClickUpHarvester;
  return {
    ...s,
    headers,
    harvester: new Harvester({
      ...s,
      httpClient,
      getUserAuth: () => missing && authScope === 'user' ? null : {
        api_key: 'user-fixture',
        workspace_id: 'user-workspace'
      },
      getHouseholdAuth: () => missing && authScope === 'household' ? null : {
        api_key: 'household-fixture',
        workspace_id: 'household-workspace'
      },
      apiKey: 'legacy-fixture',
      workScopeForUser: () => ({
        accountId: 'bound-account',
        containerIds: [],
        assigneeIds: null,
        authScope
      }),
      clock: () => AS_OF,
      logger: quiet
    })
  };
}
describe('configured Work collection authority and health', () => {
  it.each(['todoist', 'clickup'])('%s chooses the configured auth scope without another account fallback', async provider => {
    for (const authScope of ['user', 'household']) {
      const h = make(provider, authScope);
      const result = await h.harvester.harvest('sample');
      expect(result.status).toBe('success');
      expect(h.headers.every(value => value === (provider === 'todoist' ? 'Bearer ' : '') + authScope + '-fixture')).toBe(true);
      const absent = make(provider, authScope, true);
      expect((await absent.harvester.harvest('sample')).status).toBe('error');
      expect(absent.headers).toEqual([]);
    }
  });
  it.each(['todoist', 'clickup'])('%s persists per-user/account latest health while retaining last complete bytes', async provider => {
    const h = make(provider, 'user');
    await h.harvester.harvest('sample');
    const previous = structuredClone(h.current.get('sample:' + provider));
    expect(h.current.get('sample:' + provider + '-health')).toMatchObject({
      schema: 'work-source-health/v1',
      provider,
      accountId: 'bound-account',
      complete: true,
      observedAt: AS_OF
    });
    // A real later provider failure must be visible after reader/process restart.
    const failed = new (provider === 'todoist' ? TodoistHarvester : ClickUpHarvester)({
      ...h,
      httpClient: {
        get: async () => {
          throw new Error('fixture unavailable');
        }
      },
      getUserAuth: () => ({
        api_key: 'user-fixture',
        workspace_id: 'user-workspace'
      }),
      workScopeForUser: () => ({
        accountId: 'bound-account',
        authScope: 'user',
        containerIds: [],
        assigneeIds: null
      }),
      clock: () => AS_OF + 1000,
      logger: quiet
    });
    expect((await failed.harvest('sample')).status).toBe('error');
    expect(h.current.get('sample:' + provider)).toEqual(previous);
    expect(h.current.get('sample:' + provider + '-health')).toMatchObject({
      accountId: 'bound-account',
      complete: false,
      observedAt: AS_OF + 1000
    });
    expect(h.current.get('other:' + provider + '-health')).toBeUndefined();
  });
});
