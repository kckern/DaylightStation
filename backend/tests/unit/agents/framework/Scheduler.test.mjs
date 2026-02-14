// backend/tests/unit/agents/framework/Scheduler.test.mjs

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Scheduler } from '../../../../src/3_applications/agents/framework/Scheduler.mjs';

describe('Scheduler', () => {
  let scheduler;
  let mockLogger;

  beforeEach(() => {
    mockLogger = { info: () => {}, error: () => {}, warn: () => {} };
    scheduler = new Scheduler({ logger: mockLogger });
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('registerAgent', () => {
    it('should register cron jobs for assignments with schedules', () => {
      const mockAgent = {
        constructor: { id: 'test-agent' },
        getAssignments: () => [
          { constructor: { id: 'daily-task', schedule: '0 4 * * *' } },
        ],
      };

      const mockOrchestrator = {};
      scheduler.registerAgent(mockAgent, mockOrchestrator);

      const jobs = scheduler.list();
      assert.strictEqual(jobs.length, 1);
      assert.strictEqual(jobs[0], 'test-agent:daily-task');
    });

    it('should skip assignments without schedules', () => {
      const mockAgent = {
        constructor: { id: 'test-agent' },
        getAssignments: () => [
          { constructor: { id: 'no-schedule' } }, // no schedule property
        ],
      };

      scheduler.registerAgent(mockAgent, {});
      assert.strictEqual(scheduler.list().length, 0);
    });

    it('should skip invalid cron expressions', () => {
      let errorLogged = false;
      const errorLogger = { ...mockLogger, error: () => { errorLogged = true; } };
      const s = new Scheduler({ logger: errorLogger });

      const mockAgent = {
        constructor: { id: 'test-agent' },
        getAssignments: () => [
          { constructor: { id: 'bad-cron', schedule: 'not a cron' } },
        ],
      };

      s.registerAgent(mockAgent, {});
      assert.strictEqual(s.list().length, 0);
      assert.ok(errorLogged);
      s.stop();
    });

    it('should handle agents with no getAssignments method', () => {
      const mockAgent = { constructor: { id: 'legacy' } };
      assert.doesNotThrow(() => scheduler.registerAgent(mockAgent, {}));
      assert.strictEqual(scheduler.list().length, 0);
    });
  });

  describe('trigger', () => {
    it('should call orchestrator.runAssignment for manual trigger', async () => {
      let capturedArgs;
      const mockOrchestrator = {
        runAssignment: async (agentId, assignmentId, opts) => {
          capturedArgs = { agentId, assignmentId, opts };
          return { result: 'triggered' };
        },
      };

      const result = await scheduler.trigger('my-agent:my-task', mockOrchestrator);

      assert.strictEqual(capturedArgs.agentId, 'my-agent');
      assert.strictEqual(capturedArgs.assignmentId, 'my-task');
      assert.strictEqual(capturedArgs.opts.triggeredBy, 'manual');
    });
  });

  describe('stop', () => {
    it('should clear all registered jobs', () => {
      const mockAgent = {
        constructor: { id: 'test' },
        getAssignments: () => [
          { constructor: { id: 'job1', schedule: '0 * * * *' } },
        ],
      };

      scheduler.registerAgent(mockAgent, {});
      assert.strictEqual(scheduler.list().length, 1);

      scheduler.stop();
      assert.strictEqual(scheduler.list().length, 0);
    });
  });
});
