import { describe, it, expect, vi } from 'vitest';
import { userIdInjector, stripUserIdFromSchema } from './UserIdInjector.mjs';

describe('stripUserIdFromSchema', () => {
  it('removes userId from properties', () => {
    const schema = {
      type: 'object',
      properties: { userId: { type: 'string' }, query: { type: 'string' } },
      required: ['userId', 'query'],
    };
    const result = stripUserIdFromSchema(schema);
    expect(result.properties).not.toHaveProperty('userId');
    expect(result.properties).toHaveProperty('query');
    expect(result.required).toEqual(['query']);
  });

  it('returns the schema unchanged when no userId', () => {
    const schema = { type: 'object', properties: { x: {} }, required: ['x'] };
    expect(stripUserIdFromSchema(schema)).toEqual(schema);
  });

  it('handles missing required array', () => {
    const schema = { type: 'object', properties: { userId: {} } };
    const result = stripUserIdFromSchema(schema);
    expect(result.properties).not.toHaveProperty('userId');
  });

  it('returns null/undefined unchanged', () => {
    expect(stripUserIdFromSchema(null)).toBe(null);
    expect(stripUserIdFromSchema(undefined)).toBe(undefined);
  });
});

describe('userIdInjector decorator', () => {
  function makeTool() {
    return {
      name: 'get_weight',
      description: 'Get user weight',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' }, date: { type: 'string' } },
        required: ['userId', 'date'],
      },
      execute: vi.fn(async (args) => ({ weight: 170, args })),
    };
  }

  it('strips userId from the wrapped tool parameters', () => {
    const wrapped = userIdInjector(makeTool(), { userId: 'kc' });
    expect(wrapped.parameters.properties).not.toHaveProperty('userId');
  });

  it('injects context.userId into args at execute time', async () => {
    const tool = makeTool();
    const wrapped = userIdInjector(tool, { userId: 'kc' });
    const result = await wrapped.execute({ date: '2026-05-06' });
    expect(tool.execute).toHaveBeenCalledWith(
      { date: '2026-05-06', userId: 'kc' },
      expect.objectContaining({ userId: 'kc' })
    );
    expect(result.args.userId).toBe('kc');
  });

  it('does not inject when context.userId is null', async () => {
    const tool = makeTool();
    const wrapped = userIdInjector(tool, { userId: null });
    await wrapped.execute({ date: '2026-05-06' });
    expect(tool.execute).toHaveBeenCalledWith(
      { date: '2026-05-06' },
      expect.anything()
    );
  });

  it('preserves other tool fields (name, description)', () => {
    const tool = makeTool();
    const wrapped = userIdInjector(tool, { userId: 'kc' });
    expect(wrapped.name).toBe('get_weight');
    expect(wrapped.description).toBe('Get user weight');
  });
});
