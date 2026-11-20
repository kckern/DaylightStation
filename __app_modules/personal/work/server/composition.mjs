import { groundedWorkMentions } from './domain/workIntent.mjs';
import moment from 'moment-timezone';
import { WorkFlows } from './application/WorkFlows.mjs';
import { SelectWorkFlow } from './application/SelectWorkFlow.mjs';
import { WorkWorkflowRanker } from './adapters/WorkWorkflowRanker.mjs';
import { workflowRegistry } from './domain/workflows/workflowRegistry.mjs';
import { AttentionBudget } from './application/AttentionBudget.mjs';
import { KnowledgeAttentionHistory } from './adapters/KnowledgeAttentionHistory.mjs';
import { WorkCommands } from './application/WorkCommands.mjs';
import { WorkDecisions } from './application/WorkDecisions.mjs';
import { WorkConversation } from './application/WorkConversation.mjs';
import { WorkCallBudget } from './application/WorkCallBudget.mjs';
import { WorkActivities } from './application/WorkActivities.mjs';
import { ReconcileWork } from './application/ReconcileWork.mjs';
import { TodoistWorkClient } from './adapters/TodoistWorkClient.mjs';
import { ClickUpWorkClient } from './adapters/ClickUpWorkClient.mjs';
import { WorkIntentExtractor } from './adapters/WorkIntentExtractor.mjs';
import { YamlWorkActivityStore } from './adapters/YamlWorkActivityStore.mjs';
import { createWorkCallbackTokens } from './adapters/WorkCallbackTokens.mjs';
import { canonicalWorkEvent } from './domain/workCommands.mjs';
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
import { keyOf, WORK_OPERATIONS } from './domain/workModel.mjs';
import { routeWork } from './domain/workPolicy.mjs';
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
  commands: null,
  activities: null,
  conversation: null,
  decisions: null,
  callBudget: null,
  attention: null,
  start: async () => ({
    status: 'disabled',
    reason
  }),
  dispose: async () => {}
});

