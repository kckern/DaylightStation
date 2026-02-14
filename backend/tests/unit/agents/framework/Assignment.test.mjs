// backend/tests/unit/agents/framework/Assignment.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Assignment } from '../../../../src/3_applications/agents/framework/Assignment.mjs';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('Assignment', () => {
  describe('base class', () => {
    it('should throw if subclass methods are not implemented', async () => {
      const assignment = new Assignment();
      await assert.rejects(() => assignment.gather({}), /implement/);
      assert.throws(() => assignment.buildPrompt(), /implement/);
      assert.throws(() => assignment.getOutputSchema(), /implement/);
      await assert.rejects(() => assignment.validate(), /implement/);
      await assert.rejects(() => assignment.act(), /implement/);
    });
  });

  describe('execute lifecycle', () => {
    it('should call phases in order: load → gather → prompt → reason → validate → act → save', async () => {
      const callOrder = [];

      class TestAssignment extends Assignment {
        static id = 'test-assignment';

        async gather({ tools, userId, memory }) {
          callOrder.push('gather');
          return { data: 'gathered' };
        }

        buildPrompt(gathered, memory) {
          callOrder.push('buildPrompt');
          return `Process: ${JSON.stringify(gathered)}`;
        }

        getOutputSchema() {
          return { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] };
        }

        async validate(raw) {
          callOrder.push('validate');
          return raw.output;
        }

        async act(validated, { memory }) {
          callOrder.push('act');
          memory.set('acted', true);
        }
      }

      const mockMemoryState = new WorkingMemoryState();
      const mockWorkingMemory = {
        load: async () => { callOrder.push('load'); return mockMemoryState; },
        save: async () => { callOrder.push('save'); },
      };

      const mockRuntime = {
        execute: async ({ input }) => {
          callOrder.push('reason');
          return { output: { result: 'done' }, toolCalls: [] };
        },
      };

      const assignment = new TestAssignment();
      await assignment.execute({
        agentRuntime: mockRuntime,
        workingMemory: mockWorkingMemory,
        tools: [],
        systemPrompt: 'test',
        agentId: 'test-agent',
        userId: 'kevin',
        context: {},
        logger: { info: () => {} },
      });

      assert.deepStrictEqual(callOrder, ['load', 'gather', 'buildPrompt', 'reason', 'validate', 'act', 'save']);
    });

    it('should pass gathered data to buildPrompt', async () => {
      let capturedGathered;

      class TestAssignment extends Assignment {
        static id = 'test';
        async gather() { return { items: [1, 2, 3] }; }
        buildPrompt(gathered) { capturedGathered = gathered; return 'prompt'; }
        getOutputSchema() { return { type: 'object' }; }
        async validate(raw) { return raw.output; }
        async act() {}
      }

      const assignment = new TestAssignment();
      await assignment.execute({
        agentRuntime: { execute: async () => ({ output: {}, toolCalls: [] }) },
        workingMemory: {
          load: async () => new WorkingMemoryState(),
          save: async () => {},
        },
        tools: [],
        systemPrompt: '',
        agentId: 'test',
        userId: 'user',
        context: {},
        logger: { info: () => {} },
      });

      assert.deepStrictEqual(capturedGathered, { items: [1, 2, 3] });
    });

    it('should save memory after act phase', async () => {
      let savedState;

      class TestAssignment extends Assignment {
        static id = 'test';
        async gather() { return {}; }
        buildPrompt() { return 'prompt'; }
        getOutputSchema() { return { type: 'object' }; }
        async validate(raw) { return raw.output; }
        async act(validated, { memory }) {
          memory.set('written_in_act', 'yes');
        }
      }

      const assignment = new TestAssignment();
      await assignment.execute({
        agentRuntime: { execute: async () => ({ output: {}, toolCalls: [] }) },
        workingMemory: {
          load: async () => new WorkingMemoryState(),
          save: async (agentId, userId, state) => { savedState = state; },
        },
        tools: [],
        systemPrompt: '',
        agentId: 'test',
        userId: 'user',
        context: {},
        logger: { info: () => {} },
      });

      assert.strictEqual(savedState.get('written_in_act'), 'yes');
    });
  });
});
