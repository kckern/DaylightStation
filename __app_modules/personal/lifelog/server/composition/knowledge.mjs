import { KnowledgeWorkBridge } from '../application/knowledge/KnowledgeWorkBridge.mjs';
import path from 'node:path';
import { createJournalKnowledgeSource } from './knowledge-source.mjs';
import { KnowledgeWriteAuthority } from '../adapters/knowledge/KnowledgeWriteAuthority.mjs';
import { JsonlKnowledgeLedger } from '../adapters/knowledge/JsonlKnowledgeLedger.mjs';
import { YamlKnowledgeStore } from '../adapters/knowledge/YamlKnowledgeStore.mjs';
import { JournalKnowledgeEvidence, journalSourceId } from '../adapters/knowledge/JournalKnowledgeEvidence.mjs';
import { HistoricalJournalEvidence } from '../adapters/knowledge/HistoricalJournalEvidence.mjs';
import { AuthorizedJournalEvidence } from '../adapters/knowledge/AuthorizedJournalEvidence.mjs';
import { GatewayKnowledgeExtractor } from '../adapters/knowledge/GatewayKnowledgeExtractor.mjs';
import { assertUsername } from '../adapters/knowledge/knowledgeFiles.mjs';
import { randomUUID } from 'node:crypto';
import moment from 'moment-timezone';
import { resolveKnowledgeConfig } from '../adapters/knowledge/KnowledgeConfig.mjs';
import { createKnowledgePrincipalAuthority } from '../adapters/knowledge/KnowledgePrincipalAuthority.mjs';
import { createKnowledgeCallbackTokens } from '../adapters/knowledge/KnowledgeCallbackTokens.mjs';
import { KnowledgeQuestions } from '../application/knowledge/KnowledgeQuestions.mjs';
import { MaintainKnowledgeBase } from '../application/knowledge/MaintainKnowledgeBase.mjs';
import { KnowledgeEntryScheduler } from '../application/knowledge/KnowledgeEntryScheduler.mjs';
import { KnowledgeMetrics } from '../application/knowledge/KnowledgeMetrics.mjs';
import { evidenceProblem } from '../domain/knowledge/contracts.mjs';
import { nextKnowledgeRun } from '../application/knowledge/KnowledgeCalendarSchedule.mjs';
const inert = reason => ({
  followUps: null,
  companion: null,
  maintenance: null,
  metrics: null,
  workBridge: null,
  attentionHistory: null,
  start: async () => ({
    status: 'disabled',
    reason
  }),
  dispose: async () => {}
});
const legacy = () => ({
  mode: 'legacy',
  questions: [],
  statements: [],
  queuedCount: 0,
  selectionId: null,
  reason: 'unavailable'
});
/** Creates no work unless the explicit writer role, identities and timezone all validate. */
export function createKnowledgeRuntime(options = {}) {
  const {
    configuration = {},
    environment,
    hostId,
    platform,
    logger
  } = options;
  const resolved = resolveKnowledgeConfig({
    configuration,
    environment,
    hostId,
    platform
  });
  if (!resolved.active) {
    if (resolved.reason !== 'disabled') logger?.warn?.('lifelog.knowledge.disabled', {
      reason: resolved.reason
    });
    return inert(resolved.reason);
  }
  const c = resolved.config;
  if (options.configService && !options.store) {
    try {
      return createKnowledgeRuntime({
        ...options,
        ...productionDependencies(options, resolved.config)
      });
    } catch (error) {
      logger?.warn?.('lifelog.knowledge.disabled', {
        reason: error.code ?? 'invalid_runtime_dependencies'
      });
      return inert('invalid_runtime_dependencies');
    }
  }
  const {
    store,
    evidence,
    extractor,
    questions: injectedQuestions,
    ledger,
    scheduler,
    send,
    webhookSecret,
    identityForUser,
    identityForSender
  } = options;
  const clock = options.clock ?? Date.now,
    nextId = options.nextId ?? randomUUID,
    usernames = [...new Set(options.usernames ?? [])];
  const userTimezone = username => options.userTimezone?.(username) ?? c.timezone;
  try {
    if (!store?.commit || !evidence?.readByRefs || !extractor?.extract || !scheduler?.after || !send || !webhookSecret || !identityForUser || !identityForSender || !usernames.length) throw Error('missing_runtime_dependencies');
    for (const username of usernames) {
      if (!moment.tz.zone(userTimezone(username)) || !identityForUser(username)?.conversationId || !identityForUser(username)?.senderId) throw Error('invalid_identity_or_timezone');
    }
  } catch {
    logger?.warn?.('lifelog.knowledge.disabled', {
      reason: 'invalid_runtime_dependencies'
    });
    return inert('invalid_runtime_dependencies');
  }
  const authority = createKnowledgePrincipalAuthority({
      identityForSender,
      webhookSecret,
      clock
    }),
    tokens = createKnowledgeCallbackTokens();
  const questions = injectedQuestions ?? new KnowledgeQuestions({
    enabled: true,
    store,
    evidence,
    tokens,
    verifyPrincipal: authority.verify,
    identityForUser,
    userTimezone,
    nextId,
    attentionBudget: options.attentionBudget
  });
  const maintenance = new MaintainKnowledgeBase({
    enabled: true,
    store,
    evidence,
    extractor,
    clock,
    userTimezone,
    nextId,
    logger,
    maxRunsPerDay: c.max_runs_per_day,
    minEntryChars: c.min_entry_chars,
    callBudget: options.callBudget
  });
  let stopped = false,
    startPromise = null;
  const ready = new Set(),
    timers = new Map(),
    active = new Set();
  const track = work => {
    const promise = Promise.resolve().then(work);
    active.add(promise);
    promise.finally(() => active.delete(promise)).catch(() => {});
    return promise;
  };
  async function deliver(username, delivery) {
    if (!delivery?.sendAllowed || stopped) return null;
    try {
      const receipt = await send({
        username,
        text: delivery.questions.map(q => q.text).join('\n\n'),
        choices: delivery.choices,
        parseMode: null
      });
      if (!receipt?.messageId) throw Error('missing_ack');
      await questions.recordDelivery({
        username,
        deliveryId: delivery.deliveryId,
        botMessageId: receipt.messageId,
        asOf: clock()
      });
      return receipt;
    } catch (error) {
      try {
        await questions.recordDeliveryFailure({
          username,
          deliveryId: delivery.deliveryId,
          uncertain: true,
          asOf: clock()
        });
      } catch {/* Prepared state remains durable and cannot resend. */}
      throw error;
    }
  }
  const entry = new KnowledgeEntryScheduler({
    enabled: true,
    store,
    evidence,
    maintenance,
    scheduler,
    clock,
    userTimezone,
    nextId,
    logger,
    postEntryMinutes: c.post_entry_minutes,
    minEntryChars: c.min_entry_chars,
    echoMinChars: c.echo_enabled ? c.echo_min_chars : Number.MAX_SAFE_INTEGER,
    sendAck: send,
    deliverEcho: async ({
      username,
      candidate,
      asOf
    }) => deliver(username, await questions.prepareEcho({
      username,
      runId: candidate.runId,
      asOf
    }))
  });
  function schedule(username, kind) {
    if (stopped) return;
    const key = username + ':' + kind,
      at = kind === 'sweep' ? c.sweep_at : '05:00',
      weekday = kind === 'review' ? 1 : undefined;
    const due = nextKnowledgeRun({
      asOf: clock(),
      timezone: userTimezone(username),
      at,
      weekday
    });
    timers.get(key)?.();
    timers.set(key, scheduler.after(Math.max(0, due - clock()), () => track(async () => {
      timers.delete(key);
      if (stopped) return;
      try {
        if (kind === 'sweep') {
          const result = await maintenance.execute({
            username,
            trigger: 'nightly',
            asOf: clock()
          });
          if (result.status === 'completed' && !stopped) ready.add(username);
        } else await deliver(username, await questions.prepareWeeklyReview({
          username,
          asOf: clock()
        }));
      } catch (error) {
        logger?.warn?.('lifelog.knowledge.scheduled-failed', {
          reason: error.code ?? 'run_failed'
        });
      } finally {
        schedule(username, kind);
      }
    })));
  }
  const providerBridge = new KnowledgeWorkBridge({
    questions,
    store,
    evidence,
    verifyProviderEvent: options.verifyProviderEvent,
    userTimezone
  });
  const attentionHistory = {
    read: input => !stopped && ready.has(input.username) ? providerBridge.attentionHistory(input) : Promise.resolve({
      available: false,
      deliveries: [],
      reservations: [],
      unansweredInvitations: []
    })
  };
  const workBridge = {
    attentionHistory: input => attentionHistory.read(input),
    applyProviderEvent: input => !stopped && ready.has(input.username) ? providerBridge.applyProviderEvent(input) : Promise.resolve({
      applied: false,
      reason: 'kb_unavailable',
      pending: true
    })
  };
  const verify = principal => {
    const p = authority.verify(principal);
    return p && ready.has(p.username) && !stopped ? p : null;
  };
  const requireActive = principal => {
    const p = verify(principal);
    if (!p) throw Object.assign(Error('KNOWLEDGE_UNAVAILABLE'), {
      code: 'KNOWLEDGE_UNAVAILABLE'
    });
    return p;
  };
  const companion = {
    capturePrincipal: input => stopped ? null : authority.attest(input),
    verifyPrincipal: verify,
    shouldSuppressFollowUp({
      principal,
      length
    }) {
      const p = verify(principal);
      return !!(p?.authored && ['text', 'voice'].includes(p.kind) && c.echo_enabled && Number.isSafeInteger(length) && length > c.echo_min_chars);
    },
    async onEntrySaved({
      principal,
      message,
      asOf
    }) {
      const p = verify(principal);
      if (!p || !p.authored || !['text', 'voice'].includes(p.kind)) return {
        scheduled: false,
        suppressFollowUp: false
      };
      const sourceId = journalSourceId(p.username, p.conversationId, p.messageId, message.source?.revision);
      const rows = await evidence.readByRefs({
        username: p.username,
        refs: ['journalist:msg:' + sourceId],
        preview: false
      });
      const row = rows.length === 1 ? rows[0] : null;
      if (!row || evidenceProblem(row, {
        mode: 'commit',
        timezone: userTimezone(p.username),
        asOf
      }) || row.senderId !== p.senderId || row.conversationId !== p.conversationId || row.messageId !== p.messageId) return {
        scheduled: false,
        suppressFollowUp: false
      };
      const attribution = await questions.attributeEntry({
        principal: p,
        sourceId,
        length: row.content.length,
        asOf
      });
      return entry.onEntrySaved({
        username: p.username,
        sourceId,
        attributedAnswer: attribution.attributedAnswer,
        asOf
      });
    },
    nextQuiz: async input => questions.nextQuiz({
      ...input,
      principal: requireActive(input.principal)
    }),
    done: async input => questions.done({
      ...input,
      principal: requireActive(input.principal)
    }),
    hasActiveQuiz: async input => questions.hasActiveQuiz({
      ...input,
      asOf: input.asOf ?? clock(),
      principal: requireActive(input.principal)
    }),
    askOrigin: async input => questions.askOrigin({
      ...input,
      asOf: input.asOf ?? clock(),
      principal: requireActive(input.principal)
    }),
    async handleCallback({
      principal,
      callbackData,
      asOf
    }) {
      const p = verify(principal);
      if (!p || p.kind !== 'callback' || p.callbackData !== callbackData) return {
        status: 'rejected'
      };
      if (callbackData.startsWith('journal:')) return questions.quizControl({
        principal: p,
        asOf
      });
      const decoded = tokens.decode(callbackData);
      if (!decoded) return {
        status: 'rejected'
      };
      if (decoded.action === 'done') return {
        ...(await questions.done({
          principal: p,
          asOf
        })),
        channel: 'quiz',
        action: 'done'
      };
      return questions.reply({
        principal: p,
        token: decoded.nonce,
        action: decoded.action,
        botMessageId: p.messageId,
        receiptId: p.receiptId,
        asOf
      });
    }
  };
  const followUps = {
    selectForMorning: input => ready.has(input.username) && !stopped ? questions.selectForMorning(input) : Promise.resolve(legacy()),
    prepareDelivery: input => {
      if (!ready.has(input.username) || stopped) throw Error('KNOWLEDGE_UNAVAILABLE');
      return questions.prepareDelivery(input);
    },
    recordDelivery: input => questions.recordDelivery(input),
    recordDeliveryFailure: input => questions.recordDeliveryFailure(input)
  };
  return {
    followUps,
    companion,
    maintenance,
    workBridge,
    attentionHistory,
    metrics: ledger ? new KnowledgeMetrics({
      store,
      ledger
    }) : null,
    start() {
      if (stopped) return Promise.resolve({
        status: 'stopped'
      });
      if (startPromise) return startPromise;
      startPromise = track(async () => {
        for (const username of usernames) {
          try {
            await maintenance.initialize({
              username,
              asOf: clock()
            });
            if (stopped) break;
            const snapshot = await store.read({
              username
            });
            if (!snapshot.health.available) throw Error('unavailable');
            ready.add(username);
            const local = moment.tz(clock(), userTimezone(username)),
              [hour, minute] = c.sweep_at.split(':').map(Number);
            const lastDue = local.clone().startOf('day').hour(hour).minute(minute);
            if (lastDue.valueOf() > clock()) lastDue.subtract(1, 'day');
            if (!Number.isFinite(snapshot.health.lastSweepAt) || snapshot.health.lastSweepAt < lastDue.valueOf()) await maintenance.execute({
              username,
              trigger: 'nightly',
              asOf: clock()
            });
            await entry.restore({
              username
            });
            if (local.isoWeekday() === 1 && local.hour() >= 5) await deliver(username, await questions.prepareWeeklyReview({
              username,
              asOf: clock()
            }));
          } catch (error) {
            ready.delete(username);
            logger?.warn?.('lifelog.knowledge.start-failed', {
              reason: error.code ?? 'unavailable'
            });
          }
          schedule(username, 'sweep');
          schedule(username, 'review');
        }
        return {
          status: 'started',
          users: ready.size
        };
      });
      return startPromise;
    },
    async dispose() {
      if (stopped) return;
      stopped = true;
      ready.clear();
      for (const cancel of timers.values()) cancel();
      timers.clear();
      const work = Promise.allSettled([entry.dispose(), maintenance.dispose(), ...active]);
      let cancel;
      await Promise.race([work, new Promise(resolve => {
        cancel = scheduler.after(5000, resolve);
      })]).finally(() => cancel?.());
      await store.close?.();
    }
  };
}
function productionDependencies(options, configuration) {
  const {
    configService,
    dataService,
    userIdentityService,
    telegramIdentityAdapter,
    gateway,
    environment,
    hostId,
    platform,
    logger
  } = options;
  const clock = options.clock ?? Date.now;
  const identityForUser = username => {
    const senderId = userIdentityService.resolvePlatformId('telegram', username);
    if (!senderId) return null;
    return {
      username,
      senderId: String(senderId),
      conversationId: telegramIdentityAdapter.resolve('journalist', {
        username
      }).conversationIdString
    };
  };
  const usernames = (options.usernames ?? configService.getHouseholdUsers()).filter(username => {
    try {
      return !!identityForUser(username);
    } catch {
      return false;
    }
  });
  const identityForSender = senderId => {
    const username = userIdentityService.resolveUsername('telegram', senderId);
    return usernames.includes(username) ? identityForUser(username) : null;
  };
  const userTimezone = username => configService.getUserProfile(username)?.timezone ?? configService.getHouseholdTimezone(configService.getUserHouseholdId(username)) ?? configuration.timezone;
  const rootForUser = username => {
    assertUsername(username);
    return path.join(configService.getUserDir(username), 'lifelog/knowledge');
  };
  const authority = new KnowledgeWriteAuthority({
    configuration,
    environment,
    hostId,
    platform,
    logger
  });
  const ledger = new JsonlKnowledgeLedger({
    rootForUser,
    hostId,
    authority,
    logger
  });
  const store = new YamlKnowledgeStore({
    rootForUser,
    ledger,
    authority,
    clock,
    logger
  });
  const journalOptions = {
    loadJournal: createJournalKnowledgeSource({
      userDirForUser: username => configService.getUserDir(username)
    }),
    identityForUser,
    timezoneForUser: userTimezone,
    logger
  };
  const evidence = new AuthorizedJournalEvidence({
    live: new JournalKnowledgeEvidence(journalOptions),
    historical: new HistoricalJournalEvidence(journalOptions),
    readAuthorizations: async ({
      username
    }) => {
      const snapshot = await store.read({
        username
      });
      if (!snapshot.health.available) throw Error('KNOWLEDGE_UNAVAILABLE');
      return snapshot.state.importAuthorizations ?? {};
    }
  });
  const extractor = new GatewayKnowledgeExtractor({
    gateway,
    model: configuration.model,
    modelVersion: configuration.model ?? gateway?.model ?? 'configured-gateway'
  });
  return {
    store,
    ledger,
    evidence,
    extractor,
    usernames,
    userTimezone,
    identityForUser,
    identityForSender
  };
}
