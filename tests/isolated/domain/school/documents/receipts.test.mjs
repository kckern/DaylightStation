import { describe, it, expect } from 'vitest';
import { agendaDocument, resultDocument, noticeDocument, slugify } from '#domains/school/documents/receipts.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';

const valid = (doc) => {
  const { errors } = validateDocument(doc);
  expect(errors).toEqual([]);
  return doc;
};

const actionsOf = (doc) => doc.blocks.filter((b) => b.type === 'scan_action');
const textOf = (doc) => doc.blocks.filter((b) => b.type === 'rich_text').map((b) => b.md).join('\n');

describe('slugify', () => {
  it('makes a document-legal id out of anything', () => {
    expect(slugify('KC_Kern')).toBe('kc-kern');
    expect(slugify('out:ses_a1')).toBe('out-ses-a1');
    expect(slugify('___', 'fallback')).toBe('fallback');
    expect(slugify(undefined, 'fallback')).toBe('fallback');
  });
});

describe('agendaDocument', () => {
  const entries = [
    { unitId: 'math-fractions.01', title: 'Unit One', status: 'available', token: 'sch:AAAA', actionLabel: 'Unit One — watch it' },
    { unitId: 'math-fractions.02', title: 'Unit Two', status: 'locked', lockReason: 'Finish “Unit One” first' },
  ];

  it('is a valid receipt-target document', () => {
    valid(agendaDocument({ learnerId: 'kid1', generatedAt: '2026-07-27T09:00:00.000Z', entries }));
  });

  it('prints one scan action per offered choice, carrying the opaque token', () => {
    const doc = agendaDocument({ learnerId: 'kid1', entries });
    expect(actionsOf(doc)).toEqual([{ type: 'scan_action', action: 'sch:AAAA', label: 'Unit One — watch it' }]);
  });

  it('prints a locked entry WITH its remedy rather than hiding it', () => {
    expect(textOf(agendaDocument({ learnerId: 'kid1', entries }))).toContain('Finish “Unit One” first');
  });

  it('says something useful when nothing is assigned', () => {
    const doc = valid(agendaDocument({ learnerId: 'kid1', entries: [] }));
    expect(textOf(doc)).toContain('Nothing is assigned');
  });

  it('never leaves an untokened, unlocked entry as a bare title', () => {
    const doc = agendaDocument({ learnerId: 'kid1', entries: [{ unitId: 'u', title: 'Turn it in', status: 'in_progress' }] });
    expect(textOf(doc)).toContain('waiting on a grown-up');
  });

  // A raw ISO timestamp is machine notation on a child's piece of paper.
  it('prints the time a person can read, not an ISO timestamp', () => {
    const text = textOf(agendaDocument({ learnerId: 'kid1', generatedAt: '2026-07-27T09:05:00.000Z', entries }));
    expect(text).not.toContain('2026-07-27T09:05:00.000Z');
    expect(text).toContain('Printed Mon 27 Jul, 9:05 am');
  });

  it('prints midnight and noon as a person says them', () => {
    const at = (iso) => textOf(agendaDocument({ learnerId: 'kid1', generatedAt: iso, entries }));
    expect(at('2026-07-27T00:00:00.000Z')).toContain('Printed Mon 27 Jul, 12:00 am');
    expect(at('2026-07-27T12:30:00.000Z')).toContain('Printed Mon 27 Jul, 12:30 pm');
    expect(at('2026-07-27T13:07:00.000Z')).toContain('Printed Mon 27 Jul, 1:07 pm');
  });

  it('renders the time in the timezone it was handed', () => {
    const text = textOf(agendaDocument({
      learnerId: 'kid1', generatedAt: '2026-07-27T09:05:00.000Z', timeZone: 'America/Denver', entries,
    }));
    expect(text).toContain('Printed Mon 27 Jul, 3:05 am');
  });

  it('says nothing at all rather than printing "Invalid Date"', () => {
    expect(textOf(agendaDocument({ learnerId: 'kid1', generatedAt: 'yesterday', entries })))
      .not.toMatch(/Printed/);
  });

  it('derives a stable id from the learner', () => {
    expect(agendaDocument({ learnerId: 'KC_Kern' }).id).toBe('agenda-kc-kern');
  });

  it('regenerates byte-identically', () => {
    const args = { learnerId: 'kid1', generatedAt: '2026-07-27T09:00:00.000Z', entries };
    expect(JSON.stringify(agendaDocument(args))).toBe(JSON.stringify(agendaDocument(args)));
  });
});

describe('resultDocument', () => {
  const pass = { sessionId: 'ses_a', unitTitle: 'Unit Two', result: 'passed', percent: 83.4 };

  it('is a valid receipt-target document', () => {
    valid(resultDocument(pass));
  });

  it('prints the score rounded', () => {
    expect(textOf(resultDocument(pass))).toContain('83%');
  });

  it('prints coins only when coins were actually awarded', () => {
    expect(textOf(resultDocument({ ...pass, reward: { amount: 5 } }))).toContain('5 coins');
    expect(textOf(resultDocument({ ...pass, reward: { amount: 0 } }))).not.toContain('coin');
    expect(textOf(resultDocument(pass))).not.toContain('coin');
  });

  it('names the newly unlocked unit on a pass', () => {
    expect(textOf(resultDocument({ ...pass, unlockedTitle: 'Unit Three' }))).toContain('Next up: Unit Three');
  });

  it('lists objectives to revisit only on a fail', () => {
    const fail = { sessionId: 'ses_a', unitTitle: 'Unit Two', result: 'needs_remediation', percent: 50, objectives: ['Common denominators'] };
    expect(textOf(resultDocument(fail))).toContain('Common denominators');
    expect(textOf(resultDocument({ ...pass, objectives: ['Common denominators'] }))).not.toContain('Common denominators');
  });

  it('prints the retry action as an opaque token', () => {
    const doc = resultDocument({
      sessionId: 'ses_a', unitTitle: 'Unit Two', result: 'needs_remediation',
      actions: [{ token: 'sch:RETRY', label: 'Try again with a fresh sheet' }],
    });
    expect(actionsOf(doc)).toEqual([{ type: 'scan_action', action: 'sch:RETRY', label: 'Try again with a fresh sheet' }]);
  });

  it('always leaves a next move even with no actions at all', () => {
    expect(textOf(resultDocument(pass))).toContain('Scan your card');
  });
});

describe('noticeDocument', () => {
  it('is a valid receipt-target document', () => {
    valid(noticeDocument({ id: 'unknown-token', headline: 'We do not know that ticket', lines: ['Scan your card for a new list.'] }));
  });

  it('never prints a headline with nothing after it', () => {
    expect(textOf(noticeDocument({ headline: 'Hmm' }))).toContain('Scan your card');
  });

  it('carries a recovery action when one is offered', () => {
    const doc = noticeDocument({ id: 'print-failed', headline: 'The printer is not answering', actions: [{ token: 'sch:REC', label: 'Try printing again' }] });
    expect(actionsOf(doc)).toHaveLength(1);
  });
});
