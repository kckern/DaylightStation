/**
 * The word ladder's tuning pass, composed (mastery redesign spec §7).
 *
 * Builds WordLadderTuningService on the LIVE word-ladder store, with the
 * WordLadderTuner agent only when `word_ladder.tuner.model` is set (no model:
 * the service writes a deterministic note and changes nothing), and a
 * `notify` that pushes each teacher when a day reads as a concern — copy
 * from `composeSchoolPush` (push standard), delivered through the household
 * NotificationService.
 *
 * Scheduled (when the agent scheduler is enabled) every 15 minutes: a tick
 * asks `pending()` and tunes each row one at a time, never in parallel, and a
 * tick that finds the previous one still running is skipped. The service
 * itself refuses a day that has not ended, so the first tick after the
 * study-day rollover is the one that tunes.
 */
import path from 'node:path';
import { NodeApplicationScheduler } from '#adapters/scheduling/NodeApplicationScheduler.mjs';
import { MastraAdapter } from '#adapters/agents/MastraAdapter.mjs';
import { AgentTranscriptFileStore } from '#adapters/agents/AgentTranscriptFileStore.mjs';
import { AgentExecutionPolicy } from '#apps/agents/framework/AgentExecutionPolicy.mjs';
import { WordLadderTuner } from '#apps/agents/word-ladder-tuner/index.mjs';
import { WordLadderTuningService } from '#apps/school/WordLadderTuningService.mjs';
import { composeSchoolPush } from '#domains/school/notifications/schoolPush.mjs';

export const TUNING_TICK_MS = 15 * 60000;

function defaultRuntime({ model, logger, mediaDir }) {
  return new MastraAdapter({
    model, logger, maxToolCalls: 1, timeoutMs: 60000,
    executionPolicy: new AgentExecutionPolicy({
      maxToolCalls: 1, logger,
      transcriptStore: mediaDir ? new AgentTranscriptFileStore({ mediaDir }) : null,
    }),
  });
}

/** A label lookup that throws or hangs must never cost the grown-up the push. */
async function label(lookup) {
  try { return (await lookup()) || null; } catch { return null; }
}

export function createWordLadderTuning({
  store, assignments, decks, lexicons, settings, bounds = null, timezone = null, now = Date.now,
  teacherGate = null, model = null, mediaDir = null,
  notificationService = null, teachers = () => [], learnerName = null,
  logger = console, scheduled = false, server = null,
  scheduler = new NodeApplicationScheduler(), intervalMs = TUNING_TICK_MS,
  createRuntime = defaultRuntime,
  createService = (deps) => new WordLadderTuningService(deps),
} = {}) {
  const tuner = model
    ? new WordLadderTuner({ agentRuntime: createRuntime({ model, logger, mediaDir: mediaDir ? path.resolve(mediaDir) : null }), logger })
    : null;

  const notify = notificationService?.send ? async ({ learnerId, package: pkg, deckId, day, notes }) => {
    const [child, deck] = await Promise.all([
      label(() => learnerName?.(learnerId)),
      label(async () => (await decks.getFlashcardDeck(deckId))?.title),
    ]);
    const push = composeSchoolPush({ kind: 'word-ladder', learnerId, child, deck, package: pkg, day, notes });
    for (const username of teachers() ?? []) {
      // eslint-disable-next-line no-await-in-loop
      await notificationService.send({
        title: push.title,
        body: push.message,
        category: 'school',
        urgency: 'high',
        actions: [{ label: 'Open the console', action: 'open', data: { url: '/school/teacher' } }],
        metadata: { username, pushData: push.data },
        dedupeKey: `word-ladder-concern:${username}:${learnerId}:${pkg}:${day}`,
      });
    }
  } : null;

  const service = createService({
    store, assignments, decks, lexicons, tuner, settings, bounds, notify, teacherGate, timezone, now, logger,
  });

  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const rows = await service.pending();
      for (const row of rows) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await service.runFor(row);
        } catch (error) {
          logger.warn?.('school.word-ladder.tuning-run-failed', { learnerId: row.learnerId, package: row.pkg, day: row.day, error: error.message });
        }
      }
    } catch (error) {
      logger.warn?.('school.word-ladder.tuning-tick-failed', { error: error.message });
    } finally {
      ticking = false;
    }
  };

  const stop = scheduled ? scheduler.every(intervalMs, tick) : () => {};
  server?.once?.('close', stop);
  logger.info?.('school.word-ladder.tuning-wired', { scheduled, model: model ?? null, notify: Boolean(notify) });
  return { service, tick, stop };
}

export default createWordLadderTuning;
