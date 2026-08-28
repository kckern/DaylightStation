/**
 * A finished day has to be SAID.
 *
 * `resultDocument` guarantees nobody is left holding paper with nothing to do
 * next, and it used to honour that with a single line — "Scan your card to see
 * what is next." That line is right when more work is waiting and wrong when
 * none is: on 2026-08-26 a learner passed the last lesson of his day and the
 * only instruction on his receipt sent him back to the card to look for
 * homework that did not exist.
 */
import { describe, it, expect } from 'vitest';
import { resultDocument } from '#domains/school/documents/receipts.mjs';

const lines = (doc) => doc.blocks.map((b) => b.md ?? '').join('\n');

describe('resultDocument day-complete acknowledgement', () => {
  it('says the day is over instead of sending the child back to the card', () => {
    const doc = resultDocument({
      sessionId: 'ses_1', unitTitle: 'Psalms 70-77', result: 'passed', dayComplete: true,
    });
    expect(lines(doc)).toContain('you are done for the day');
    expect(lines(doc)).not.toContain('Scan your card to see what is next.');
  });

  it('still sends them back to the card when the day is NOT complete', () => {
    const doc = resultDocument({
      sessionId: 'ses_1', unitTitle: 'Psalms 70-77', result: 'passed', dayComplete: false,
    });
    expect(lines(doc)).toContain('Scan your card to see what is next.');
    expect(lines(doc)).not.toContain('done for the day');
  });

  it('defaults to the old line, so an un-migrated caller cannot claim a finished day', () => {
    const doc = resultDocument({ sessionId: 'ses_1', unitTitle: 'X', result: 'passed' });
    expect(lines(doc)).toContain('Scan your card to see what is next.');
  });

  it('never displaces a real forward action — an offer outranks the acknowledgement', () => {
    // The invariant is about DEAD ENDS. If the receipt already carries
    // somewhere to go, neither line belongs on it.
    const doc = resultDocument({
      sessionId: 'ses_1',
      unitTitle: 'Psalms 70-77',
      result: 'passed',
      dayComplete: true,
      actions: [{
        token: 'tok_abc', label: 'South Dakota', presentation: 'lesson',
        eyebrow: 'Next up', title: 'South Dakota', description: 'Still to do today: civilization.',
      }],
    });
    expect(doc.blocks.some((b) => b.type === 'scan_action')).toBe(true);
    expect(lines(doc)).not.toContain('done for the day');
    expect(lines(doc)).not.toContain('Scan your card to see what is next.');
  });

  it('is not claimed on a failed result', () => {
    // A fail carries a retry ticket; "done for the day" would contradict it.
    const doc = resultDocument({
      sessionId: 'ses_1', unitTitle: 'Psalms 70-77', result: 'needs_remediation', dayComplete: false,
    });
    expect(lines(doc)).not.toContain('done for the day');
  });
});
