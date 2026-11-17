import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reserveKnowledgeAttempt, outsideKnowledgeDirectory } from './KnowledgeAttemptBudget.mjs';
it('shares the four-attempt local-day budget across restart and phase-zero receipt names', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-budget-'));
  try {
    const data = path.join(root, 'data'),
      usage = path.join(root, 'usage');
    fs.mkdirSync(data);
    fs.mkdirSync(usage);
    expect(outsideKnowledgeDirectory(usage, data)).toBe(usage);
    expect(() => outsideKnowledgeDirectory(data, data)).toThrow(/outside/i);
    const input = {
      dir: usage,
      username: 'sample',
      timezone: 'America/Los_Angeles',
      now: Date.parse('2026-11-02T07:30Z')
    };
    for (let i = 0; i < 4; i++) reserveKnowledgeAttempt(input);
    expect(() => reserveKnowledgeAttempt(input)).toThrow(/exhausted/i);
    expect(fs.readdirSync(usage).every(name => /^knowledge-budget-[a-f0-9]{24}-2026-11-01-[1-4]\.json$/.test(name))).toBe(true);
    reserveKnowledgeAttempt({
      ...input,
      now: Date.parse('2026-11-02T08:01Z')
    });
    expect(fs.readdirSync(usage)).toHaveLength(5);
    expect(fs.readdirSync(data)).toEqual([]);
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
