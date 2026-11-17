import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveWorkPolicy } from './adapters/WorkConfig.mjs';
import { WorkWriteAuthority } from './adapters/WorkWriteAuthority.mjs';
import { JsonlWorkState } from './adapters/JsonlWorkState.mjs';
import { WorkSourceReader } from './adapters/WorkSourceReader.mjs';
import { WorkPrincipalAuthority } from './adapters/WorkPrincipalAuthority.mjs';
import { TodoistWorkProvider } from './adapters/TodoistWorkProvider.mjs';
import { ClickUpWorkProvider } from './adapters/ClickUpWorkProvider.mjs';
import { ReadWorkContext } from './application/ReadWorkContext.mjs';
import { accountKey, assertWorkUser, workError, workHash } from './domain/workState.mjs';
import { keyOf } from './domain/workModel.mjs';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { WorkBackfillJob } from './application/WorkBackfillJob.mjs';
import { WorkBackfillFiles } from './adapters/WorkBackfillFiles.mjs';
const withoutObserved = ({
  observedAt,
  ...item
}) => item;
const semanticSnapshot = snapshot => workHash({
  items: snapshot.items.map(withoutObserved).sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref))),
  containers: [...snapshot.containers].sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref))),
  events: snapshot.events.map(withoutObserved).sort((a, b) => a.id.localeCompare(b.id)),
  coverage: {
    complete: snapshot.coverage.complete,
    reason: snapshot.coverage.reason,
    scope: snapshot.coverage.scope
  }
});

/** One current collector file per user/provider: merge only explicit compatible routes. */
export function resolveWorkHarvestScope({
  configuration,
  username,
  timezone,
  provider
}) {
  const policy = resolveWorkPolicy({
    configuration,
    username,
    timezone
  });
  if (!policy.enabled) return null;
  const bindings = Object.entries(policy.providers).filter(([, value]) => value.type === provider);
  if (!bindings.length) return null;
  const aliases = new Set(bindings.map(([id]) => id));
  const domains = Object.values(policy.domains).filter(d => aliases.has(d.provider));
  if (!domains.length) return null;
  return {
    accountId: bindings[0][1].accountId,
    authScope: bindings[0][1].authScope,
    containerIds: [...new Set(domains.map(d => d.containerId))],
    assigneeIds: domains.every(d => Array.isArray(d.assigneeIds)) ? [...new Set(domains.flatMap(d => d.assigneeIds))] : null
  };
}
const inert = reason => ({
  context: null,
  backfill: null,
  principal: null,
  start: async () => ({
    status: 'disabled',
    reason
  }),
  dispose: async () => {}
});

