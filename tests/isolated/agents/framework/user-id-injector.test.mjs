import { describe, it, expect } from 'vitest';
import { userIdInjector, stripUserIdFromSchema } from '#apps/agents/framework/decorators/UserIdInjector.mjs';

describe('userIdInjector', () => {
  it('strips userId from the schema so the model cannot supply it', () => {
    const schema = { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' } }, required: ['userId', 'name'] };
    const out = stripUserIdFromSchema(schema);
    expect(out.properties.userId).toBeUndefined();
    expect(out.required).toEqual(['name']);
  });

  it('injects context.userId into the execute args', async () => {
    let received;
    const tool = { name: 't', parameters: { type: 'object', properties: { userId: {} }, required: ['userId'] }, execute: async (args) => { received = args; return 'ok'; } };
    const wrapped = userIdInjector(tool, { userId: 'maya' });
    await wrapped.execute({});
    expect(received.userId).toBe('maya');
  });
});
