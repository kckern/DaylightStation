import { describe, it, expect } from 'vitest';
import { agendaDocument, resultDocument, noticeDocument, slugify } from '#domains/school/documents/receipts.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';

const valid = (doc) => {
  const { errors } = validateDocument(doc);
  expect(errors).toEqual([]);
  return doc;
};

const actionsOf = (doc) => doc.blocks.filter((b) => b.type === 'scan_action');
const summaryOf = (doc) => doc.blocks.find((b) => b.type === 'result_summary');
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
      'scan_action', // math's next, tokened
      'rich_text', // ## LANGUAGE — done today
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
    const action = actionsOf(agendaDocument({ learnerId: 'kid1', sections, tokensBySubject }))[0];
    expect(action.meta).toContain('Unit 2 of 4');
  });

  it('prints the grade only when gradePercent is not null', () => {
    const withGrade = actionsOf(agendaDocument({ learnerId: 'kid1', sections, tokensBySubject }))[0];
    expect(withGrade.meta).toContain('Grade 88%');

    const noGrade = agendaDocument({
      learnerId: 'kid1', tokensBySubject, sections: [{ subject: 'math', servedToday: false, next: { title: 'Unit Two', token: 'sch:AAAA' } }],
    });
    expect(actionsOf(noGrade)[0].meta).toBe('SCAN TO PRINT');
  });

  it('uses the shared QR-left lesson card without exposing or repeating the token', () => {
    const doc = agendaDocument({ learnerId: 'kid1', sections, tokensBySubject });
    expect(actionsOf(doc)[0]).toMatchObject({
      type: 'scan_action', action: 'sch:AAAA', label: 'Unit Two', icon: 'math',
      eyebrow: 'Today · math', presentation: 'lesson', hideCode: true,
    });
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
    expect(text).toContain('Mon 27 Jul, 9:05 am');
  });

  it('prints midnight and noon as a person says them', () => {
    const at = (iso) => textOf(agendaDocument({ learnerId: 'kid1', generatedAt: iso, sections: [] }));
    expect(at('2026-07-27T00:00:00.000Z')).toContain('Mon 27 Jul, 12:00 am');
    expect(at('2026-07-27T12:30:00.000Z')).toContain('Mon 27 Jul, 12:30 pm');
    expect(at('2026-07-27T13:07:00.000Z')).toContain('Mon 27 Jul, 1:07 pm');
  });

  it('renders the time in the timezone it was handed', () => {
    const text = textOf(agendaDocument({
      learnerId: 'kid1', generatedAt: '2026-07-27T09:05:00.000Z', timeZone: 'America/Denver', sections: [],
    }));
    expect(text).toContain('Mon 27 Jul, 3:05 am');
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

  /**
   * The panel access code (self-service). An agenda can carry TWO six-digit
   * codes on one page — the SchoolCalc study code, typed into a calculator,
   * and this one, typed into the school-room panel — so the only thing keeping
   * a child from typing one into the other device is how they are printed.
   */
  describe('the panel access code', () => {
    const args = { learnerId: 'kid1', generatedAt: '2026-07-27T09:00:00.000Z', sections, tokensBySubject };
    const calcSection = {
      subject: 'spelling',
      servedToday: false,
      next: { title: 'Set 4', schoolcalcHandoff: { eligible: true, displayCode: '001 234' } },
    };

    it('carries the panel code ON its scan_action, where it can only draw under that QR', () => {
      // It used to be a loose "PANEL CODE 481920" text block after the card,
      // which the canvas renderer drew adrift BELOW the box. Position under
      // the QR is now what identifies it, so the field is the assertion.
      const doc = agendaDocument({ ...args, accessCodesByToken: { 'sch:AAAA': '481920' } });
      const action = doc.blocks.find((b) => b.type === 'scan_action');
      expect(action.panelCode).toBe('481920');
      expect(JSON.stringify(doc.blocks)).not.toContain('Enter on calculator');
    });

    it('names a different device from the calculator code printed on the same page', () => {
      const text = textOf(agendaDocument({
        ...args, sections: [...sections, calcSection], accessCodesByToken: { 'sch:AAAA': '481920' },
      }));
      // The two codes are told apart by WHERE they sit, not by a label. The
      // calculator's is body text with its own instruction; the panel's rides
      // its scan_action and prints under that QR, so it never appears in the
      // block stream's words at all.
      const doc = agendaDocument({
        ...args, sections: [...sections, calcSection], accessCodesByToken: { 'sch:AAAA': '481920' },
      });
      expect(doc.blocks.find((b) => b.type === 'scan_action').panelCode).toBe('481920');
      expect(text).toContain('001 234');
      expect(text).toContain('Enter on calculator.');
      // No loose panel-code text anywhere to be confused with it.
      expect(text).not.toContain('PANEL CODE');
      expect(text).not.toContain('Type it on the school screen.');
    });

    it('is still a valid receipt-target document', () => {
      valid(agendaDocument({ ...args, accessCodesByToken: { 'sch:AAAA': '481920' } }));
    });

    // The safety property of the whole feature: self-service off is today,
    // byte for byte — no code claimed for a token means no code printed AND
    // no "scanning is the only way in" fallback either (Slice H's fallback
    // only fires when a caller EXPLICITLY marks a code as unavailable).
    it('changes nothing at all when no codes are supplied', () => {
      const today = JSON.stringify(agendaDocument(args));
      expect(JSON.stringify(agendaDocument({ ...args, accessCodesByToken: {} }))).toBe(today);
      expect(JSON.stringify(agendaDocument({ ...args, accessCodesByToken: undefined }))).toBe(today);
      expect(today).not.toContain('PANEL CODE');
      expect(today).not.toContain('Scanning is the only way in');
    });

    it('prints no panel code beside a calculator handoff — that subject is typed elsewhere', () => {
      const text = textOf(agendaDocument({
        ...args, sections: [calcSection], tokensBySubject: {}, accessCodesByToken: { 'sch:SPELL': '481920' },
      }));
      expect(text).not.toContain('481920');
      expect(text).toContain('Enter on calculator.');
    });

    it('ignores a code keyed to a token this section never mints — a code aliases a real token or nothing', () => {
      const doc = agendaDocument({
        learnerId: 'kid1',
        sections: [{ subject: 'science', servedToday: false, next: { title: 'Turn it in' } }],
        tokensBySubject: {},
        accessCodesByToken: { 'sch:NOT-ISSUED': '481920' },
      });
      expect(JSON.stringify(doc.blocks)).not.toContain('481920');
    });

    it('drops a malformed code rather than printing digits a child cannot type', () => {
      const flat = JSON.stringify(agendaDocument({ ...args, accessCodesByToken: { 'sch:AAAA': '4819' } }).blocks);
      expect(flat).not.toContain('PANEL CODE');
      expect(flat).not.toContain('4819');
      // A code that WAS claimed (even a malformed one) but could not be
      // printed still gets the explicit fallback — a missing code is
      // visible, never a silent gap (Slice H).
      expect(flat).toContain('Scanning is the only way in.');
    });

    it('two offers in different subjects each keep their OWN code — the old subject-keyed map could only ever hold one', () => {
      const doc = agendaDocument({
        learnerId: 'kid1',
        sections: [
          { subject: 'math', servedToday: false, next: { title: 'Unit Two' } },
          { subject: 'language', servedToday: false, next: { title: 'Chapter 4' } },
        ],
        tokensBySubject: { math: 'sch:AAAA', language: 'sch:BBBB' },
        accessCodesByToken: { 'sch:AAAA': '111111', 'sch:BBBB': '222222' },
      });
      expect(doc.blocks.filter((b) => b.type === 'scan_action').map((b) => b.panelCode))
        .toEqual(['111111', '222222']);
    });
  });

  describe('a QR with no code claims one is missing, never silently (Slice H, 2026-08-22)', () => {
    it('prints "Scanning is the only way in." when a caller explicitly checked and found no code', () => {
      const doc = agendaDocument({
        learnerId: 'kid1',
        sections: [{ subject: 'math', servedToday: false, next: { title: 'Unit Two' } }],
        tokensBySubject: { math: 'sch:AAAA' },
        accessCodesByToken: { 'sch:AAAA': null },
      });
      const flat = JSON.stringify(doc.blocks);
      expect(flat).not.toContain('PANEL CODE');
      expect(flat).toContain('Scanning is the only way in.');
    });
  });
});

