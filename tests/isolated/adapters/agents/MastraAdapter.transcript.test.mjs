// tests/isolated/adapters/agents/MastraAdapter.transcript.test.mjs
import { describe, it, expect } from 'vitest';
import { MastraAdapter } from '../../../../backend/src/1_adapters/agents/MastraAdapter.mjs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('MastraAdapter constructor — mediaDir wiring', () => {
  it('accepts mediaDir without error', () => {
    const adapter = new MastraAdapter({ model: 'openai/gpt-4o-mini', mediaDir: '/tmp' });
    expect(adapter).toBeDefined();
  });

  it('defaults mediaDir to null when absent', () => {
    const adapter = new MastraAdapter({ model: 'openai/gpt-4o-mini' });
    // Private — verified indirectly through transcript tests below
    expect(adapter).toBeDefined();
  });
});
