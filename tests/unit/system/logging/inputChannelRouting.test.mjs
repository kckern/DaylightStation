import { describe, it, expect } from 'vitest';
import { isInputChannel } from '../../../../backend/src/1_adapters/logging/FrontendLogIngestion.mjs';
describe('input channel routing predicate', () => {
  it('detects the input channel', () => {
    expect(isInputChannel({ context: { channel: 'input' } })).toBe(true);
    expect(isInputChannel({ context: { channel: 'logging' } })).toBe(false);
    expect(isInputChannel({ context: {} })).toBe(false);
    expect(isInputChannel({})).toBe(false);
  });
});
