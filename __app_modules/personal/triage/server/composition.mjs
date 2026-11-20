import { createTriageRouter } from './api/triageRouter.mjs';
import { resolveTriagePolicy } from './domain/triagePolicy.mjs';
import { createYamlTriageStore } from './adapters/YamlTriageStore.mjs';
import { createRunTriagePass } from './application/RunTriagePass.mjs';
import { GmailMailbox } from './adapters/GmailMailbox.mjs';
import { createTriageSession } from './application/TriageSession.mjs';
import { createUndoAction } from './application/UndoAction.mjs';
import { createUserLock } from './application/userLock.mjs';

/**
 * Triage runtime: the pass, the owner's session service and the router.
 * `configuration` is a function returning the household `triage` app config.
 * The schedule is registered with `registerSchedule(scheduler)` (or at start when
 * `agentsScheduler` is passed), since the host scheduler may be built after this runtime.
 * The mailbox is either passed in (`mailbox`) or built here from `createMailClient(username)`.
 */
export function createTriageRuntime(deps = {}) {
  const {
    configuration, defaultUsername, isKnownUser, dataService = null, createMailClient = null, work = null,
    decisionGateway = null, aiGateway = null, agentsScheduler = null, ownerName, userTimezone = () => null, answerWaitMs,
    clock = () => Date.now(), logger,
  } = deps;
  const mailbox = deps.mailbox ?? (typeof createMailClient === 'function'
    ? new GmailMailbox({ createClient: createMailClient, logger: logger?.child?.({ module: 'mailbox' }) ?? logger })
    : null);
  const resolvePolicy = (username) => resolveTriagePolicy({ configuration: configuration?.(), username });
  const store = dataService ? createYamlTriageStore({ dataService, clock, logger }) : null;
  // One per-user lock shared by the pass and the owner's answers.
  const lock = createUserLock({ after: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } });
  const pass = store ? createRunTriagePass({
    mailbox, work, store, decisionGateway, aiGateway, resolvePolicy,
    ownerName: typeof ownerName === 'function' ? ownerName : () => '', clock, logger, lock,
  }) : null;
  const ownerNameFn = typeof ownerName === 'function' ? ownerName : () => '';
  const undoAction = store ? createUndoAction({ store, mailbox, work, clock, logger }) : null;
  const session = store ? createTriageSession({
    store, mailbox, work, aiGateway, resolvePolicy, undoAction, ownerName: ownerNameFn,
    userTimezone: typeof userTimezone === 'function' ? userTimezone : () => null, clock, logger, lock,
    ...(Number.isFinite(answerWaitMs) ? { answerWaitMs } : {}),
  }) : null;
  const enrolledUsers = () => Object.keys(configuration?.()?.triage?.users ?? {})
    .filter((u) => { const p = resolvePolicy(u); return p.enrolled && p.mode !== 'off'; });

  const router = createTriageRouter({
    resolvePolicy, defaultUsername, isKnownUser, logger, session,
    runPass: pass ? (input) => pass.run(input) : null,
  });

  let registered = false;
  function registerSchedule(scheduler) {
    if (registered) return;
    if (!pass || typeof scheduler?.registerTask !== 'function') {
      logger?.info?.('triage.schedule.unavailable', { reason: pass ? 'no_scheduler' : 'no_store' });
      return;
    }
    registered = true;
    // One task per distinct schedule; each run goes through the enrolled users one at a time.
    const crons = [...new Set(enrolledUsers().map((u) => resolvePolicy(u).schedule))];
    if (crons.length === 0) logger?.warn?.('triage.schedule.empty', { schedules: 0, users: 0 });
    crons.forEach((cron, i) => {
      const key = i === 0 ? 'triage:pass' : `triage:pass:${i + 1}`;
      scheduler.registerTask(key, cron, async () => {
        for (const username of enrolledUsers().filter((u) => resolvePolicy(u).schedule === cron)) {
          try {
            await pass.run({ username, trigger: 'schedule' });
          } catch (err) {
            logger?.warn?.('triage.schedule.user_failed', { username, error: err?.message });
          }
        }
      });
    });
    logger?.info?.('triage.schedule.registered', { schedules: crons.length, users: enrolledUsers().length });
  }

  return {
    router,
    pass,
    session,
    registerSchedule,
    async start() {
      if (agentsScheduler) registerSchedule(agentsScheduler);
      logger?.info?.('triage.runtime.started', {});
    },
    async dispose() { logger?.info?.('triage.runtime.disposed', {}); },
  };
}
