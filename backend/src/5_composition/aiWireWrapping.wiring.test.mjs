/**
 * Guard: every AI provider adapter app.mjs constructs is wrapped in the
 * structured wire layer, and the integration loader is handed the hook.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const app = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'app.mjs'), 'utf8');

describe('AI wire layer wiring', () => {
  it('wraps every new OpenAIAdapter / AnthropicAdapter in app.mjs', () => {
    const ctors = [...app.matchAll(/new\s+(OpenAIAdapter|AnthropicAdapter)\s*\(/g)];
    expect(ctors.length).toBeGreaterThan(0);
    for (const m of ctors) {
      expect(app.slice(Math.max(0, m.index - 20), m.index)).toMatch(/wrapAiWire\(\s*$/);
    }
  });
  it('hands decorateAdapter to loadHouseholdIntegrations', () => {
    expect(app).toMatch(/loadHouseholdIntegrations\(\{[\s\S]*?decorateAdapter[\s\S]*?\}\)/);
  });
});
