import { describe, it, expect, vi } from 'vitest';
import { ClickUpWorkClient } from './ClickUpWorkClient.mjs';
const ref = {
  provider: 'clickup',
  accountId: 'delivery',
  kind: 'task',
  id: '9007199254740993123'
};
function setup() {
  const requests = [];
  const httpClient = {
    requestRaw: vi.fn(async (method, url, options) => {
      requests.push({
        method,
        url,
        body: options.body
      });
      return {
        status: 200,
        ok: true,
        headers: {},
        data: method === 'GET' ? {
          id: ref.id,
          team_id: 'workspace',
          list: {
            id: 'sample-list'
          }
        } : {}
      };
    })
  };
  const getHouseholdAuth = vi.fn(() => ({
    api_key: 'wrong-account',
    workspace_id: 'wrong'
  }));
  return {
    requests,
    httpClient,
    getHouseholdAuth,
    client: new ClickUpWorkClient({
      httpClient,
      getUserAuth: async () => ({
        api_key: 'key',
        workspace_id: 'workspace'
      }),
      getHouseholdAuth,
      clock: () => 1000
    })
  };
}
describe('ClickUp command transport', () => {
  it.each([['transition', 'PUT', '/task/9007199254740993123', {
    status: 'review'
  }], ['update_task', 'PUT', '/task/9007199254740993123', {
    title: 'Updated'
  }], ['archive_task', 'PUT', '/task/9007199254740993123', {}], ['delete_task', 'DELETE', '/task/9007199254740993123', {}], ['create_task', 'POST', '/list/sample-list/task', {
    title: 'New',
    containerId: 'sample-list'
  }], ['create_container', 'POST', '/folder/sample-folder/list', {
    title: 'New list',
    parentId: 'sample-folder'
  }], ['rename_container', 'PUT', '/list/sample-list', {
    title: 'New name'
  }]])('routes %s through documented native endpoint', async (operation, method, path, payload) => {
    const x = setup();
    await x.client.request({
      username: 'sample',
      operation,
      ref: operation.startsWith('create_') ? null : operation === 'rename_container' ? {
        ...ref,
        kind: 'container',
        id: 'sample-list'
      } : ref,
      payload
    });
    expect(x.requests[0]).toMatchObject({
      method,
      url: `https://api.clickup.com/api/v2${path}`
    });
    if (operation === 'archive_task') expect(x.requests[0].body).toEqual({
      archived: true
    });
    if (operation === 'transition') expect(x.requests[0].body).toEqual({
      status: 'review'
    });
  });
  it('rejects custom fields and unsupported List archive before HTTP', async () => {
    const x = setup();
    for (const input of [{
      operation: 'update_task',
      payload: {
        custom_fields: []
      }
    }, {
      operation: 'archive_container',
      ref: {
        ...ref,
        kind: 'container'
      }
    }]) await expect(x.client.request({
      username: 'sample',
      ref,
      ...input
    })).rejects.toThrow();
    expect(x.requests).toEqual([]);
  });
  it('rejects a task in another workspace and never falls back to household auth', async () => {
    const x = setup();
    x.httpClient.requestRaw.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: ref.id,
        team_id: 'wrong'
      }
    });
    await expect(x.client.request({
      username: 'sample',
      operation: 'read',
      ref
    })).rejects.toThrow('CLICKUP_WORKSPACE_MISMATCH');
    expect(x.getHouseholdAuth).not.toHaveBeenCalled();
  });
  it('verifies a List space belongs to the selected workspace', async () => {
    const x = setup();
    x.httpClient.requestRaw.mockImplementation(async (_method, url) => ({
      ok: true,
      status: 200,
      headers: {},
      data: url.endsWith('/space') ? {
        spaces: [{
          id: 'space'
        }]
      } : {
        id: 'sample-list',
        space: {
          id: 'space'
        }
      }
    }));
    expect(await x.client.request({
      username: 'sample',
      operation: 'read',
      ref: {
        ...ref,
        kind: 'container',
        id: 'sample-list'
      }
    })).toMatchObject({
      ok: true,
      data: {
        id: 'sample-list'
      }
    });
    expect(x.httpClient.requestRaw.mock.calls[1][1]).toBe('https://api.clickup.com/api/v2/team/workspace/space');
  });
});
