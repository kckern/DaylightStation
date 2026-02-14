// backend/tests/unit/agents/framework/ToolFactory.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ToolFactory } from '../../../../src/3_applications/agents/framework/ToolFactory.mjs';
import { createTool } from '../../../../src/3_applications/agents/ports/ITool.mjs';

describe('ToolFactory', () => {
  it('should throw if createTools is not implemented', () => {
    const factory = new ToolFactory({});
    assert.throws(
      () => factory.createTools(),
      /Subclass must implement/
    );
  });

  it('should allow subclass to create tools from deps', () => {
    class TestToolFactory extends ToolFactory {
      static domain = 'test';

      createTools() {
        return [
          createTool({
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
            execute: async () => ({ result: this.deps.mockValue }),
          }),
        ];
      }
    }

    const factory = new TestToolFactory({ mockValue: 42 });
    const tools = factory.createTools();

    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].name, 'test_tool');
  });

  it('should expose static domain on subclass', () => {
    class HealthFactory extends ToolFactory {
      static domain = 'health';
      createTools() { return []; }
    }

    assert.strictEqual(HealthFactory.domain, 'health');
  });

  it('should pass deps through to tool execute functions', async () => {
    class ServiceFactory extends ToolFactory {
      static domain = 'service';

      createTools() {
        const { myService } = this.deps;
        return [
          createTool({
            name: 'call_service',
            description: 'Calls a service',
            parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
            execute: async ({ input }) => myService.process(input),
          }),
        ];
      }
    }

    const mockService = { process: (x) => `processed: ${x}` };
    const factory = new ServiceFactory({ myService: mockService });
    const tools = factory.createTools();
    const result = await tools[0].execute({ input: 'hello' });

    assert.strictEqual(result, 'processed: hello');
  });
});
