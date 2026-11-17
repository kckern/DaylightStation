import { describe, it, expect, afterEach, vi } from 'vitest';
import { WorkCommands } from './WorkCommands.mjs';
import { harness, item, ref, commit } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
async function setup() {
  const h = harness();
  resources.push(h);
  const store = h.make();
  const principal = Object.freeze({
    username: 'sample',
    authored: true,
    kind: 'text',
    receiptId: 'receipt-1',
    receivedAt: AS_OF,
    edited: false
  });
  const policy = {
    enabled: true,
    providerWrites: true,
    revision: 'policy-1',
    writer: {
      write: true
    },
    limits: {
      snapshotMaxAgeHours: 24
    },
    providers: {
      p: {
        type: 'todoist',
        accountId: 'personal',
        operations: ['read', 'complete', 'create_task']
      }
    },
    domains: {
      personal: {
        provider: 'p',
        containerId: 'sample-project',
        role: 'tasks',
        autoComplete: 'linked_explicit'
      }
    }
  };
  const link = {
    id: 'link.' + 'a'.repeat(64),
    username: 'sample',
    kbObjectId: 'loop.sample',
    workRef: ref,
    relation: 'same_commitment',
    basisRefs: ['journal:1'],
    confirmedAt: AS_OF
  };
  await commit(store, 'link', [{
    type: 'link.confirmed',
    link
  }]);
  const context = {
    execute: async () => ({
      items: [item()],
      containers: [],
      links: [link],
      coverage: {
        complete: true
      }
    }),
    verifySource: async () => true
  };
  let service;
  const event = {
    id: 'provider-event',
    username: 'sample',
    ref,
    type: 'completed',
    occurredAt: AS_OF,
    observedAt: AS_OF,
    providerVersion: 'done-v2',
    occurrenceId: String(AS_OF),
    origin: 'provider',
    causationId: null,
    sourceRefs: ['provider:completed'],
    occurredAtEstimated: false,
    containerRef: item().containerRef,
    assigneeIds: [],
    actorId: null
  };
  const provider = {
    capabilities: () => ({
      read: true,
      complete: true,
      create_task: true
    }),
    getItem: async ({
      ref: target
    }) => target.kind === 'container' ? {
      ref: target,
      title: 'Sample',
      version: 'container-v1'
    } : item(),
    execute: vi.fn(async ({
      command
    }) => {
      expect(await service.verifyDispatch({
        username: 'sample',
        command,
        asOf: AS_OF
      })).toBe(true);
      return {
        outcome: 'applied',
        ref,
        item: item({
          status: {
            native: 'done',
            category: 'done'
          },
          completedAt: AS_OF,
          version: 'done-v2'
        }),
        observation: event,
        reason: null,
        retryAfter: null
      };
    }),
    reconcile: vi.fn(async () => ({
      outcome: 'already_applied',
      ref,
      item: item({
        status: {
          native: 'done',
          category: 'done'
        },
        completedAt: AS_OF,
        version: 'done-v2'
      }),
      observation: event,
      reason: null,
      retryAfter: null
    }))
  };
  const providers = new Map([['["todoist","personal"]', provider]]);
  const verifyPrincipal = value => value === principal ? principal : null;
  const state = {
    read: input => store.read(input),
    transact: input => store.transact(input)
  };
  const make = () => new WorkCommands({
    state,
    providers,
    context,
    resolvePolicy: () => policy,
    verifyPrincipal,
    clock: () => AS_OF
  });
  service = make();
  const intent = {
    domainId: 'personal',
    operation: 'complete',
    ref,
    payload: {},
    sourceReceipt: 'receipt-1',
    statement: 'I finished Contact Sample',
    mode: 'auto'
  };
  return {
    h,
    store,
    state,
    service,
    make,
    provider,
    context,
    policy,
    principal,
    intent,
    event
  };
}
describe('durable Work execution', () => {
  it('reserves before dispatch, commits result and one observation, and deduplicates repeat execution', async () => {
    const x = await setup();
    const a = await x.service.propose({
      principal: x.principal,
      intent: x.intent,
      asOf: AS_OF
    });
    const b = await x.service.propose({
      principal: x.principal,
      intent: x.intent,
      asOf: AS_OF
    });
    expect(a.command.id).toBe(b.command.id);
    expect((await x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    })).outcome).toBe('applied');
    expect((await x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    })).outcome).toBe('applied');
    expect(x.provider.execute).toHaveBeenCalledTimes(1);
    const state = await x.store.read({
      username: 'sample'
    });
    expect(Object.values(state.activities)).toHaveLength(1);
    expect(state.commands[a.command.id].status).toBe('applied');
  });
  it('dispatches concurrent duplicate taps once', async () => {
    const x = await setup();
    const a = await x.service.propose({
      principal: x.principal,
      intent: x.intent,
      asOf: AS_OF
    });
    await Promise.all([x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    }), x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    })]);
    expect(x.provider.execute).toHaveBeenCalledTimes(1);
  });
  it('quarantines a lost result save and reconciles after restart without repeating the provider write', async () => {
    const x = await setup();
    const a = await x.service.propose({
      principal: x.principal,
      intent: x.intent,
      asOf: AS_OF
    });
    const write = x.state.transact;
    x.state.transact = async input => {
      if (input.events.some(e => e.type === 'command.finished')) throw new Error('lost result');
      return write(input);
    };
    expect((await x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    })).outcome).toBe('uncertain');
    x.state.transact = write;
    const restarted = x.make();
    expect((await restarted.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    })).outcome).toBe('uncertain');
    expect((await restarted.reconcile({
      username: 'sample',
      commandId: a.command.id,
      asOf: AS_OF
    })).outcome).toBe('already_applied');
    expect(x.provider.execute).toHaveBeenCalledTimes(1);
    expect(Object.keys((await x.store.read({
      username: 'sample'
    })).activities)).toHaveLength(1);
  });
  it('leaves a definitely unreserved command queued for a safe later dispatch', async () => {
    const x = await setup();
    const a = await x.service.propose({
      principal: x.principal,
      intent: x.intent,
      asOf: AS_OF
    });
    const write = x.state.transact;
    x.state.transact = async input => {
      if (input.events.some(e => e.type === 'command.dispatched')) throw new Error('before append');
      return write(input);
    };
    await x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    });
    expect(x.provider.execute).not.toHaveBeenCalled();
    x.state.transact = write;
    expect((await x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    })).outcome).toBe('applied');
  });
  it('denies serialized principals, revoked routes and invalid current source', async () => {
    const x = await setup();
    await expect(x.service.propose({
      principal: {
        ...x.principal
      },
      intent: x.intent,
      asOf: AS_OF
    })).rejects.toThrow();
    const a = await x.service.propose({
      principal: x.principal,
      intent: x.intent,
      asOf: AS_OF
    });
    x.policy.providerWrites = false;
    expect((await x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    })).outcome).toBe('denied');
    expect(x.provider.execute).not.toHaveBeenCalled();
  });
  it('requires a trusted bound confirmation for creation, never a caller-provided string', async () => {
    const x = await setup();
    x.context.execute = async () => ({
      items: [],
      containers: [{
        ref: {
          ...ref,
          kind: 'container',
          id: 'sample-project'
        },
        title: 'Sample',
        version: 'container-v1'
      }],
      links: [],
      coverage: {
        complete: true
      }
    });
    const a = await x.service.propose({
      principal: x.principal,
      intent: {
        ...x.intent,
        ref: null,
        operation: 'create_task',
        payload: {
          title: 'New',
          containerId: 'sample-project'
        },
        mode: 'manual'
      },
      asOf: AS_OF
    });
    expect(a.requiresConfirmation).toBe(true);
    expect((await x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      confirmationId: 'invented',
      asOf: AS_OF
    })).outcome).toBe('denied');
    expect(x.provider.execute).not.toHaveBeenCalled();
  });
  it('rechecks source validity after proposal and before dispatch', async () => {
    const x = await setup();
    const a = await x.service.propose({
      principal: x.principal,
      intent: x.intent,
      asOf: AS_OF
    });
    x.context.verifySource = async () => false;
    expect((await x.service.execute({
      principal: x.principal,
      commandId: a.command.id,
      asOf: AS_OF
    })).outcome).toBe('denied');
    expect(x.provider.execute).not.toHaveBeenCalled();
  });
});
it('keeps an unknown create quarantined even with an equal-title current task', async () => {
  const x = await setup();
  x.context.execute = async () => ({
    items: [item({
      title: 'New'
    })],
    containers: [{
      ref: {
        ...ref,
        kind: 'container',
        id: 'sample-project'
      },
      title: 'Sample',
      version: 'container-v1'
    }],
    links: [],
    coverage: {
      complete: true
    }
  });
  x.context.verifyConfirmation = async ({
    command,
    confirmationId,
    principal
  }) => principal === x.principal && command.operation === 'create_task' && confirmationId === 'bound-create';
  x.provider.execute.mockResolvedValue({
    outcome: 'uncertain',
    ref: null,
    item: null,
    observation: null,
    reason: 'timeout',
    retryAfter: null
  });
  x.provider.reconcile.mockResolvedValue({
    outcome: 'uncertain',
    ref: null,
    item: null,
    observation: null,
    reason: 'manual_resolution_required',
    retryAfter: null
  });
  const a = await x.service.propose({
    principal: x.principal,
    intent: {
      ...x.intent,
      operation: 'create_task',
      ref: null,
      payload: {
        title: 'New',
        containerId: 'sample-project'
      },
      mode: 'manual'
    },
    asOf: AS_OF
  });
  expect((await x.service.execute({
    principal: x.principal,
    commandId: a.command.id,
    confirmationId: 'bound-create',
    asOf: AS_OF
  })).outcome).toBe('uncertain');
  expect((await x.make().reconcile({
    username: 'sample',
    commandId: a.command.id,
    asOf: AS_OF
  })).outcome).toBe('uncertain');
  await x.service.execute({
    principal: x.principal,
    commandId: a.command.id,
    confirmationId: 'bound-create',
    asOf: AS_OF
  });
  expect(x.provider.execute).toHaveBeenCalledTimes(1);
});
it('recovers a durably saved result even when its caller lost the acknowledgement', async () => {
  const x = await setup();
  const a = await x.service.propose({
    principal: x.principal,
    intent: x.intent,
    asOf: AS_OF
  });
  const write = x.state.transact;
  x.state.transact = async input => {
    const result = await write(input);
    if (input.events.some(e => e.type === 'command.finished')) throw new Error('after durable result');
    return result;
  };
  expect((await x.service.execute({
    principal: x.principal,
    commandId: a.command.id,
    asOf: AS_OF
  })).outcome).toBe('uncertain');
  x.state.transact = write;
  expect((await x.make().execute({
    principal: x.principal,
    commandId: a.command.id,
    asOf: AS_OF
  })).outcome).toBe('applied');
  expect(x.provider.execute).toHaveBeenCalledTimes(1);
});
it('stops dispatch when permission is revoked after reservation', async () => {
  const x = await setup();
  const a = await x.service.propose({
    principal: x.principal,
    intent: x.intent,
    asOf: AS_OF
  });
  const write = x.state.transact;
  x.state.transact = async input => {
    const result = await write(input);
    if (input.events.some(e => e.type === 'command.dispatched')) x.policy.providerWrites = false;
    return result;
  };
  expect((await x.service.execute({
    principal: x.principal,
    commandId: a.command.id,
    asOf: AS_OF
  })).outcome).toBe('denied');
  expect(x.provider.execute).not.toHaveBeenCalled();
});
it('acknowledges the returning provider occurrence without another activity or command', async () => {
  const {
    ReconcileWork
  } = await import('./ReconcileWork.mjs');
  const {
    snapshot
  } = await import('../../../../../tests/_lib/work/stateHarness.mjs');
  const x = await setup();
  const inbound = new ReconcileWork({
    state: x.state,
    resolvePolicy: () => x.policy,
    userTimezone: () => 'America/Los_Angeles'
  });
  const baseline = snapshot({
    observedAt: AS_OF - 1000,
    items: [item({
      observedAt: AS_OF - 1000
    })],
    revision: 'baseline'
  });
  await inbound.observe({
    username: 'sample',
    snapshot: baseline,
    events: [],
    asOf: AS_OF
  });
  const a = await x.service.propose({
    principal: x.principal,
    intent: x.intent,
    asOf: AS_OF
  });
  await x.service.execute({
    principal: x.principal,
    commandId: a.command.id,
    asOf: AS_OF
  });
  const r = await inbound.observe({
    username: 'sample',
    snapshot: snapshot({
      revision: 'returned'
    }),
    events: [x.event],
    asOf: AS_OF
  });
  expect(r.acknowledgedCommandIds).toEqual([a.command.id]);
  expect(r.newEvents).toEqual([]);
  expect(Object.keys((await x.store.read({
    username: 'sample'
  })).activities)).toHaveLength(1);
  expect(x.provider.execute).toHaveBeenCalledTimes(1);
});
it('does not resolve an uncertain recurring close from a reused causation ID on later occurrences', async () => {
  const {
    ReconcileWork
  } = await import('./ReconcileWork.mjs');
  const {
    snapshot
  } = await import('../../../../../tests/_lib/work/stateHarness.mjs');
  const x = await setup();
  const inbound = new ReconcileWork({
    state: x.state,
    resolvePolicy: () => x.policy
  });
  await inbound.observe({
    username: 'sample',
    snapshot: snapshot({
      observedAt: AS_OF - 1000,
      items: [item({
        observedAt: AS_OF - 1000
      })],
      revision: 'baseline'
    }),
    events: [],
    asOf: AS_OF
  });
  x.provider.getItem = async () => item({
    due: {
      date: '2026-11-18',
      at: null,
      recurring: true,
      occurrenceId: '2026-11-18'
    }
  });
  x.provider.execute.mockResolvedValue({
    outcome: 'uncertain',
    ref,
    item: null,
    observation: null,
    reason: 'timeout',
    retryAfter: null
  });
  const a = await x.service.propose({
    principal: x.principal,
    intent: x.intent,
    asOf: AS_OF
  });
  await x.service.execute({
    principal: x.principal,
    commandId: a.command.id,
    asOf: AS_OF
  });
  const events = [1000, 2000].map(delta => ({
    ...x.event,
    occurredAt: AS_OF + delta,
    observedAt: AS_OF + delta,
    occurrenceId: String(AS_OF + delta),
    causationId: a.command.id
  }));
  const r = await inbound.observe({
    username: 'sample',
    snapshot: snapshot({
      observedAt: AS_OF + 2000,
      revision: 'later'
    }),
    events,
    asOf: AS_OF + 2000
  });
  expect(r.acknowledgedCommandIds).toEqual([]);
  expect(r.newEvents).toHaveLength(2);
  expect((await x.store.read({
    username: 'sample'
  })).commands[a.command.id].status).toBe('uncertain');
});
it('quarantines a provider result that claims success for a different reference', async () => {
  const x = await setup();
  const a = await x.service.propose({
    principal: x.principal,
    intent: x.intent,
    asOf: AS_OF
  });
  x.provider.execute.mockResolvedValue({
    outcome: 'applied',
    ref: {
      ...ref,
      accountId: 'other'
    },
    item: null,
    observation: null,
    reason: null,
    retryAfter: null
  });
  expect((await x.service.execute({
    principal: x.principal,
    commandId: a.command.id,
    asOf: AS_OF
  })).outcome).toBe('uncertain');
  expect(Object.keys((await x.store.read({
    username: 'sample'
  })).activities)).toHaveLength(0);
});