// Disabled writers still read existing accounting; they never acquire a writer lease.
function retainedAttention(options) {
  const store = new JsonlWorkState({
    rootForUser: options.rootForUser ?? (username => path.join(options.dataDir, 'users', username, 'work')),
    authority: {
      assertWriter: async () => {
        throw workError('WORK_WRITE_DENIED');
      }
    },
    clock: options.clock ?? Date.now
  });
  return {
    reserve: async input => {
      if (input.owner !== 'knowledge') return {
        allowed: false,
        reason: 'work_disabled',
        reservationId: null
      };
      try {
        const now = (options.clock ?? Date.now)(),
          timezone = options.userTimezone?.(input.username);
        if (!moment.tz.zone(timezone)) throw workError('INVALID_ATTENTION_TIME');
        const day = moment.tz(now, timezone).format('YYYY-MM-DD');
        const snapshot = await store.read({
          username: input.username
        });
        const occupied = Object.values(snapshot.attention ?? {}).some(r => r.status === 'dispatching' || ['prepared', 'quarantined'].includes(r.status) && r.expiresAt > now || ['delivered', 'responded'].includes(r.status) && r.day === day);
        return {
          allowed: snapshot.health.available && !occupied,
          reason: occupied ? 'retained_work_capacity' : 'standalone_knowledge',
          reservationId: null
        };
      } catch {
        return {
          allowed: false,
          reason: 'accounting_unavailable',
          reservationId: null
        };
      }
    }
  };
}
/** Wiring: selects the adapter class for a configured provider type; unknown types throw. */
export function workProviderClass(binding) {
  if (binding?.type === 'todoist') return TodoistWorkProvider;
  if (binding?.type === 'clickup') return ClickUpWorkProvider;
  throw new TypeError('Unknown work provider type');
}
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
  if (document()?.work?.enabled !== true) {
    const result = inert('disabled');
    if (document()?.work && (options.rootForUser || options.dataDir)) result.attention = retainedAttention(options);
    return result;
  }
  const timezone = options.userTimezone ?? (() => null);
  const policy = username => resolveWorkPolicy({
    configuration: document(),
    username,
    timezone: timezone(username)
  });
  const usernames = () => Object.keys(document()?.work?.users ?? {}).filter(username => policy(username).enabled);
  if (!usernames().length) return {
    ...inert('unenrolled'),
    attention: options.rootForUser || options.dataDir ? retainedAttention(options) : null
  };
  if (typeof options.readCurrent !== 'function' || typeof options.readHistory !== 'function' || typeof options.rootForUser !== 'function' && !options.dataDir) return inert('invalid_runtime_dependencies');
  let stopped = false,
    commandService = null,
    decisionService = null,
    conversationService = null,
    flowService = null;
  const stores = new Map(),
    authorities = new Map();
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
      authorities.set(username, authority);
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
  const providerClassFor = workProviderClass;
  const describeProvider = binding => providerClassFor(binding).descriptor;
  const scopedAuth = (service, username) => {
    const p = policy(username),
      bindings = p.enabled ? Object.values(p.providers).filter(binding => binding.type === service) : [];
    if (!bindings.length) return null;
    return bindings[0].authScope === 'household' ? options.getHouseholdAuth?.(service) : options.getUserAuth?.(service, username);
  };
  const ensureProviders = () => {
    for (const username of usernames()) for (const binding of Object.values(policy(username).providers)) {
      const key = accountKey({
        provider: binding.type,
        accountId: binding.accountId
      });
      if (!providers.has(key)) {
        const Provider = providerClassFor(binding);
        providers.set(key, new Provider({
          accountId: binding.accountId,
          loadCurrent: (u, p) => source.current(u, p),
          loadHistory: (u, p) => source.history(u, p),
          resolvePolicy: policy,
          client: options.httpClient && (options.getUserAuth || options.getHouseholdAuth) ? new (binding.type === 'todoist' ? TodoistWorkClient : ClickUpWorkClient)({
            httpClient: options.httpClient,
            getUserAuth: scopedAuth,
            clock,
            timezone,
            canSend: ({
              username
            }) => canWrite(username)
          }) : null,
          verifyDispatch: input => canWrite(input.username) && commandService ? commandService.verifyDispatch(input) : false
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
    clock,
    // Without isActiveSession the authority never produces web principals (fail closed).
    isActiveSession: typeof options.isActiveSession === 'function' ? (sid, username) => !stopped && options.isActiveSession(sid, username) === true : null,
    isEnrolled: username => {
      if (stopped) return false;
      try {
        return policy(username).enabled === true;
      } catch {
        return false;
      }
    },
    logger
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
    confirmLink: async input => {
      ensureProviders();
      const p = principal.verify(input.principal);
      if (!p) throw workError('WORK_PRINCIPAL_REQUIRED');
      const current = await state.read({
        username: p.username
      });
      return reader.confirmLink({
        ...input,
        expectedRevision: input.expectedRevision ?? current.revision
      });
    },
    /** Read-only: each in-scope item with its domain, a display `source` (container title) and the write operations a command could use on it now. */
    actionableItems: async ({
      username,
      asOf
    }) => {
      ensureProviders();
      const result = await reader.execute({
        username,
        asOf
      });
      const p = policy(username);
      if (!p.enabled) return {
        items: [],
        coverage: result.coverage
      };
      const writable = canWrite(username);
      const items = [];
      for (const item of result.items) {
        // Same domain choice as the conversation path: first configured domain holding the item.
        const domainId = Object.keys(p.domains).find(id => {
          const d = p.domains[id],
            b = p.providers[d.provider];
          return b && b.type === item.ref.provider && b.accountId === item.ref.accountId && item.containerRef?.id === d.containerId && (!d.assigneeIds || d.assigneeIds.some(a => item.assigneeIds.includes(a)));
        });
        if (!domainId) continue;
        const binding = p.providers[p.domains[domainId].provider],
          caps = writable ? providers.get(accountKey({
            provider: binding.type,
            accountId: binding.accountId
          }))?.capabilities({
            username
          }) ?? {} : {};
        const container = result.containers?.find(c => item.containerRef && c.ref?.id === item.containerRef.id && c.ref?.provider === item.containerRef.provider && c.ref?.accountId === item.containerRef.accountId);
        items.push({
          item,
          domainId,
          // Display name for the item's source: its container's title, else the domain id.
          source: container?.title ?? container?.name ?? domainId,
          operations: WORK_OPERATIONS.filter(op => op !== 'read' && caps[op] === true && !routeWork({
            policy: p,
            domainId,
            operation: op
          }).denied)
        });
      }
      return {
        items,
        coverage: result.coverage
      };
    },
    getItem: input => {
      ensureProviders();
      return providers.get(accountKey(input.ref))?.getItem(input) ?? Promise.resolve(null);
    },
    verifySource: input => conversationService?.verifySource(input) ?? Promise.resolve(false),
    verifyConfirmation: input => decisionService?.verifyConfirmation(input) ?? Promise.resolve(false),
    linkCandidates: typeof options.knowledgeLinkCandidates === 'function' ? input => options.knowledgeLinkCandidates({
      ...input,
      principal: knowledgePrincipals.get(input.principal)
    }) : null,
    renderInvitation: input => flowService.renderInvitation(input),
    identityForUser: username => options.identityForUser?.(username),
    morningGate: input => options.knowledgeAttentionGate?.(input) ?? Promise.resolve({
      mode: 'legacy',
      reason: 'unavailable',
      questionCount: 2
    }),
    refresh: input => refresh(input.username),
    attentionContext: async ({
      username,
      state,
      context,
      asOf,
      explicitRequest = false
    }) => {
      const linked = [...new Set(context.links.map(l => l.kbObjectId))];
      const knowledgeEligibility = linked.length ? (await options.knowledgeAttentionEligibility?.({
        username,
        kbObjectIds: linked,
        asOf
      })) ?? {} : {};
      const excludeIds = explicitRequest ? [] : Object.entries(state.reviewPreferences ?? {}).filter(([, p]) => p.state === 'dismissed' || p.until > asOf).map(([id]) => id);
      const pendingReview = (await options.pendingKnowledgeReview?.({
        username,
        asOf,
        max: 5,
        excludeIds
      })) ?? {
        available: false,
        ids: [],
        count: 0,
        revision: 'unavailable'
      };
      const sources = Object.values(state.sources ?? {}).filter(s => s.kind === 'journal' && s.valid && s.at <= asOf && asOf - s.at <= 30 * 86400000).sort((a, b) => b.at - a.at).slice(0, 100),
        groundedReferences = [];
      if (sources.length && options.journalEvidence) {
        const evidence = await options.journalEvidence.readByRefs({
          username,
          refs: sources.map(s => s.ref)
        });
        for (const source of sources) {
          const row = evidence.find(e => e.ref === source.ref && e.verified && !e.previewOnly && e.sourceHash === source.sourceHash);
          if (row && source.status === 'processed') for (const observed of source.observations ?? []) {
            const item = context.items.find(i => keyOf(i.ref) === keyOf(observed.ref));
            const intent = item && source.intents?.find(i => i.target?.title === item.title || i.targetText === item.title || i.title === item.title);
            if (!item || !intent || !groundedWorkMentions(row.content, context.items).some(i => keyOf(i.ref) === keyOf(item.ref)) || !groundedWorkMentions(intent.quote, context.items).some(i => keyOf(i.ref) === keyOf(item.ref))) continue;
            groundedReferences.push({
              ref: observed.ref,
              at: source.at,
              evidenceRef: source.ref,
              verified: true
            });
          }
        }
      }
      return {
        knowledgeEligibility,
        pendingReview,
        groundedReferences
      };
    },
    renderFlow: input => {
      if (workflowRegistry.get(input.flowState.flowType)) return flowService.renderFlow(input);
      if (!conversationService) throw workError('WORK_UNAVAILABLE');
      return conversationService.renderFlow(input);
    },
    applyFlowChoice: input => {
      if (workflowRegistry.get(input.flowState.flowType)) return flowService.applyFlowChoice(input);
      if (!conversationService) throw workError('WORK_UNAVAILABLE');
      return conversationService.applyFlowChoice(input);
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
  const attentionService = new AttentionBudget({
    state,
    history: new KnowledgeAttentionHistory({
      readHistory: options.readKnowledgeAttentionHistory ?? (async () => ({
        available: false,
        deliveries: [],
        reservations: [],
        unansweredInvitations: []
      }))
    }),
    userTimezone: timezone,
    resolvePolicy: policy,
    clock
  });
  const retained = retainedAttention(options);
  const knowledgePrincipals = new WeakMap();
  const attention = {
    history: input => attentionService.history(input),
    reserve: input => input.owner === 'knowledge' && (!policy(input.username).enabled || !policy(input.username).writer.write) ? retained.reserve(input) : canWrite(input.username) ? track(attentionService.reserve(input)) : Promise.resolve({
      allowed: false,
      reservationId: null,
      reason: 'work_write_disabled'
    }),
    dispatch: input => canWrite(input.username) ? track(attentionService.dispatch(input)) : Promise.resolve({
      allowed: false
    }),
    acknowledge: input => track(attentionService.acknowledge(input)),
    fail: input => track(attentionService.fail(input)),
    respond: input => track(attentionService.respond(input))
  };
  const budgetService = new WorkCallBudget({
    state,
    resolvePolicy: policy,
    clock
  });
  const callBudget = {
    reserve: input => canWrite(input.username) ? budgetService.reserve(input) : Promise.resolve({
      allowed: input.scope === 'knowledge-extraction',
      receiptId: input.receiptId,
      reason: input.scope === 'knowledge-extraction' ? 'standalone_knowledge' : 'work_write_disabled'
    })
  };
  const hasActivityRoot = typeof options.activityRootForUser === 'function' || !!options.dataDir;
  const activityStore = hasActivityRoot ? new YamlWorkActivityStore({
    rootForUser: username => options.activityRootForUser?.(username) ?? path.join(options.dataDir, 'users', username, 'lifelog'),
    userTimezone: timezone,
    assertWriter: async username => {
      getStore(username);
      await authorities.get(username).assertWriter({
        root: rootForUser(username)
      });
      const current = await state.read({
        username
      });
      if (!canWrite(username) || !current.health.available) throw workError('WORK_WRITE_DENIED');
    }
  }) : null;
  const activityService = activityStore ? new WorkActivities({
    state,
    activityStore,
    knowledgeBridge: options.knowledgeBridge?.applyProviderEvent ? options.knowledgeBridge : null,
    clock,
    logger
  }) : null;
  const activities = activityService ? {
    read: input => policy(input.username).enabled ? activityStore.read(input) : Promise.resolve([]),
    flush: input => canWrite(input.username) ? track(activityService.flush(input)) : Promise.resolve({
      projected: 0,
      pending: 0
    }),
    async verifyProviderEvent({
      username,
      event,
      links,
      asOf
    }) {
      if (!canWrite(username)) return {
        valid: false,
        closureAllowed: false
      };
      const current = await state.read({
          username
        }),
        stored = current.activities[event?.id];
      const normalized = canonicalWorkEvent(event, {
        username,
        policy: policy(username),
        asOf
      });
      const stable = value => {
        const {
          observedAt,
          ...rest
        } = value;
        return rest;
      };
      const valid = !!(current.health.available && stored?.projected && normalized && workHash(stable(stored.event)) === workHash(stable(event)) && Array.isArray(links) && links.every(link => current.links[link.id] && workHash(current.links[link.id]) === workHash(link)));
      if (!valid) return {
        valid: false,
        closureAllowed: false
      };
      const relevance = current.relevance[keyOf(event.ref)],
        snapshots = Object.values(current.snapshots),
        item = snapshots.flatMap(s => s.items).find(row => keyOf(row.ref) === keyOf(event.ref));
      const reopened = snapshots.flatMap(s => s.events).some(row => keyOf(row.ref) === keyOf(event.ref) && row.type === 'reopened' && row.occurredAt > event.occurredAt);
      const newerOpen = item && item.observedAt > event.occurredAt && item.status?.category !== 'done';
      return {
        valid: true,
        closureAllowed: !['paused', 'retired'].includes(relevance?.state) && item?.status?.category !== 'paused' && !newerOpen && !reopened
      };
    }
  } : null;
  commandService = new WorkCommands({
    state,
    providers,
    context,
    resolvePolicy: policy,
    verifyPrincipal: p => principal.verify(p),
    clock,
    logger
  });
  const commands = {
    propose: input => track(commandService.propose(input)),
    execute: input => track((async () => {
      const result = await commandService.execute(input);
      const p = principal.verify(input.principal);
      if (p && canWrite(p.username)) await activities?.flush({
        username: p.username,
        asOf: clock()
      });
      return result;
    })()),
    reconcile: input => track(commandService.reconcile(input))
  };
  decisionService = new WorkDecisions({
    state,
    commands,
    context,
    resolvePolicy: policy,
    verifyPrincipal: p => principal.verify(p),
    clock,
    nextId: options.nextId ?? randomUUID,
    tokens: createWorkCallbackTokens(),
    describeProvider,
    logger
  });
  const decisions = {
    prepare: input => track(decisionService.prepare(input)),
    recordDelivery: input => track(decisionService.recordDelivery(input)),
    recordFailure: input => track(decisionService.recordFailure(input)),
    reply: input => track(decisionService.reply(input)),
    confirmWeb: input => track(decisionService.confirmWeb(input)),
    confirmSystem: input => track(decisionService.confirmSystem(input))
  };
  const selector = new SelectWorkFlow({
    state,
    context,
    budget: attentionService,
    ranker: new WorkWorkflowRanker({
      gateway: options.gateway,
      budget: budgetService,
      resolvePolicy: policy,
      clock
    }),
    resolvePolicy: policy,
    userTimezone: timezone,
    clock,
    logger
  });
  flowService = new WorkFlows({
    state,
    selector,
    decisions: decisionService,
    context,
    budget: attentionService,
    verifyPrincipal: p => principal.verify(p),
    verifyDecisionClaim: input => decisionService.verifyFlowClaim(input),
    resolvePolicy: policy,
    userTimezone: timezone,
    clock
  });
  if (options.journalEvidence) {
    const offlineGateway = {
      scoped() {
        return this;
      },
      async chatStructured() {
        throw workError('WORK_AI_UNAVAILABLE');
      }
    };
    const extractor = new WorkIntentExtractor({
      gateway: options.gateway ?? offlineGateway,
      budget: budgetService,
      resolvePolicy: policy,
      clock
    });
    conversationService = new WorkConversation({
      state,
      context,
      commands,
      decisions,
      principalAuthority: principal,
      evidence: options.journalEvidence,
      intentExtractor: extractor,
      resolvePolicy: policy,
      describeProvider,
      scheduler: {
        after: (delay, work) => scheduler.after(delay, () => track(Promise.resolve().then(work)))
      },
      clock,
      logger,
      deliver: async ({
        principal: p,
        page
      }) => {
        if (!canWrite(p.username) || !principal.verify(p) || typeof options.send !== 'function') throw workError('WORK_DELIVERY_UNAVAILABLE');
        try {
          const receipt = await options.send({
            username: p.username,
            text: page.text,
            choices: page.choices,
            parseMode: null
          });
          if (!receipt?.messageId) throw workError('WORK_DELIVERY_UNACKNOWLEDGED');
          await decisions.recordDelivery({
            username: p.username,
            decisionId: page.decisionId,
            botMessageId: String(receipt.messageId),
            asOf: clock()
          });
        } catch (error) {
          try {
            await decisions.recordFailure({
              username: p.username,
              decisionId: page.decisionId,
              uncertain: true,
              asOf: clock()
            });
          } catch {}
          throw error;
        }
      }
    });
  }
  const conversation = conversationService ? {
    bindKnowledgePrincipal: ({
      principal: work,
      knowledgePrincipal: knowledge
    }) => {
      const p = principal.verify(work);
      if (!p || !knowledge || ['username', 'senderId', 'conversationId', 'kind', 'messageId', 'receiptId', 'callbackData'].some(k => p[k] !== knowledge[k])) return false;
      knowledgePrincipals.set(work, knowledge);
      return true;
    },
    capturePrincipal: input => conversationService.capturePrincipal(input),
    sourceForEntry: input => conversationService.sourceForEntry(input),
    onEntrySaved: input => track(conversationService.onEntrySaved(input)),
    handleCallback: input => track(conversationService.handleCallback(input)),
    deliverWeeklyReview: input => track((async () => {
      const p = policy(input.username);
      if (!p.enabled) {
        const accounting = await retained.reserve({
          owner: 'knowledge',
          username: input.username
        });
        return {
          handled: !accounting.allowed
        };
      }
      if (!canWrite(input.username) || !p.proactive || typeof options.send !== 'function') return {
        handled: true,
        status: 'disabled'
      };
      const askDate = moment.tz(clock(), timezone(input.username)).format('YYYY-MM-DD');
      const selected = await flowService.selectForMorning({
        ...input,
        askDate,
        remainingUnits: 2,
        flowType: 'knowledge_review'
      });
      if (!selected.offer) return {
        handled: true,
        status: 'empty'
      };
      const page = await flowService.prepareForMorning({
        ...input,
        offerId: selected.offer.id,
        askDate
      });
      if (!page) return {
        handled: true,
        status: 'empty'
      };
      try {
        if (!canWrite(input.username) || !(await flowService.dispatchDelivery({
          username: input.username,
          decisionId: page.decisionId
        })).allowed) throw workError('WORK_SEND_REVOKED');
        const receipt = await options.send({
          username: input.username,
          text: page.text,
          choices: page.choices,
          parseMode: null
        });
        if (!receipt?.messageId) throw workError('WORK_DELIVERY_UNACKNOWLEDGED');
        await flowService.recordDelivery({
          username: input.username,
          decisionId: page.decisionId,
          botMessageId: receipt.messageId,
          asOf: clock()
        });
        return {
          handled: true,
          status: 'sent'
        };
      } catch (error) {
        await flowService.recordFailure({
          username: input.username,
          decisionId: page.decisionId,
          uncertain: true,
          asOf: clock()
        });
        throw error;
      }
    })()),
    selectForMorning: input => canWrite(input.username) ? track(flowService.selectForMorning(input)) : Promise.resolve({
      offer: null
    }),
    prepareForMorning: input => canWrite(input.username) ? track(flowService.prepareForMorning(input)) : Promise.resolve(null),
    dispatchDelivery: input => canWrite(input.username) ? track(flowService.dispatchDelivery(input)) : Promise.resolve({
      allowed: false
    }),
    recordDelivery: input => track(flowService.recordDelivery(input)),
    recordFailure: input => track(flowService.recordFailure(input)),
    open: input => track((async () => {
      const p = principal.verify(input.principal);
      if (p && canWrite(p.username)) await refresh(p.username);
      if (workflowRegistry.get(input.flow)) return flowService.open({
        principal: input.principal,
        flowType: input.flow,
        asOf: input.asOf
      });
      return conversationService.open(input);
    })())
  } : null;
  const reconciliation = new ReconcileWork({
    state,
    providers,
    resolvePolicy: policy,
    userTimezone: timezone
  });
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
        if (!old || semanticSnapshot(old) !== digest || !current.baselines?.[key]) await reconciliation.observe({
          username,
          provider: binding.type,
          snapshot,
          events: snapshot.events,
          asOf
        });
      }
      if (canWrite(username)) {
        const pending = await state.read({
          username
        });
        for (const record of Object.values(pending.commands).filter(r => r.status === 'uncertain' && r.command.ref && !['delete_task'].includes(r.command.operation)).sort((a, b) => (a.lastReconciledAt ?? 0) - (b.lastReconciledAt ?? 0) || a.command.createdAt - b.command.createdAt).slice(0, 5)) {
          if (!canWrite(username)) break;
          await commandService.reconcile({
            username,
            commandId: record.command.id,
            asOf: clock()
          });
        }
        await activities?.flush({
          username,
          asOf: clock()
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
    commands,
    decisions,
    conversation,
    activities,
    callBudget,
    attention,
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
          const recovered = await state.read({
            username
          });
          for (const record of Object.values(recovered.commands)) if (['dispatching', 'uncertain'].includes(record.status)) await commandService.reconcile({
            username,
            commandId: record.command.id,
            asOf: clock()
          });
          await conversationService?.restore({
            username
          });
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
      await conversationService?.dispose();
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