describe('resultDocument', () => {
  const pass = { sessionId: 'ses_a', unitTitle: 'Unit Two', result: 'passed', percent: 83.4 };

  it('is a valid receipt-target document', () => {
    const doc = resultDocument(pass);
    valid(doc);
    expect(doc.title).toBe('Worksheet Result');
    expect(doc.id).toBe('result-ses-a');
  });

  it('makes the learner the receipt title while retaining the generic fallback', () => {
    expect(resultDocument({ ...pass, learnerName: 'Felix' }).title).toBe('Felix’s Result');
    expect(resultDocument(pass).title).toBe('Worksheet Result');
  });

  it('prints the score rounded', () => {
    expect(summaryOf(resultDocument(pass)).percent).toBe(83.4);
  });

  it('carries the separately formatted local time in the identity strip', () => {
    expect(summaryOf(resultDocument({ ...pass, date: '13 Aug 2026', time: '9:15 am' })))
      .toMatchObject({ date: '13 Aug 2026', time: '9:15 am' });
  });

  it('prints coins only when coins were actually awarded', () => {
    expect(textOf(resultDocument({ ...pass, reward: { amount: 5 } }))).toContain('5 coins');
    expect(textOf(resultDocument({ ...pass, reward: { amount: 0 } }))).not.toContain('coin');
    expect(textOf(resultDocument(pass))).not.toContain('coin');
  });

  it('names the newly unlocked unit on a pass', () => {
    const doc = resultDocument({
      ...pass, unlockedTitle: 'Unit Three',
      actions: [{ token: 'sch:NEXT', label: 'Unit Three', presentation: 'lesson', title: 'Unit Three' }],
    });
    expect(actionsOf(doc)[0]).toMatchObject({ eyebrow: 'Next up', label: 'Unit Three' });
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
