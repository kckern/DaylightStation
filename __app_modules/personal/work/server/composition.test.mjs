import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkRuntime, resolveWorkHarvestScope } from './runtime.mjs';
import { workProviderClass } from './composition.mjs';
import { AS_OF, todoTask } from '../../../../tests/_lib/work/observations.mjs';
const configuration = () => ({
  work: {
    enabled: true,
    providers: {
      personal: {
        type: 'todoist',
        accountId: 'personal',
        authScope: 'user',
        operations: ['read']
      }
    },
    domains: {
      personal: {
        provider: 'personal',
        containerId: 'sample-project',
        role: 'tasks',
        autoComplete: 'linked_explicit'
      },
      projects: {
        provider: 'personal',
        containerId: 'other-project',
        role: 'projects',
        autoComplete: 'never'
      }
    },
    users: {
      sample: {},
      other: {}
    }
  }
});
const current = () => ({
  schema: 'work-source-snapshot/v1',
  provider: 'todoist',
  accountId: 'personal',
  observedAt: AS_OF,
  tasks: [todoTask()],
  containers: [],
  coverage: {
    complete: true,
    from: AS_OF - 86400000,
    to: AS_OF,
    scope: {
      accountId: 'personal',
      containerIds: ['sample-project', 'other-project'],
      assigneeIds: null
    }
  }
});
describe('Work runtime composition', () => {
  it('does no source reads, timers, locks or model work when disabled', async () => {
    const readCurrent = vi.fn(),
      scheduler = {
        after: vi.fn()
      };
    const runtime = createWorkRuntime({
      configuration: {},
      readCurrent,
      scheduler
    });
    expect(runtime.context).toBeNull();
    expect(runtime.principal).toBeNull();
    await runtime.start();
    await runtime.dispose();
    expect(readCurrent).not.toHaveBeenCalled();
    expect(scheduler.after).not.toHaveBeenCalled();
  });
  it('reads both roles from Todoist while KB is absent, retaining unconfirmed relevance and user isolation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-runtime-'));
    const reads = [];
    const runtime = createWorkRuntime({
      configuration: configuration(),
      environment: 'test',
      hostId: 'fixture-host',
      rootForUser: username => path.join(tmp, username),
      userTimezone: () => 'America/Los_Angeles',
      readCurrent: async (username, provider) => {
        reads.push([username, provider]);
        return {
          ...current(),
          tasks: [todoTask({
            content: username + ' task'
          })]
        };
      },
      readHistory: async () => ({}),
      identityForSender: () => ({
        username: 'sample',
        senderId: '101',
        conversationId: 'telegram:b42_c101'
      }),
      webhookSecret: 'fixture-secret',
      clock: () => AS_OF
    });
    try {
      const result = await runtime.context.execute({
        username: 'sample',
        asOf: AS_OF
      });
      expect(result.items[0].title).toBe('sample task');
      expect(Object.values(result.relevance)[0].state).toBe('unconfirmed');
      expect((await runtime.context.execute({
        username: 'other',
        asOf: AS_OF
      })).items[0].title).toBe('other task');
      expect((await runtime.context.execute({
        username: 'unknown',
        asOf: AS_OF
      })).items).toEqual([]);
      expect(reads).toEqual([['sample', 'todoist'], ['other', 'todoist']]);
      expect(fs.readdirSync(tmp)).toEqual([]);
      const principal = runtime.principal.capturePrincipal({
        event: {
          platform: 'telegram',
          platformUserId: '101',
          conversationId: 'telegram:b42_c101',
          type: 'text',
          messageId: '99',
          metadata: {
            senderId: '101',
            chatId: '101',
            chatType: 'private'
          },
          payload: {
            text: 'Done.'
          }
        },
        webhookSecret: 'fixture-secret'
      });
      expect(runtime.principal.verify(principal).username).toBe('sample');
      expect(runtime.backfill).toBeNull();
      // No isActiveSession supplied: web principals are never produced (fail closed).
      expect(runtime.principal.web({
        session: {
          username: 'sample',
          sid: 'sid-1'
        },
        requestId: 'req-1'
      })).toBeNull();
      const job = runtime.principal.system({
        username: 'sample',
        job: 'triage-overnight'
      });
      expect(runtime.principal.verify(job)).toBe(job);
      expect(runtime.principal.system({
        username: 'unknown',
        job: 'triage-overnight'
      })).toBeNull();
      expect(typeof runtime.decisions.confirmWeb).toBe('function');
      expect(typeof runtime.decisions.confirmSystem).toBe('function');
    } finally {
      await runtime.dispose();
      fs.rmSync(tmp, {
        recursive: true,
        force: true
      });
    }
  });
  it('captures web principals only for a live session bound to an enrolled user', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-runtime-'));
    const live = new Set(['sid-1']);
    const runtime = createWorkRuntime({
      configuration: configuration(),
      environment: 'test',
      hostId: 'fixture-host',
      rootForUser: username => path.join(tmp, username),
      userTimezone: () => 'America/Los_Angeles',
      readCurrent: async () => current(),
      readHistory: async () => ({}),
      identityForSender: () => null,
      isActiveSession: (sid, username) => live.has(sid) && username === 'sample',
      clock: () => AS_OF
    });
    try {
      const input = (username, sid = 'sid-1') => ({
        session: {
          username,
          sid
        },
        requestId: 'req-1'
      });
      const web = runtime.principal.web(input('sample'));
      expect(web).toMatchObject({
        platform: 'web',
        username: 'sample',
        sessionId: 'sid-1'
      });
      expect(runtime.principal.web(input('other'))).toBeNull();
      expect(runtime.principal.web(input('sample', 'sid-2'))).toBeNull();
      live.delete('sid-1');
      expect(runtime.principal.verify(web)).toBeNull();
    } finally {
      await runtime.dispose();
      fs.rmSync(tmp, {
        recursive: true,
        force: true
      });
    }
  });
  it('gives the collectors one explicit account/auth and combined container scope', () => {
    expect(resolveWorkHarvestScope({
      configuration: configuration(),
      username: 'sample',
      timezone: 'America/Los_Angeles',
      provider: 'todoist'
    })).toEqual({
      accountId: 'personal',
      authScope: 'user',
      containerIds: ['sample-project', 'other-project'],
      assigneeIds: null
    });
    expect(resolveWorkHarvestScope({
      configuration: configuration(),
      username: 'unknown',
      timezone: 'America/Los_Angeles',
      provider: 'todoist'
    })).toBeNull();
  });
  it('backs up changed source facts once and never fills the ledger with identical poll snapshots', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-backups-'));
    const config = configuration();
    delete config.work.users.other;
    Object.assign(config.work, {
      write: true,
      writer_env: 'test',
      writer_host: 'fixture-host'
    });
    let now = AS_OF,
      raw = current(),
      listener;
    const runtime = createWorkRuntime({
      configuration: config,
      environment: 'test',
      hostId: 'fixture-host',
      rootForUser: username => path.join(tmp, username),
      userTimezone: () => 'America/Los_Angeles',
      readCurrent: async () => raw,
      readHistory: async () => ({}),
      clock: () => now,
      harvesterService: {
        onResult: fn => {
          listener = fn;
          return () => {
            listener = null;
          };
        }
      }
    });
    try {
      await runtime.start();
      const ledger = path.join(tmp, 'sample', 'events.jsonl');
      expect(fs.readFileSync(ledger, 'utf8').trim().split('\n')).toHaveLength(1);
      now += 900000;
      raw = {
        ...raw,
        observedAt: now,
        coverage: {
          ...raw.coverage,
          to: now,
          from: now - 86400000
        }
      };
      await listener({
        username: 'sample',
        serviceId: 'todoist',
        result: {
          status: 'success',
          coverage: {
            complete: true
          }
        }
      });
      expect(fs.readFileSync(ledger, 'utf8').trim().split('\n')).toHaveLength(1);
      now += 900000;
      raw = {
        ...raw,
        observedAt: now,
        tasks: [todoTask({
          content: 'An updated task'
        })]
      };
      await listener({
        username: 'sample',
        serviceId: 'todoist',
        result: {
          status: 'success',
          coverage: {
            complete: true
          }
        }
      });
      expect(fs.readFileSync(ledger, 'utf8').trim().split('\n')).toHaveLength(2);
      expect(Object.values((await runtime.context.execute({
        username: 'sample',
        asOf: now
      })).relevance)[0].state).toBe('unconfirmed');
    } finally {
      await runtime.dispose();
      fs.rmSync(tmp, {
        recursive: true,
        force: true
      });
    }
    expect(listener).toBeNull();
  });
  it('schedules missed-hook catch-up only for an opted-in authorized writer', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-catchup-')),
      jobs = [];
    const config = configuration();
    delete config.work.users.other;
    Object.assign(config.work, {
      write: true,
      catchUp: true,
      writer_env: 'test',
      writer_host: 'fixture-host'
    });
    const runtime = createWorkRuntime({
      configuration: config,
      environment: 'test',
      hostId: 'fixture-host',
      rootForUser: username => path.join(tmp, username),
      userTimezone: () => 'America/Los_Angeles',
      readCurrent: async () => current(),
      readHistory: async () => ({}),
      clock: () => AS_OF,
      scheduler: {
        after: (delay, fn) => {
          const job = {
            delay,
            fn,
            cancelled: false
          };
          jobs.push(job);
          return () => {
            job.cancelled = true;
          };
        }
      }
    });
    try {
      await runtime.start();
      expect(jobs.filter(j => !j.cancelled).map(j => j.delay)).toEqual([15 * 60000]);
    } finally {
      await runtime.dispose();
      fs.rmSync(tmp, {
        recursive: true,
        force: true
      });
    }
    expect(jobs.every(j => j.cancelled)).toBe(true);
  });
  it('bounds shutdown at five seconds and blocks a source read that resolves afterward from writing', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-late-read-')),
      jobs = [];
    const config = configuration();
    delete config.work.users.other;
    Object.assign(config.work, {
      write: true,
      writer_env: 'test',
      writer_host: 'fixture-host'
    });
    let entered, release;
    const reading = new Promise(resolve => {
        entered = resolve;
      }),
      pending = new Promise(resolve => {
        release = resolve;
      });
    const runtime = createWorkRuntime({
      configuration: config,
      environment: 'test',
      hostId: 'fixture-host',
      rootForUser: u => path.join(tmp, u),
      userTimezone: () => 'America/Los_Angeles',
      clock: () => AS_OF,
      readHistory: async () => ({}),
      readCurrent: async () => {
        entered();
        return pending;
      },
      scheduler: {
        after: (delay, fn) => {
          const job = {
            delay,
            fn,
            cancelled: false
          };
          jobs.push(job);
          return () => {
            job.cancelled = true;
          };
        }
      }
    });
    try {
      const starting = runtime.start();
      await reading;
      const disposing = runtime.dispose();
      await vi.waitFor(() => expect(jobs.some(job => job.delay === 5000)).toBe(true));
      jobs.find(job => job.delay === 5000).fn();
      await disposing;
      release(current());
      expect((await starting).status).toBe('stopped');
      expect(fs.existsSync(path.join(tmp, 'sample', 'events.jsonl'))).toBe(false);
      expect(jobs.every(job => job.cancelled)).toBe(true);
    } finally {
      release(current());
      await runtime.dispose();
      fs.rmSync(tmp, {
        recursive: true,
        force: true
      });
    }
  });
});
it('allows the legacy KB cap on a read-only Work host but never grants an unrecorded Work model attempt', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-budget-role-'));
  const runtime = createWorkRuntime({
    configuration: configuration(),
    environment: 'test',
    hostId: 'fixture-host',
    rootForUser: u => path.join(tmp, u),
    userTimezone: () => 'America/Los_Angeles',
    readCurrent: async () => current(),
    readHistory: async () => ({}),
    clock: () => AS_OF
  });
  try {
    expect((await runtime.callBudget.reserve({
      username: 'sample',
      scope: 'journal-intent',
      receiptId: 'attempt',
      asOf: AS_OF
    })).allowed).toBe(false);
    expect((await runtime.callBudget.reserve({
      username: 'sample',
      scope: 'knowledge-extraction',
      receiptId: 'attempt',
      asOf: AS_OF
    })).allowed).toBe(true);
    expect(fs.readdirSync(tmp)).toEqual([]);
  } finally {
    await runtime.dispose();
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
});
it('exposes a scoped attention budget backed by the public KB history reader', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-attention-runtime-'));
  const c = configuration();
  Object.assign(c.work, {
    write: true,
    writer_env: 'fixture-prod',
    writer_host: 'fixture-writer'
  });
  const readKnowledgeAttentionHistory = vi.fn(async () => ({
    available: true,
    deliveries: [{
      id: 'kb:prior',
      day: '2026-11-17',
      channel: 'morning',
      status: 'delivered',
      questionUnits: 2,
      deliveredAt: AS_OF - 1
    }],
    reservations: [],
    unansweredInvitations: []
  }));
  const runtime = createWorkRuntime({
    configuration: c,
    environment: 'fixture-prod',
    hostId: 'fixture-writer',
    rootForUser: u => path.join(root, u, 'work'),
    userTimezone: () => 'America/Los_Angeles',
    clock: () => AS_OF,
    readCurrent: async () => current(),
    readHistory: async () => ({}),
    readKnowledgeAttentionHistory,
    logger: {
      warn() {},
      info() {},
      debug() {}
    }
  });
  try {
    await runtime.start();
    expect(runtime.attention).toBeTruthy();
    expect(await runtime.attention.reserve({
      username: 'sample',
      decisionId: 'offer',
      channel: 'housekeeping',
      flowType: 'housekeeping',
      questionUnits: 1,
      refKey: 'one',
      asOf: AS_OF,
      expiresAt: AS_OF + 86400000
    })).toMatchObject({
      allowed: false,
      reason: 'daily_budget'
    });
    expect(readKnowledgeAttentionHistory).toHaveBeenCalled();
  } finally {
    await runtime.dispose();
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
it('keeps KB-only attention behavior for an unenrolled or read-only user without granting an unrecorded Work invitation', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-attention-role-')),
    runtime = createWorkRuntime({
      configuration: configuration(),
      environment: 'test',
      hostId: 'fixture-host',
      rootForUser: u => path.join(tmp, u),
      userTimezone: () => 'America/Los_Angeles',
      readCurrent: async () => current(),
      readHistory: async () => ({}),
      clock: () => AS_OF
    });
  try {
    const input = {
      username: 'sample',
      decisionId: 'kb-one',
      channel: 'morning',
      flowType: 'morning',
      questionUnits: 1,
      expiresAt: AS_OF + 86400000
    };
    expect(await runtime.attention.reserve({
      ...input,
      owner: 'knowledge'
    })).toMatchObject({
      allowed: true,
      reservationId: null
    });
    expect((await runtime.attention.reserve(input)).allowed).toBe(false);
    expect(fs.readdirSync(tmp)).toHaveLength(0);
  } finally {
    await runtime.dispose();
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
});

describe('workProviderClass', () => {
  it('selects the adapter for each configured type and rejects unknown types', () => {
    expect(workProviderClass({ type: 'todoist' }).descriptor).toMatchObject({ assigneeField: 'single' });
    expect(workProviderClass({ type: 'clickup' }).descriptor).toMatchObject({ containerNoun: 'List' });
    expect(() => workProviderClass({ type: 'other' })).toThrow('Unknown work provider type');
  });
});
