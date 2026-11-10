// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { printSessionSheet, PRINT_RESULTS } from "./printSessionSheet.mjs";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const issuing = (status) => ({ execute: async ({ sessionId }) => ({ status, sessionId, message: 'Scan it.' }) });

describe('printSessionSheet sentence overrides', () => {
  it('keeps the keypad wording by default', async () => {
    const answer = await printSessionSheet({ issueDocument: issuing('already_done'), sessionId: 'ses_1', logger: silent });
    expect(answer).toMatchObject({ outcome: 'refused', sentence: PRINT_RESULTS.already_done.sentence });
    expect(answer.sentence).toMatch(/Type your code again/);
  });

  it('replaces only the named rows, never their outcomes', async () => {
    const sentences = { already_done: 'That one is finished. Tap again to see what is next.' };
    const done = await printSessionSheet({ issueDocument: issuing('already_done'), sessionId: 'ses_1', logger: silent, sentences });
    expect(done).toMatchObject({ outcome: 'refused', sentence: sentences.already_done });
    const failed = await printSessionSheet({ issueDocument: issuing('print_failed'), sessionId: 'ses_1', logger: silent, sentences });
    expect(failed).toMatchObject({ outcome: 'failed', sentence: PRINT_RESULTS.print_failed.sentence });
  });
});
