import { describe, expect, it, vi } from 'vitest';
import { runOps } from './ops.mjs';

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status, statusText: '', json: async () => body,
});

describe('school ops', () => {
  it('aggregates completion, assignment, and today sessions for diagnosis', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/completion')) return response({ state: 'indeterminate', faults: [{ reason: 'plan_error' }] });
      if (url.includes('/assignments/')) return response({ learnerId: 'milo', programs: [] });
      return response({ sessions: [] });
    });
    let output = '';
    await runOps({ argv: ['status', 'milo', '--base-url', 'http://school'], fetchImpl, stdout: { write: (s) => { output += s; } } });
    expect(JSON.parse(output).completion.state).toBe('indeterminate');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps enrollment dry-run by default and redacts the PIN', async () => {
    const fetchImpl = vi.fn(async () => response({ learnerId: 'milo', updatedAt: 'v1' }));
    let output = '';
    await runOps({
      argv: ['rematerialize', 'milo', '--syllabus', 'cfm-lower', '--teacher', 'dad', '--pin-env', 'PIN'],
      fetchImpl, env: { PIN: '7410' }, stdout: { write: (s) => { output += s; } },
    });
    expect(output).toContain('"dryRun": true');
    expect(output).not.toContain('7410');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
