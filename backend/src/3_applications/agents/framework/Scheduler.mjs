// backend/src/3_applications/agents/framework/Scheduler.mjs

import cron from 'node-cron';

/**
 * Scheduler - In-process cron that triggers agent assignments on configured schedules.
 *
 * The scheduler triggers assignments; multi-user fan-out is the assignment's responsibility.
 *
 * @see docs/roadmap/2026-02-14-fitness-dashboard-health-agent-design.md — Scheduler section
 */
export class Scheduler {
  #jobs = new Map();
  #logger;

  constructor({ logger = console }) {
    this.#logger = logger;
  }

  /**
   * Scan an agent's assignments and register cron jobs.
   * @param {Object} agent - Agent instance with getAssignments()
   * @param {Object} orchestrator - AgentOrchestrator instance
   */
  registerAgent(agent, orchestrator) {
    const assignments = agent.getAssignments?.() || [];

    for (const assignment of assignments) {
      if (!assignment.constructor.schedule) continue;

      const jobKey = `${agent.constructor.id}:${assignment.constructor.id}`;
      const cronExpr = assignment.constructor.schedule;

      if (!cron.validate(cronExpr)) {
        this.#logger.error?.('scheduler.invalid_cron', { jobKey, cronExpr });
        continue;
      }

      const job = cron.schedule(cronExpr, async () => {
        this.#logger.info?.('scheduler.trigger', { jobKey });
        try {
          await orchestrator.runAssignment(
            agent.constructor.id,
            assignment.constructor.id,
            { triggeredBy: 'scheduler' }
          );
        } catch (err) {
          this.#logger.error?.('scheduler.failed', { jobKey, error: err.message });
        }
      });

      this.#jobs.set(jobKey, job);
      this.#logger.info?.('scheduler.registered', { jobKey, cronExpr });
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
   * Stop all cron jobs.
   */
  stop() {
    for (const job of this.#jobs.values()) job.stop();
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
