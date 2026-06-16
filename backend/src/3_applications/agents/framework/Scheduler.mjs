// backend/src/3_applications/agents/framework/Scheduler.mjs

import { existsSync } from 'fs';
import { CronExpressionParser } from 'cron-parser';

/**
 * Scheduler - In-process scheduler that triggers agent assignments on configured schedules.
 *
 * Uses cron-parser (shared with system scheduler) for cron expression handling
 * and setInterval for the tick loop.
 */
export class Scheduler {
  #jobs = new Map();
  #logger;
  #intervalId = null;
  #intervalMs;
  #running = false;
  #enabled;
  #recentRuns = new Map(); // key: jobKey:dateHour → timestamp

  constructor({ logger = console, intervalMs = 30_000, enabled } = {}) {
    this.#logger = logger;
    this.#intervalMs = intervalMs;
    this.#enabled = enabled ?? Scheduler.#enabledFromEnv();
  }

  /**
   * Scheduled jobs send outbound messages (Telegram debriefs, coaching briefs).
   * Every backend instance registers the same crons, so a dev server running
   * alongside prod would double-send. Same rule as the system scheduler
   * (0_system/scheduling): only the Docker container ticks, unless a dev
   * instance explicitly opts in via ENABLE_CRON=true.
   */
  static #enabledFromEnv() {
    if (process.env.NODE_ENV === 'production') return true;
    if (existsSync('/.dockerenv')) return true;
    return process.env.ENABLE_CRON === 'true';
  }

  /**
   * Scan an agent's assignments and register scheduled jobs.
   * @param {Object} agent - Agent instance with getAssignments()
   * @param {Object} orchestrator - AgentOrchestrator instance
   */
  registerAgent(agent, orchestrator) {
    const assignments = agent.getAssignments?.() || [];

    for (const assignment of assignments) {
      if (!assignment.constructor.schedule) continue;

      const jobKey = `${agent.constructor.id}:${assignment.constructor.id}`;
      const cronExpr = assignment.constructor.schedule;

      try {
        CronExpressionParser.parse(cronExpr);
      } catch {
        this.#logger.error?.('scheduler.invalid_cron', { jobKey, cronExpr });
        continue;
      }

      this.#jobs.set(jobKey, {
        cronExpr,
        orchestrator,
        agentId: agent.constructor.id,
        assignmentId: assignment.constructor.id,
        lastRun: null,
      });

      this.#logger.info?.('scheduler.registered', { jobKey, cronExpr });
    }

    this.#ensureRunning(agent.constructor.id);
  }

  /**
   * Register a standalone scheduled task (not an agent assignment).
   * @param {string} taskKey - Unique identifier (e.g., 'journalist:morning-debrief')
   * @param {string} cronExpr - Cron expression
   * @param {Function} handler - Async function to execute
   */
  registerTask(taskKey, cronExpr, handler) {
    try {
      CronExpressionParser.parse(cronExpr);
    } catch {
      this.#logger.error?.('scheduler.invalid_cron', { jobKey: taskKey, cronExpr });
      return;
    }

    this.#jobs.set(taskKey, {
      cronExpr,
      handler,
      lastRun: null,
    });

    this.#logger.info?.('scheduler.registered', { jobKey: taskKey, cronExpr });
    this.#ensureRunning(taskKey);
  }

  /**
   * Start the interval loop if jobs exist and it isn't already running.
   * Outside production the loop never starts — jobs stay registered (so list()
   * and manual trigger() still work) but nothing fires on the clock.
   */
  #ensureRunning(jobKey) {
    if (this.#intervalId || this.#jobs.size === 0) return;
    if (!this.#enabled) {
      this.#logger.warn?.('scheduler.disabled_non_production', {
        jobKey,
        hint: 'set ENABLE_CRON=true to run scheduled jobs in dev',
      });
      return;
    }
    this.#intervalId = setInterval(() => this.#tick(), this.#intervalMs);
  }

  /**
   * Single tick: check each job to see if it's due.
   */
  async #tick() {
    if (this.#running) return;
    this.#running = true;

    try {
      const now = new Date();
      // Prune old dedup keys (older than 2 hours)
      const pruneThreshold = now.getTime() - 2 * 60 * 60 * 1000;
      for (const [key, ts] of this.#recentRuns) {
        if (ts < pruneThreshold) this.#recentRuns.delete(key);
      }

      for (const [jobKey, job] of this.#jobs) {
        if (this.#isDue(job, now)) {
          // Idempotency guard: skip if already ran this hour
          const dateHour = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}`;
          const dedupKey = `${jobKey}:${dateHour}`;
          if (this.#recentRuns.has(dedupKey)) {
            this.#logger.debug?.('scheduler.dedup.skipped', { jobKey, dedupKey });
            continue;
          }

          job.lastRun = now;
          this.#recentRuns.set(dedupKey, now.getTime());
          this.#logger.info?.('scheduler.trigger', { jobKey });
          try {
            if (job.handler) {
              await job.handler();
            } else {
              await job.orchestrator.runAssignment(
                job.agentId,
                job.assignmentId,
                { triggeredBy: 'scheduler' }
              );
            }
          } catch (err) {
            this.#logger.error?.('scheduler.failed', { jobKey, error: err.message });
          }
        }
      }
    } finally {
      this.#running = false;
    }
  }

  /**
   * Check if a job is due to run based on its cron expression.
   */
  #isDue(job, now) {
    try {
      const ref = job.lastRun || new Date(now.getTime() - this.#intervalMs);
      const interval = CronExpressionParser.parse(job.cronExpr, { currentDate: ref });
      const nextRun = interval.next().toDate();
      return nextRun <= now;
    } catch {
      return false;
    }
  }

  /**
   * Manual trigger for testing and ad-hoc runs.
   * @param {string} jobKey - Format: "agentId:assignmentId"
   * @param {Object} orchestrator - AgentOrchestrator instance
   * @returns {Promise<any>} Assignment result
   */
  async trigger(jobKey, orchestrator) {
    const [agentId, assignmentId] = jobKey.split(':');
    return orchestrator.runAssignment(agentId, assignmentId, { triggeredBy: 'manual' });
  }

  /**
   * Stop all scheduled jobs.
   */
  stop() {
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = null;
    }
    this.#jobs.clear();
  }

  /**
   * List registered job keys.
   * @returns {string[]}
   */
  list() {
    return [...this.#jobs.keys()];
  }
}
