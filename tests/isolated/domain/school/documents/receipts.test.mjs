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
  const sections = [
    {
      subject: 'math',
      servedToday: false,
      progressLabel: 'Unit 2 of 4',
      gradePercent: 88,
      next: { title: 'Unit Two', token: 'sch:AAAA', actionLabel: 'watch it' },
    },
    {
      subject: 'language',
      servedToday: true,
      progressLabel: 'Day 61',
    },
  ];
  const tokensBySubject = { math: 'sch:AAAA' };

  it('is a valid receipt-target document', () => {
    valid(agendaDocument({ learnerId: 'kid1', generatedAt: '2026-07-27T09:00:00.000Z', sections, tokensBySubject }));
  });

  it('emits one block sequence per section, in order', () => {
    const doc = agendaDocument({
      learnerId: 'kid1', learnerName: 'Kid One', generatedAt: '2026-07-27T09:00:00.000Z', sections, tokensBySubject,
    });
    expect(doc.blocks.map((b) => b.type)).toEqual([
      'rich_text', // printed at
      'rich_text', // ## MATH — Unit 2 of 4
      'rich_text', // Grade so far: 88%
      'scan_action', // math's next, tokened
      'rich_text', // ## LANGUAGE — done today
      'rich_text', // footer
    ]);
  });

  // The name is the document TITLE (the renderers' standard-header banner),
  // never a text block — a markdown heading cannot ask for the inverted band.
  // A raw id in the masthead is an accidental insult (design audit): no
  // resolvable display name means we GREET, we never echo the learner id.
  it('carries the learner name as the document title, preferring the display name', () => {
    expect(agendaDocument({ learnerId: 'kid1', learnerName: 'Kid One', sections, tokensBySubject }).title).toBe('Kid One');
    expect(agendaDocument({ learnerId: 'kid1', sections, tokensBySubject }).title).toBe('Hello!');
    expect(agendaDocument({ sections: [] }).title).toBe('Hello!');
    expect(textOf(agendaDocument({ learnerId: 'kid1', learnerName: 'Kid One', sections, tokensBySubject })))
      .not.toContain('# Kid One');
  });

  it('titles the empty agenda too', () => {
    expect(valid(agendaDocument({ learnerId: 'kid1', learnerName: 'Kid One', sections: [] })).title).toBe('Kid One');
    expect(valid(agendaDocument({ learnerId: 'kid1', sections: [] })).title).toBe('Hello!');
  });

  it('never prints the checkmark glyph — escposEncode silently drops non-cp858 chars', () => {
    const doc = agendaDocument({ learnerId: 'kid1', sections, tokensBySubject });
    const allMd = doc.blocks.filter((b) => b.type === 'rich_text').map((b) => b.md).join('\n');
    expect(allMd).not.toContain('✓');
  });

  it('uppercases the subject and marks a served section done today', () => {
    const text = textOf(agendaDocument({ learnerId: 'kid1', sections, tokensBySubject }));
    expect(text).toContain('## LANGUAGE — done today');
  });

  it('ignores progressLabel for a served section (done today wins)', () => {
    const text = textOf(agendaDocument({ learnerId: 'kid1', sections, tokensBySubject }));
    expect(text).not.toContain('Day 61');
  });

  it('prints the progress label for a live (not-yet-served) section', () => {
    const text = textOf(agendaDocument({ learnerId: 'kid1', sections, tokensBySubject }));
    expect(text).toContain('## MATH — Unit 2 of 4');
  });

  it('prints the grade only when gradePercent is not null', () => {
    const withGrade = textOf(agendaDocument({ learnerId: 'kid1', sections, tokensBySubject }));
    expect(withGrade).toContain('Grade so far: 88%');

    const noGrade = textOf(agendaDocument({
      learnerId: 'kid1', tokensBySubject, sections: [{ subject: 'math', servedToday: false, next: { title: 'Unit Two', token: 'sch:AAAA' } }],
    }));
    expect(noGrade).not.toContain('Grade so far');
  });

  it('composes a scan_action label as "title — actionLabel", carries the opaque token, and names the subject icon', () => {
    const doc = agendaDocument({ learnerId: 'kid1', sections, tokensBySubject });
    expect(actionsOf(doc)).toEqual([{ type: 'scan_action', action: 'sch:AAAA', label: 'Unit Two — watch it', icon: 'math' }]);
  });

  it('prints an untokened next as plain text rather than a bare scan action', () => {
    const doc = agendaDocument({
      learnerId: 'kid1',
      sections: [{ subject: 'science', servedToday: false, next: { title: 'Turn it in', actionLabel: 'hand it to a grown-up' } }],
      tokensBySubject: {},
    });
    expect(actionsOf(doc)).toEqual([]);
    expect(textOf(doc)).toContain('Turn it in — hand it to a grown-up');
  });

  it('prints a locked section WITH its remedy rather than hiding it', () => {
    const doc = agendaDocument({
      learnerId: 'kid1',
      sections: [{ subject: 'math', servedToday: false, lockedRemedy: 'Finish “Unit One” first' }],
      tokensBySubject: {},
    });
    expect(textOf(doc)).toContain('Finish “Unit One” first');
  });

  it('says the program is not answering rather than nothing at all', () => {
    const doc = agendaDocument({
      learnerId: 'kid1',
      sections: [{ subject: 'reading', servedToday: false, programUnavailable: true }],
      tokensBySubject: {},
    });
    expect(textOf(doc)).toContain('Not answering right now — try it on the Portal.');
  });

  it('says something useful when nothing is assigned', () => {
    const doc = valid(agendaDocument({ learnerId: 'kid1', sections: [] }));
    expect(textOf(doc)).toContain('Nothing is assigned');
  });

  // A raw ISO timestamp is machine notation on a child's piece of paper.
  it('prints the time a person can read, not an ISO timestamp', () => {
    const text = textOf(agendaDocument({ learnerId: 'kid1', generatedAt: '2026-07-27T09:05:00.000Z', sections: [] }));
    expect(text).not.toContain('2026-07-27T09:05:00.000Z');
    expect(text).toContain('Printed Mon 27 Jul, 9:05 am');
  });

  it('prints midnight and noon as a person says them', () => {
    const at = (iso) => textOf(agendaDocument({ learnerId: 'kid1', generatedAt: iso, sections: [] }));
    expect(at('2026-07-27T00:00:00.000Z')).toContain('Printed Mon 27 Jul, 12:00 am');
    expect(at('2026-07-27T12:30:00.000Z')).toContain('Printed Mon 27 Jul, 12:30 pm');
    expect(at('2026-07-27T13:07:00.000Z')).toContain('Printed Mon 27 Jul, 1:07 pm');
  });

  it('renders the time in the timezone it was handed', () => {
    const text = textOf(agendaDocument({
      learnerId: 'kid1', generatedAt: '2026-07-27T09:05:00.000Z', timeZone: 'America/Denver', sections: [],
    }));
    expect(text).toContain('Printed Mon 27 Jul, 3:05 am');
  });

  it('says nothing at all rather than printing "Invalid Date"', () => {
    expect(textOf(agendaDocument({ learnerId: 'kid1', generatedAt: 'yesterday', sections: [] })))
      .not.toMatch(/Printed/);
  });

  it('derives a stable id from the learner', () => {
    expect(agendaDocument({ learnerId: 'KC_Kern' }).id).toBe('agenda-kc-kern');
  });

  it('regenerates byte-identically', () => {
    const args = { learnerId: 'kid1', generatedAt: '2026-07-27T09:00:00.000Z', sections, tokensBySubject };
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
