import { describe, it, expect } from 'vitest';
import { TodoistWorkProvider } from './TodoistWorkProvider.mjs';
import { TodoistWorkClient } from './TodoistWorkClient.mjs';
import { resolveWorkPolicy } from './WorkConfig.mjs';
import { AS_OF, todoTask } from '../../../../../tests/_lib/work/observations.mjs';
function setup() {
  const configuration = {
    work: {
      enabled: true,
      write: true,
      writer_env: 'test',
      writer_host: 'test',
      providerWrites: true,
      providers: {
        p: {
          type: 'todoist',
          accountId: 'personal',
          authScope: 'user',
          operations: ['read', 'complete', 'reopen', 'create_task', 'update_task', 'delete_task', 'create_container', 'rename_container', 'archive_container']
        }
      },
      domains: {
        personal: {
          provider: 'p',
          containerId: 'sample-project',
          creationParentId: 'parent-project',
          role: 'tasks',
          autoComplete: 'linked_explicit'
        }
      },
      users: {
        sample: {}
      }
    }
  };
  let task = todoTask({
      due: null
    }),
    projects = new Map([['sample-project', {
      id: 'sample-project',
      name: 'Sample project'
    }], ['parent-project', {
      id: 'parent-project',
      name: 'Parent'
    }]]);
  const requests = [];
  const httpClient = {
    requestRaw: async (method, url, options) => {
      requests.push({
        method,
        url,
        body: options.body
      });
      const parts = new URL(url).pathname.split('/').slice(3),
        [kind, id, action] = parts;
      let data = null,
        status = 200;
      if (method === 'GET') {
        data = kind === 'projects' ? projects.get(id) : task?.id === id ? task : null;
        if (!data) status = 404;
      } else if (kind === 'projects') {
        if (!id) {
          data = {
            id: 'created-project',
            name: options.body.name,
            parent_id: options.body.parent_id
          };
          projects.set(data.id, data);
        } else {
          const p = projects.get(id);
          data = action === 'archive' ? {
            ...p,
            is_archived: true
          } : {
            ...p,
            name: options.body.name
          };
          projects.set(id, data);
        }
      } else if (method === 'DELETE') task = null;else if (!id) {
        task = todoTask({
          id: 'created-task',
          content: options.body.content,
          project_id: options.body.project_id,
          due: null
        });
        data = task;
      } else if (action === 'close') task = {
        ...task,
        checked: !task.due?.is_recurring,
        completed_count: (task.completed_count ?? 0) + 1,
        due: task.due ? {
          ...task.due,
          date: '2026-11-19'
        } : null
      };else if (action === 'reopen') task = {
        ...task,
        checked: false,
        completed_at: null
      };else task = {
        ...task,
        content: options.body.content ?? task.content
      };
      return {
        status,
        ok: status === 200,
        headers: {},
        data: structuredClone(data)
      };
    }
  };
  const policy = () => resolveWorkPolicy({
    configuration,
    username: 'sample',
    timezone: 'America/Los_Angeles'
  });
  const p = new TodoistWorkProvider({
    loadCurrent: async () => ({
      accountId: 'personal',
      observedAt: AS_OF,
      coverage: {
        complete: true,
        from: AS_OF - 86400000,
        to: AS_OF,
        scope: {
          accountId: 'personal',
          containerIds: ['sample-project'],
          assigneeIds: null
        }
      },
      tasks: task ? [task] : [],
      containers: [...projects.values()]
    }),
    loadHistory: async () => ({}),
    resolvePolicy: policy,
    accountId: 'personal',
    client: new TodoistWorkClient({
      httpClient,
      getUserAuth: async () => ({
        api_key: 'test-token'
      }),
      clock: () => AS_OF
    }),
    verifyDispatch: async () => true
  });
  const taskRef = {
    provider: 'todoist',
    accountId: 'personal',
    kind: 'task',
    id: '9007199254740993123'
  };
  async function command(operation, payload = {}, ref = taskRef) {
    const target = operation === 'create_task' ? {
      ...taskRef,
      kind: 'container',
      id: 'sample-project'
    } : operation === 'create_container' ? {
      ...taskRef,
      kind: 'container',
      id: 'parent-project'
    } : ref;
    const item = await p.getItem({
      username: 'sample',
      ref: target,
      asOf: AS_OF
    });
    return {
      id: 'command-1',
      username: 'sample',
      domainId: 'personal',
      operation,
      payload,
      ref: operation.startsWith('create_') ? null : ref,
      expectedVersion: item?.version,
      policyRevision: policy().revision,
      confirmationId: 'confirmed-1',
      sourceReceipt: 'receipt-1',
      createdAt: AS_OF
    };
  }
  return {
    p,
    command,
    requests,
    configuration,
    taskRef,
    setTask: value => {
      task = value;
    }
  };
}
describe('Todoist commands through actual HTTP adapter', () => {
  it.each([['create_task', {
    title: 'New task',
    containerId: 'sample-project'
  }, 'created-task'], ['update_task', {
    title: 'New title'
  }, '9007199254740993123'], ['delete_task', {}, '9007199254740993123']])('executes verified %s', async (operation, payload, id) => {
    const x = setup();
    const r = await x.p.execute({
      username: 'sample',
      command: await x.command(operation, payload),
      asOf: AS_OF
    });
    expect(r).toMatchObject({
      outcome: 'applied',
      ref: {
        id
      }
    });
    expect(x.requests.filter(r => r.method !== 'GET')).toHaveLength(1);
  });
  it.each([['create_container', {
    title: 'New project',
    parentId: 'parent-project'
  }, 'created-project'], ['rename_container', {
    title: 'Renamed'
  }, 'sample-project'], ['archive_container', {}, 'sample-project']])('executes verified %s on explicit project scope', async (operation, payload, id) => {
    const x = setup();
    const r = await x.p.execute({
      username: 'sample',
      command: await x.command(operation, payload, {
        ...x.taskRef,
        kind: 'container',
        id: 'sample-project'
      }),
      asOf: AS_OF
    });
    expect(r).toMatchObject({
      outcome: 'applied',
      ref: {
        id
      },
      item: null
    });
  });
  it('requires explicit project creation parent and cannot mutate the parent project itself', async () => {
    const x = setup();
    delete x.configuration.work.domains.personal.creationParentId;
    const command = await x.command('create_container', {
      title: 'Bad',
      parentId: 'parent-project'
    });
    expect((await x.p.execute({
      username: 'sample',
      command,
      asOf: AS_OF
    })).outcome).toBe('denied');
    expect(x.requests.filter(r => r.method !== 'GET')).toEqual([]);
  });
  it('confirms recurring close from the native count while leaving occurrence emission to exact history', async () => {
    const x = setup();
    x.setTask(todoTask({
      completed_count: 10
    }));
    const result = await x.p.execute({
      username: 'sample',
      command: await x.command('complete'),
      asOf: AS_OF
    });
    expect(result.outcome).toBe('applied');
    expect(result.item.due.date).toBe('2026-11-19');
    expect(result.observation).toBeNull();
  });
  it('refuses stale occurrence version even when title and native status are unchanged', async () => {
    const x = setup();
    x.setTask(todoTask({
      completed_count: 10
    }));
    const command = await x.command('complete');
    x.setTask(todoTask({
      completed_count: 11
    }));
    expect((await x.p.execute({
      username: 'sample',
      command,
      asOf: AS_OF
    })).outcome).toBe('conflict');
    expect(x.requests.filter(r => r.method !== 'GET')).toEqual([]);
  });
  it('reconciles a confirmed update without dispatching another write', async () => {
    const x = setup();
    const command = await x.command('update_task', {
      title: 'Updated'
    });
    await x.p.execute({
      username: 'sample',
      command,
      asOf: AS_OF
    });
    expect((await x.p.reconcile({
      username: 'sample',
      command,
      asOf: AS_OF
    })).outcome).toBe('already_applied');
    expect(x.requests.filter(r => r.method !== 'GET')).toHaveLength(1);
  });
});
it('cannot rename the configured creation parent or a different project', async () => {
  const x = setup();
  const command = await x.command('rename_container', {
    title: 'Bad'
  }, {
    ...x.taskRef,
    kind: 'container',
    id: 'parent-project'
  });
  expect((await x.p.execute({
    username: 'sample',
    command,
    asOf: AS_OF
  })).outcome).toBe('denied');
  expect(x.requests.filter(r => r.method !== 'GET')).toEqual([]);
});
it('cannot reassign a task outside an explicitly configured assignee scope', async () => {
  const x = setup();
  x.configuration.work.domains.personal.assigneeIds = ['owner'];
  x.setTask(todoTask({
    responsible_uid: 'owner',
    due: null
  }));
  const command = await x.command('update_task', {
    assigneeId: 'someone-else'
  });
  expect((await x.p.execute({
    username: 'sample',
    command,
    asOf: AS_OF
  })).outcome).toBe('denied');
  expect(x.requests.filter(r => r.method !== 'GET')).toEqual([]);
});
it('denies a captured command after any routing configuration revision', async () => {
  const x = setup();
  const command = await x.command('update_task', {
    title: 'Changed'
  });
  x.configuration.work.domains.personal.autoComplete = 'never';
  expect((await x.p.execute({
    username: 'sample',
    command,
    asOf: AS_OF
  })).outcome).toBe('denied');
  expect(x.requests.filter(r => r.method !== 'GET')).toEqual([]);
});
it.each([['complete', true], ['reopen', false]])('does not dispatch %s when the requested nonrecurring state is already present', async (operation, checked) => {
  const x = setup();
  x.setTask(todoTask({
    checked,
    due: null
  }));
  expect((await x.p.execute({
    username: 'sample',
    command: await x.command(operation),
    asOf: AS_OF
  })).outcome).toBe('already_applied');
  expect(x.requests.filter(r => r.method !== 'GET')).toEqual([]);
});
it('does not claim creation succeeded as requested when readback omits requested fields',async()=>{const x=setup();const command=await x.command('create_task',{title:'New task',containerId:'sample-project',description:'Requested description',dueDate:'2026-11-20'});expect((await x.p.execute({username:'sample',command,asOf:AS_OF})).outcome).toBe('uncertain');expect(x.requests.filter(r=>r.method!=='GET')).toHaveLength(1);});
