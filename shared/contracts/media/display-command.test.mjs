import { describe, it, expect } from 'vitest';
import { isCommandKind } from './commands.mjs';
import { buildCommandEnvelope, validateCommandEnvelope } from './envelopes.mjs';

describe('display command kind', () => {
  it('isCommandKind recognizes display', () => {
    expect(isCommandKind('display')).toBe(true);
  });
  it('builds + validates a display envelope with contentId', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'living', command: 'display', commandId: 'c1',
      params: { contentId: 'art:classical-evening' },
    });
    expect(env.command).toBe('display');
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });
  it('rejects a display envelope missing contentId', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'living', command: 'display', commandId: 'c1', params: {},
    });
    const result = validateCommandEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/contentId/);
  });
});
