# Remove node-cron: Use Existing Scheduler Infrastructure

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the redundant `node-cron` dependency by rewriting the agent framework's Scheduler to register jobs through the existing system scheduler infrastructure (`TaskRegistry` + `SchedulerService`).

**Architecture:** The agent framework's `Scheduler` currently imports `node-cron` to run its own cron loop, duplicating the system scheduler that already uses `cron-parser` via `SchedulerService`. The fix: rewrite the agent `Scheduler` to use `CronExpressionParser` from `cron-parser` (already a dependency) for validation, and `setInterval` for the tick loop (matching the system `Scheduler` pattern). This keeps the agent scheduler self-contained at the application layer while removing the redundant dependency.

**Tech Stack:** `cron-parser` (existing dependency), Node.js `setInterval`

---

### Task 1: Rewrite Agent Scheduler to Drop node-cron

**Files:**
- Modify: `backend/src/3_applications/agents/framework/Scheduler.mjs`

**Step 1: Rewrite the Scheduler**

Replace the `node-cron` implementation with `cron-parser` + `setInterval`. The new implementation validates cron expressions with `CronExpressionParser.parse()` (throws on invalid), and uses a 30-second interval tick to check if jobs are due.

```javascript
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
        // Validate cron expression (throws if invalid)
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
```

**Step 2: Run existing tests to verify**

Run: `node --test backend/tests/unit/agents/framework/Scheduler.test.mjs`
Expected: All 4 tests pass (register, skip-no-schedule, skip-invalid-cron, trigger, stop)

**Step 3: Commit**

```bash
git add backend/src/3_applications/agents/framework/Scheduler.mjs
git commit -m "refactor: replace node-cron with cron-parser in agent scheduler"
```

---

### Task 2: Remove node-cron Dependency

**Files:**
- Modify: `package.json`
- Regenerate: `package-lock.json`

**Step 1: Remove node-cron from package.json**

Remove the `"node-cron": "^4.2.1"` line from the `dependencies` section in `package.json`.

**Step 2: Regenerate lock file**

Run: `npm install`

This removes `node-cron` from `package-lock.json` and the `node_modules` tree.

**Step 3: Verify no remaining imports**

Run: `grep -r "node-cron" backend/src/`
Expected: No results (docs/ references are fine — they're design docs, not runtime code)

**Step 4: Run tests**

Run: `node --test backend/tests/unit/agents/framework/Scheduler.test.mjs`
Expected: All tests pass

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove redundant node-cron dependency

Agent scheduler now uses cron-parser (already present for system scheduler).
This also fixes Docker build cache busting from the lock file churn."
```

---

### Out of Scope

- **`ajv`** stays — it provides JSON schema validation in `OutputValidator.mjs`, a capability the codebase doesn't otherwise have.
- **System scheduler refactoring** — the agent scheduler stays self-contained at the application layer. It doesn't need YAML persistence or the full `SchedulerOrchestrator` pipeline; it just needs to parse cron expressions and run a tick loop.