/** Composition grants reads and local coordination only; commands arrive separately. */
export function createWorkRuntime(options = {}) {
  const {
    configuration = {},
    clock = Date.now,
    logger,
    environment = process.env.DAYLIGHT_ENV || 'docker',
    hostId = os.hostname()
  } = options;
  const document = () => typeof configuration === 'function' ? configuration() : configuration;
  if (document()?.work?.enabled !== true) return inert('disabled');
  const timezone = options.userTimezone ?? (() => null);
  const policy = username => resolveWorkPolicy({
    configuration: document(),
    username,
    timezone: timezone(username)
  });
  const usernames = () => Object.keys(document()?.work?.users ?? {}).filter(username => policy(username).enabled);
  if (!usernames().length || typeof options.readCurrent !== 'function' || typeof options.readHistory !== 'function' || typeof options.rootForUser !== 'function' && !options.dataDir) return inert('invalid_runtime_dependencies');
  let stopped = false;
  const stores = new Map();
  const canWrite = username => {
    const p = policy(username);
    return !stopped && p.enabled && p.writer.write && p.writer.writer_env === environment && p.writer.writer_host === hostId && process.platform === 'linux';
  };
  const rootForUser = username => {
    assertWorkUser(username);
    return options.rootForUser?.(username) ?? path.join(options.dataDir, 'users', username, 'work');
  };
  const getStore = username => {
    if (!stores.has(username)) {
      const p = policy(username);
      const actual = new WorkWriteAuthority({
        configuration: {
          enabled: p.enabled,
          write: p.writer.write,
          writer_env: p.writer.writer_env,
          writer_host: p.writer.writer_host
        },
        environment,
        hostId,
        logger
      });
      const authority = {
        get leaseLost() {
          return actual.leaseLost;
        },
        assertWriter: input => {
          if (!canWrite(username)) throw workError('WORK_WRITE_DENIED');
          return actual.assertWriter(input);
        },
        close: () => actual.close()
      };
      stores.set(username, new JsonlWorkState({
        rootForUser,
        authority,
        clock
      }));
    }
    return stores.get(username);
  };
  const state = {
    read: input => getStore(input.username).read(input),
    transact: input => getStore(input.username).transact(input),
    recover: input => getStore(input.username).recover(input)
  };
  const source = new WorkSourceReader({
    readCurrent: options.readCurrent,
    readHistory: options.readHistory,
    readHealth: options.readHealth
  });
  const providers = new Map();
  const ensureProviders = () => {
    for (const username of usernames()) for (const binding of Object.values(policy(username).providers)) {
      const key = accountKey({
        provider: binding.type,
        accountId: binding.accountId
      });
      if (!providers.has(key)) {
        const Provider = binding.type === 'todoist' ? TodoistWorkProvider : ClickUpWorkProvider;
        providers.set(key, new Provider({
          accountId: binding.accountId,
          loadCurrent: (u, p) => source.current(u, p),
          loadHistory: (u, p) => source.history(u, p),
          resolvePolicy: policy
        }));
      }
    }
  };
  const principal = new WorkPrincipalAuthority({
    identityForSender: senderId => {
      if (stopped) return null;
      const identity = options.identityForSender?.(senderId);
      return identity && policy(identity.username).enabled ? identity : null;
    },
    webhookSecret: options.webhookSecret,
    clock
  });
  const reader = new ReadWorkContext({
    state,
    providers,
    resolvePolicy: policy,
    verifyPrincipal: p => principal.verify(p)
  });
  const context = {
    execute: input => {
      ensureProviders();
      return reader.execute(input);
    },
    confirmLink: input => {
      ensureProviders();
      return reader.confirmLink(input);
    }
  };
  const backfill = options.knowledgeBridge?.openJob ? new WorkBackfillJob({
    resolvePolicy: policy,
    context,
    filesFactory: ({
      outputDir,
      manifestPath
    }) => new WorkBackfillFiles({
      outputDir: outputDir ?? path.dirname(manifestPath),
      dataDir: options.dataDir
    }),
    knowledgeBridge: options.knowledgeBridge,
    clock,
    nextId: options.nextId ?? randomUUID
  }) : null;
  const scheduler = options.scheduler ?? new NodeApplicationScheduler();
  const active = new Set(),
    refreshing = new Map(),
    timers = new Map();
  let startPromise = null,
    unsubscribe = null;
  const track = promise => {
    active.add(promise);
    promise.finally(() => active.delete(promise)).catch(() => {});
    return promise;
  };
  const refresh = username => {
    if (stopped || !canWrite(username)) return Promise.resolve();
    if (refreshing.has(username)) return refreshing.get(username);
    const work = Promise.resolve().then(async () => {
      ensureProviders();
      const p = policy(username),
        done = new Set();
      for (const binding of Object.values(p.providers)) {
        if (stopped || !canWrite(username)) return;
        const key = accountKey({
          provider: binding.type,
          accountId: binding.accountId
        });
        if (done.has(key)) continue;
        done.add(key);
        const scope = resolveWorkHarvestScope({
          configuration: document(),
          username,
          timezone: timezone(username),
          provider: binding.type
        });
        if (!scope) continue;
        const asOf = clock(),
          snapshot = await providers.get(key).readSnapshot({
            username,
            scope,
            asOf
          });
        if (stopped || !canWrite(username) || !snapshot.coverage.complete) continue;
        const current = await state.read({
          username
        });
        if (stopped || !current.health.available) continue;
        const digest = semanticSnapshot(snapshot),
          old = current.snapshots[key];
        if (old && semanticSnapshot(old) === digest) continue;
        await state.transact({
          username,
          id: 'snapshot:' + workHash([key, digest, snapshot.observedAt]),
          expectedRevision: current.revision,
          events: [{
            type: 'snapshot.observed',
            provider: binding.type,
            accountId: binding.accountId,
            snapshot
          }],
          asOf
        });
      }
    }).catch(error => {
      logger?.warn?.('work.refresh.failed', {
        username,
        code: error.code ?? 'refresh_failed'
      });
    }).finally(() => {
      if (refreshing.get(username) === work) refreshing.delete(username);
    });
    refreshing.set(username, work);
    return track(work);
  };
  const schedule = username => {
    if (stopped || !canWrite(username) || !policy(username).catchUp) return;
    const cancel = scheduler.after(policy(username).limits.pollMinutes * 60000, () => {
      timers.delete(username);
      return refresh(username).finally(() => schedule(username));
    });
    timers.set(username, cancel);
  };
  return {
    context,
    principal,
    backfill,
    start() {
      if (stopped) return Promise.resolve({
        status: 'stopped'
      });
      if (startPromise) return startPromise;
      unsubscribe = options.harvesterService?.onResult(event => {
        if (!stopped && ['todoist', 'clickup'].includes(event.serviceId) && event.result?.status === 'success' && event.result.coverage?.complete === true && !event.error) return refresh(event.username);
      });
      startPromise = track((async () => {
        for (const username of usernames()) if (canWrite(username)) {
          await state.recover({
            username
          });
          if (stopped) break;
          await refresh(username);
          schedule(username);
        }
        return {
          status: stopped ? 'stopped' : 'ready'
        };
      })());
      return startPromise;
    },
    dispose: async () => {
      if (stopped) return;
      stopped = true;
      principal.close();
      unsubscribe?.();
      for (const cancel of timers.values()) cancel();
      timers.clear();
      await backfill?.close();
      if (active.size) {
        let cancel;
        await Promise.race([Promise.allSettled([...active]), new Promise(resolve => {
          cancel = scheduler.after(5000, resolve);
        })]).finally(() => cancel?.());
      }
      await Promise.allSettled([...stores.values()].map(store => store.close()));
    }
  };
}
