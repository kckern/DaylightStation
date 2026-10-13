import { describe, it, expect } from 'vitest';
import { readAiWireConfig } from './aiWireConfig.mjs';

describe('readAiWireConfig', () => {
  it('reads wire from the ai list entry', () => {
    expect(readAiWireConfig({ ai: [{ provider: 'openai', wire: { mode: 'full', sample: 0.5 } }] })).toEqual({ mode: 'full', sample: 0.5 });
  });
  it('defaults to off when absent, malformed or unknown', () => {
    expect(readAiWireConfig(null)).toEqual({ mode: 'off', sample: 1 });
    expect(readAiWireConfig({ ai: [{ provider: 'openai' }] })).toEqual({ mode: 'off', sample: 1 });
    expect(readAiWireConfig({ ai: [{ wire: { mode: 'toon-everything' } }] })).toEqual({ mode: 'off', sample: 1 });
  });
  it('clamps sample and accepts a single ai object', () => {
    expect(readAiWireConfig({ ai: { wire: { mode: 'input', sample: 7 } } })).toEqual({ mode: 'input', sample: 1 });
  });
});
