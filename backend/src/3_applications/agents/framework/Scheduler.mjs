// backend/src/3_applications/agents/framework/Scheduler.mjs

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

  constructor({ logger = console, intervalMs = 30_000 }) {
    this.#logger = logger;
    this.#intervalMs = intervalMs;
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

    this.#ensureRunning();
  }

  /**
   * Start the interval loop if jobs exist and it isn't already running.
   */
  #ensureRunning() {
    if (this.#intervalId || this.#jobs.size === 0) return;
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
      for (const [jobKey, job] of this.#jobs) {
        if (this.#isDue(job, now)) {
          job.lastRun = now;
          this.#logger.info?.('scheduler.trigger', { jobKey });
          try {
            await job.orchestrator.runAssignment(
              job.agentId,
              job.assignmentId,
              { triggeredBy: 'scheduler' }
            );
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
