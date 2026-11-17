import { describe, it, expect, vi } from 'vitest';
import { TodoistWorkClient } from './TodoistWorkClient.mjs';
const ref = {
  provider: 'todoist',
  accountId: 'personal',
  kind: 'task',
  id: '9007199254740993123'
};
function setup(response = {
  status: 200,
  ok: true,
  data: {},
  headers: {}
}) {
  const httpClient = {
    requestRaw: vi.fn(async () => response)
  };
  const getUserAuth = vi.fn(async () => ({
    api_key: 'test-token'
  }));
  return {
    httpClient,
    getUserAuth,
    client: new TodoistWorkClient({
      httpClient,
      getUserAuth,
      clock: () => 1000
    })
  };
}
describe('Todoist v1 transport', () => {
  it.each([['complete', 'POST', '/tasks/9007199254740993123/close'], ['reopen', 'POST', '/tasks/9007199254740993123/reopen'], ['delete_task', 'DELETE', '/tasks/9007199254740993123'], ['update_task', 'POST', '/tasks/9007199254740993123']])('routes %s with opaque IDs', async (operation, method, path) => {
    const x = setup();
    await x.client.request({
      username: 'sample',
      operation,
      ref,
      payload: operation === 'update_task' ? {
        title: 'Updated'
      } : {}
    });
    expect(x.httpClient.requestRaw).toHaveBeenCalledWith(method, `https://api.todoist.com/api/v1${path}`, expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer test-token'
      })
    }));
    expect(x.getUserAuth).toHaveBeenCalledWith('todoist', 'sample');
  });
  it.each([['create_container', 'POST', '/projects', {
    title: 'New',
    parentId: 'parent'
  }], ['rename_container', 'POST', '/projects/project', {
    title: 'Renamed'
  }], ['archive_container', 'POST', '/projects/project/archive', {}]])('routes %s to projects', async (operation, method, path, payload) => {
    const x = setup();
    await x.client.request({
      username: 'sample',
      operation,
      ref: {
        ...ref,
        kind: 'container',
        id: 'project'
      },
      payload
    });
    expect(x.httpClient.requestRaw).toHaveBeenCalledWith(method, `https://api.todoist.com/api/v1${path}`, expect.any(Object));
  });
  it('maps canonical create payload without sending authority or credential fields', async () => {
    const x = setup();
    await x.client.request({
      username: 'sample',
      operation: 'create_task',
      ref: null,
      payload: {
        title: 'Pay bill',
        containerId: 'project',
        dueDate: '2026-11-18'
      }
    });
    expect(x.httpClient.requestRaw.mock.calls[0][2].body).toEqual({
      content: 'Pay bill',
      project_id: 'project',
      due_date: '2026-11-18'
    });
  });
  it('rejects unsupported operations and malformed refs before auth/HTTP', async () => {
    const x = setup();
    for (const input of [{
      operation: 'archive_task',
      ref
    }, {
      operation: 'complete',
      ref: {
        ...ref,
        id: 123
      }
    }, {
      operation: 'complete',
      ref: {
        ...ref,
        kind: 'container'
      }
    }, {
      operation: 'update_task',
      ref,
      payload: {
        token: 'leak'
      }
    }]) await expect(x.client.request({
      username: 'sample',
      ...input
    })).rejects.toThrow();
    expect(x.httpClient.requestRaw).not.toHaveBeenCalled();
    expect(x.getUserAuth).not.toHaveBeenCalled();
  });
  it('preserves HTTP classification and never retries network uncertainty', async () => {
    const x = setup({
      status: 429,
      ok: false,
      data: null,
      headers: {
        'retry-after': '30'
      }
    });
    expect(await x.client.request({
      username: 'sample',
      operation: 'complete',
      ref
    })).toMatchObject({
      status: 429,
      retryAfter: 31000
    });
    x.httpClient.requestRaw.mockRejectedValue(new Error('timeout'));
    await expect(x.client.request({
      username: 'sample',
      operation: 'complete',
      ref
    })).rejects.toThrow('timeout');
    expect(x.httpClient.requestRaw).toHaveBeenCalledTimes(2);
  });
});
