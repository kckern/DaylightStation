// backend/tests/unit/agents/framework/OutputValidator.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { OutputValidator } from '../../../../src/3_applications/agents/framework/OutputValidator.mjs';

const testSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    score: { type: 'number' },
  },
  required: ['title', 'score'],
};

describe('OutputValidator', () => {
  describe('validate', () => {
    it('should return valid for correct object', () => {
      const result = OutputValidator.validate({ title: 'test', score: 5 }, testSchema);
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.data, { title: 'test', score: 5 });
      assert.deepStrictEqual(result.errors, []);
    });

    it('should return valid for correct JSON string', () => {
      const result = OutputValidator.validate('{"title":"test","score":5}', testSchema);
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.data, { title: 'test', score: 5 });
    });

    it('should return invalid for missing required field', () => {
      const result = OutputValidator.validate({ title: 'test' }, testSchema);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.data, null);
      assert.ok(result.errors.length > 0);
    });

    it('should return invalid for wrong type', () => {
      const result = OutputValidator.validate({ title: 'test', score: 'not a number' }, testSchema);
      assert.strictEqual(result.valid, false);
    });

    it('should return invalid for unparseable string', () => {
      const result = OutputValidator.validate('not json at all', testSchema);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].message.includes('not valid JSON'));
    });
  });

  describe('validateWithRetry', () => {
    it('should return valid on first try if output is correct', async () => {
      const result = await OutputValidator.validateWithRetry(
        { title: 'test', score: 5 },
        testSchema,
        { agentRuntime: null, systemPrompt: '', tools: [], logger: null }
      );
      assert.strictEqual(result.valid, true);
    });

    it('should retry and succeed when LLM corrects output', async () => {
      let callCount = 0;
      const mockRuntime = {
        execute: async () => {
          callCount++;
          return { output: { title: 'fixed', score: 10 } };
        },
      };

      const result = await OutputValidator.validateWithRetry(
        { title: 'test' },
        testSchema,
        { agentRuntime: mockRuntime, systemPrompt: 'fix it', tools: [], maxRetries: 2, logger: null }
      );

      assert.strictEqual(result.valid, true);
      assert.strictEqual(callCount, 1);
      assert.deepStrictEqual(result.data, { title: 'fixed', score: 10 });
    });

    it('should return invalid after exhausting retries', async () => {
      const mockRuntime = {
        execute: async () => {
          return { output: { title: 'still broken' } };
        },
      };

      const result = await OutputValidator.validateWithRetry(
        { title: 'bad' },
        testSchema,
        { agentRuntime: mockRuntime, systemPrompt: '', tools: [], maxRetries: 2, logger: null }
      );

      assert.strictEqual(result.valid, false);
    });

    it('should not retry if maxRetries is 0', async () => {
      let callCount = 0;
      const mockRuntime = {
        execute: async () => { callCount++; return { output: {} }; },
      };

      await OutputValidator.validateWithRetry(
        { bad: true },
        testSchema,
        { agentRuntime: mockRuntime, systemPrompt: '', tools: [], maxRetries: 0, logger: null }
      );

      assert.strictEqual(callCount, 0);
    });
  });
});
