import { describe, it, expect, vi } from 'vitest';
import { applyDecorators } from './applyDecorators.mjs';

function makeTool(name) {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object' },
    execute: vi.fn(async () => ({ ok: true })),
  };
}

describe('applyDecorators', () => {
  it('returns tools unchanged when decorators array is empty', () => {
    const tools = [makeTool('a'), makeTool('b')];
    const wrapped = applyDecorators(tools, [], {});
    expect(wrapped).toHaveLength(2);
    expect(wrapped[0].name).toBe('a');
  });

  it('applies a single decorator to each tool', () => {
    const tagger = (tool) => ({ ...tool, name: `tagged:${tool.name}` });
    const wrapped = applyDecorators([makeTool('a'), makeTool('b')], [tagger], {});
    expect(wrapped[0].name).toBe('tagged:a');
    expect(wrapped[1].name).toBe('tagged:b');
  });

  it('composes decorators left-to-right (outermost runs first)', async () => {
    const order = [];
    const decoratorA = (tool) => ({
      ...tool,
      execute: async (args, ctx) => {
        order.push('A:before');
        const r = await tool.execute(args, ctx);
        order.push('A:after');
        return r;
      },
    });
    const decoratorB = (tool) => ({
      ...tool,
      execute: async (args, ctx) => {
        order.push('B:before');
        const r = await tool.execute(args, ctx);
        order.push('B:after');
        return r;
      },
    });
    const tool = makeTool('t');
    const [wrapped] = applyDecorators([tool], [decoratorA, decoratorB], {});
    await wrapped.execute({});
    expect(order).toEqual(['A:before', 'B:before', 'B:after', 'A:after']);
  });

  it('passes context to every decorator', () => {
    const ctx = { userId: 'kc', transcript: { recordTool() {} } };
    const seen = [];
    const recorder = (tool, context) => {
      seen.push(context);
      return tool;
    };
    applyDecorators([makeTool('a'), makeTool('b')], [recorder], ctx);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(ctx);
    expect(seen[1]).toBe(ctx);
  });

  it('does not mutate the input tools array', () => {
    const tools = [makeTool('a')];
    const original = tools.slice();
    const tagger = (tool) => ({ ...tool, tagged: true });
    applyDecorators(tools, [tagger], {});
    expect(tools).toEqual(original);
  });
});
