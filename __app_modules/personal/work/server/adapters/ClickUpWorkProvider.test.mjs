import { describe, it, expect } from 'vitest';
import { ClickUpWorkProvider } from './ClickUpWorkProvider.mjs';
import { resolveWorkPolicy } from './WorkConfig.mjs';
import { AS_OF, clickTask } from '../../../../../tests/_lib/work/observations.mjs';
const config = {
  work: {
    enabled: true,
    providers: {
      delivery: {
        type: 'clickup',
        accountId: 'delivery',
        authScope: 'household',
        operations: ['read']
      }
    },
    domains: {
      software: {
        provider: 'delivery',
        containerId: 'sample-list',
        role: 'projects',
        autoComplete: 'never',
        assigneeIds: ['123']
      }
    },
    users: {
      sample: {}
    }
  }
};
const policy = username => resolveWorkPolicy({
  configuration: config,
  username,
  timezone: 'America/Los_Angeles'
});
function setup(tasks) {
  return new ClickUpWorkProvider({
    accountId: 'delivery',
    resolvePolicy: policy,
    loadCurrent: async () => ({
      accountId: 'delivery',
      observedAt: AS_OF,
      coverage: {
        complete: true,
        scope: {
          accountId: 'delivery',
          containerIds: ['sample-list'],
          assigneeIds: null
        },
        from: AS_OF - 86400000,
        to: AS_OF,
        reason: null
      },
      tasks
    }),
    loadHistory: async () => ({})
  });
}
describe('read-only scoped ClickUp work projection', () => {
  it('keeps board status and typed hierarchy without activating an old in-progress item', async () => {
    const r = await setup([clickTask()]).readSnapshot({
      username: 'sample',
      asOf: AS_OF
    });
    expect(r.items[0].status).toEqual({
      native: 'in progress',
      category: 'in_progress'
    });
    expect(r.items[0].createdAt).toBe(Date.parse('2021-04-20T11:26:56.521Z'));
    expect(r.items[0].modifiedAt).toBeNull();
    expect(r.items[0].ancestorRefs.map(x => [x.id, x.nativeKind])).toEqual([['sample-space', 'space'], ['sample-folder', 'folder']]);
    expect(Object.hasOwn(r.items[0], 'relevance')).toBe(false);
  });
  it('keeps paused native status and enforces per-domain assignee/container scope', async () => {
    const tasks = [clickTask({
      id: 'paused',
      status: {
        status: 'on hold',
        type: 'custom'
      }
    }), clickTask({
      id: 'someone-else',
      assignees: [{
        id: '456'
      }]
    }), clickTask({
      id: 'other-list',
      list: {
        id: 'other-list',
        name: 'Sample'
      }
    })];
    const r = await setup(tasks).readSnapshot({
      username: 'sample',
      asOf: AS_OF
    });
    expect(r.items.map(x => x.ref.id)).toEqual(['paused']);
    expect(r.items[0].status.category).toBe('paused');
  });
});
import { ClickUpWorkClient } from './ClickUpWorkClient.mjs';
function commands() {
  const configuration = structuredClone(config);
  Object.assign(configuration.work, {
    write: true,
    writer_env: 'test',
    writer_host: 'test',
    providerWrites: true
  });
  configuration.work.providers.delivery.operations = ['read', 'transition', 'complete', 'reopen', 'create_task', 'update_task', 'archive_task', 'delete_task', 'create_container', 'rename_container', 'archive_container'];
  Object.assign(configuration.work.domains.software, {
    creationParentId: 'sample-folder',
    transitions: {
      code_checked_in: 'review',
      complete: 'accepted',
      reopen: 'coding'
    }
  });
  let task = clickTask({
      team_id: 'workspace',
      status: {
        status: 'coding',
        type: 'custom'
      }
    }),
    list = {
      id: 'sample-list',
      name: 'Sample',
      space: {
        id: 'sample-space'
      },
      folder: {
        id: 'sample-folder'
      },
      statuses: [{
        status: 'coding',
        type: 'open'
      }, {
        status: 'review',
        type: 'custom'
      }, {
        status: 'accepted',
        type: 'closed'
      }]
    },
    folder = {
      id: 'sample-folder',
      name: 'Folder',
      space: {
        id: 'sample-space'
      }
    };
  const writes = [];
  let afterWrite = null;
  const httpClient = {
    requestRaw: async (method, url, options) => {
      const pathname = new URL(url).pathname;
      let data,
        status = 200;
      if (method === 'GET') data = pathname.endsWith('/space') ? {
        spaces: [{
          id: 'sample-space'
        }]
      } : pathname.includes('/folder/') ? folder : pathname.includes('/list/') ? list : task;else {
        writes.push({
          method,
          url,
          body: options.body
        });
        if (method === 'DELETE') {
          task = null;
          data = {};
        } else if (pathname.endsWith('/list')) {
          list = {
            ...list,
            id: 'created-list',
            name: options.body.name
          };
          data = list;
        } else if (pathname.includes('/list/') && pathname.endsWith('/task')) {
          task = {
            ...task,
            id: 'created-task',
            name: options.body.name,
            assignees: (options.body.assignees ?? []).map(id => ({
              id: String(id)
            }))
          };
          data = task;
        } else if (pathname.includes('/list/')) {
          list = {
            ...list,
            name: options.body.name
          };
          data = list;
        } else {
          task = {
            ...task,
            name: options.body.name ?? task.name,
            description: options.body.description ?? task.description,
            archived: options.body.archived ?? task.archived,
            status: options.body.status ? list.statuses.find(s => s.status === options.body.status) : task.status,
            date_updated: String(AS_OF)
          };
          if (afterWrite) task = {
            ...task,
            ...afterWrite
          };
          data = task;
        }
      }
      if (data == null) status = 404;
      return {
        ok: status === 200,
        status,
        headers: {},
        data: structuredClone(data)
      };
    }
  };
  const resolvePolicy = () => resolveWorkPolicy({
    configuration,
    username: 'sample',
    timezone: 'America/Los_Angeles'
  });
  const p = new ClickUpWorkProvider({
    accountId: 'delivery',
    resolvePolicy,
    loadCurrent: async () => ({
      accountId: 'delivery',
      observedAt: AS_OF,
      coverage: {
        complete: true,
        scope: {
          accountId: 'delivery',
          containerIds: ['sample-list'],
          assigneeIds: null
        },
        from: AS_OF - 86400000,
        to: AS_OF
      },
      tasks: [task],
      containers: [list]
    }),
    loadHistory: async () => ({}),
    client: new ClickUpWorkClient({
      httpClient,
      getUserAuth: async () => ({
        api_key: 'test',
        workspace_id: 'workspace'
      }),
      getHouseholdAuth: () => null,
      clock: () => AS_OF
    }),
    verifyDispatch: async () => true
  });
  const ref = {
    provider: 'clickup',
    accountId: 'delivery',
    kind: 'task',
    id: 'sample-task'
  };
  const command = async (operation = 'transition', payload = {
    transition: 'code_checked_in'
  }, target = ref) => ({
    id: 'command-1',
    username: 'sample',
    domainId: 'software',
    operation,
    payload,
    ref: operation.startsWith('create_') ? null : target,
    expectedVersion: (await p.getItem({
      username: 'sample',
      ref: operation === 'create_container' ? {
        ...ref,
        kind: 'container',
        id: 'sample-folder'
      } : operation === 'create_task' ? {
        ...ref,
        kind: 'container',
        id: 'sample-list'
      } : target,
      asOf: AS_OF
    }))?.version,
    confirmationId: 'confirmation-1',
    sourceReceipt: 'receipt-1',
    createdAt: AS_OF
  });
  return {
    p,
    command,
    writes,
    configuration,
    setTask: value => {
      task = value;
    },
    setList: value => {
      list = value;
    },
    setAfter: value => {
      afterWrite = value;
    },
    ref
  };
}
describe('ClickUp commands with real HTTP transport', () => {
  it('maps code check-in to live review status, never accepted', async () => {
    const x = commands();
    expect((await x.p.execute({
      username: 'sample',
      command: await x.command(),
      asOf: AS_OF
    })).outcome).toBe('applied');
    expect(x.writes[0].body).toEqual({
      status: 'review'
    });
  });
  it.each(['missing-status', 'missing-list', 'unknown-list', 'stale', 'unknown-workspace', 'custom-fields', 'missing-confirmation'])('does not mutate for %s', async why => {
    const x = commands();
    const command = await x.command();
    if (why === 'missing-status') command.payload.transition = 'unknown';
    if (why === 'missing-list') x.setList(null);
    if (why === 'unknown-list') x.setTask(clickTask({
      team_id: 'workspace',
      list: {
        id: 'other'
      }
    }));
    if (why === 'stale') x.setTask(clickTask({
      team_id: 'workspace',
      name: 'Changed'
    }));
    if (why === 'unknown-workspace') x.setTask(clickTask({
      team_id: 'other'
    }));
    if (why === 'custom-fields') {
      command.operation = 'update_task';
      command.payload = {
        custom_fields: []
      };
    }
    if (why === 'missing-confirmation') command.confirmationId = null;
    expect(['denied', 'conflict']).toContain((await x.p.execute({
      username: 'sample',
      command,
      asOf: AS_OF
    })).outcome);
    expect(x.writes).toEqual([]);
  });
  it('detects an unrequested concurrent provider change during readback', async () => {
    const x = commands();
    const command = await x.command('update_task', {
      title: 'Changed'
    });
    x.setAfter({
      description: 'Concurrent edit'
    });
    expect((await x.p.execute({
      username: 'sample',
      command,
      asOf: AS_OF
    })).outcome).toBe('conflict');
    expect(x.writes).toHaveLength(1);
  });
  it.each([['complete', {}, 'accepted'], ['reopen', {}, 'coding']])('maps %s only through configured status', async (operation, payload, status) => {
    const x = commands();
    if (operation === 'reopen') x.setTask(clickTask({
      team_id: 'workspace',
      status: {
        status: 'accepted',
        type: 'closed'
      }
    }));
    const r = await x.p.execute({
      username: 'sample',
      command: await x.command(operation, payload),
      asOf: AS_OF
    });
    expect(r.outcome).toBe('applied');
    expect(x.writes[0].body).toEqual({
      status
    });
    expect(r.observation).toBeNull();
    expect(r.item.completedAt).toBeNull();
  });
  it.each([['create_task', {
    title: 'Created',
    containerId: 'sample-list',
    assigneeIds: ['123']
  }, 'created-task'], ['archive_task', {}, 'sample-task'], ['delete_task', {}, 'sample-task']])('verifies %s', async (operation, payload, id) => {
    const x = commands();
    expect(await x.p.execute({
      username: 'sample',
      command: await x.command(operation, payload),
      asOf: AS_OF
    })).toMatchObject({
      outcome: 'applied',
      ref: {
        id
      }
    });
  });
  it.each([['create_container', {
    title: 'Created',
    parentId: 'sample-folder'
  }, 'created-list'], ['rename_container', {
    title: 'Renamed'
  }, 'sample-list']])('verifies %s under explicit Folder/List scope', async (operation, payload, id) => {
    const x = commands();
    expect(await x.p.execute({
      username: 'sample',
      command: await x.command(operation, payload, {
        ...x.ref,
        kind: 'container',
        id: 'sample-list'
      }),
      asOf: AS_OF
    })).toMatchObject({
      outcome: 'applied',
      ref: {
        id
      },
      item: null
    });
  });
  it('does not advertise or send undocumented List archive', async () => {
    const x = commands();
    expect(x.p.capabilities({
      username: 'sample'
    }).archive_container).toBe(false);
    expect((await x.p.execute({
      username: 'sample',
      command: await x.command('archive_container', {}, {
        ...x.ref,
        kind: 'container',
        id: 'sample-list'
      }),
      asOf: AS_OF
    })).outcome).toBe('denied');
    expect(x.writes).toEqual([]);
  });
});
it('keeps equal titles in two configured Lists as separate source identities', async () => {
  const configuration = structuredClone(config);
  configuration.work.domains.other = {
    ...configuration.work.domains.software,
    containerId: 'other-list'
  };
  const p = new ClickUpWorkProvider({
    accountId: 'delivery',
    resolvePolicy: username => resolveWorkPolicy({
      configuration,
      username,
      timezone: 'America/Los_Angeles'
    }),
    loadCurrent: async () => ({
      accountId: 'delivery',
      observedAt: AS_OF,
      coverage: {
        complete: true,
        from: AS_OF - 86400000,
        to: AS_OF,
        scope: {
          accountId: 'delivery',
          containerIds: ['sample-list', 'other-list'],
          assigneeIds: null
        }
      },
      tasks: [clickTask(), clickTask({
        id: 'other-task',
        list: {
          id: 'other-list'
        }
      })]
    }),
    loadHistory: async () => ({})
  });
  const r = await p.readSnapshot({
    username: 'sample',
    asOf: AS_OF
  });
  expect(r.items.map(item => item.ref.id)).toEqual(['other-task', 'sample-task']);
  expect(r.items[0].title).toBe(r.items[1].title);
});
