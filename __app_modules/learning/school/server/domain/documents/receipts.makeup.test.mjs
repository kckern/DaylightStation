import { describe, it, expect } from 'vitest';
import {
  agendaDocument, makeupDocument, makeupBySubject, makeupDueLine, makeupSummary, resultDocument,
} from "./receipts.mjs";
import { validateDocument } from "./documentValidation.mjs";

// Week Mon 2026-09-07 … Sat 09-12.
const MON = '2026-09-07'; const WED = '2026-09-09';
const ITEMS = [{ day: MON, subject: 'math' }, { day: WED, subject: 'english' }, { day: WED, subject: 'math' }];

const qrs = (doc) => doc.blocks.filter((b) => b.type === 'scan_action');

describe('makeup helpers', () => {
  it('groups by subject in the order first missed', () => {
    expect(makeupBySubject(ITEMS)).toEqual([
      { subject: 'math', days: [MON, WED] },
      { subject: 'english', days: [WED] },
    ]);
  });

  it('names the deadline weekday', () => {
    expect(makeupDueLine('2026-09-12')).toBe('Due Saturday night');
    expect(makeupDueLine(null)).toBe('Due this week');
  });

  it('summarises day and subject, oldest first', () => {
    expect(makeupSummary(ITEMS)).toBe('Mon Math, Wed English, Wed Math');
  });
});

describe('makeupDocument', () => {
  const doc = makeupDocument({
    learnerId: 'test-learner', learnerName: 'Test Learner',
    generatedAt: '2026-09-10T18:00:00.000Z', timeZone: 'UTC',
    items: ITEMS, deadline: '2026-09-12',
    tokensBySubject: { math: 'sch:MATHMATHMATH2222', english: 'sch:ENGLENGLENGL3333' },
    accessCodesByToken: { 'sch:MATHMATHMATH2222': '123456', 'sch:ENGLENGLENGL3333': '654321' },
  });

  it('validates as a document', () => {
    expect(() => validateDocument(doc)).not.toThrow();
    expect(doc.id).toBe('makeup-test-learner');
    expect(doc.title).toBe('Test Learner');
  });

  it('prints one card per subject, railed with its missed days', () => {
    const cards = qrs(doc);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      action: 'sch:MATHMATHMATH2222', label: 'Math', presentation: 'lesson',
      rail: 'Makeup · Mon, Wed', panelCode: '123456',
    });
    expect(cards[0].description).toMatch(/^Two lessons, for Mon and Wed\./);
    expect(cards[1]).toMatchObject({ label: 'English', rail: 'Makeup · Wed', panelCode: '654321' });
  });

  it('names the deadline at the top', () => {
    expect(doc.blocks.some((b) => b.type === 'rich_text' && b.md.startsWith('Due Saturday night.'))).toBe(true);
  });

  it('a subject with no ticket prints words, not a dead QR', () => {
    const bare = makeupDocument({ learnerId: 'kid', items: [{ day: MON, subject: 'math' }], deadline: '2026-09-12' });
    expect(qrs(bare)).toHaveLength(0);
    expect(() => validateDocument(bare)).not.toThrow();
  });
});

describe('agendaDocument makeup card', () => {
  const base = {
    learnerId: 'test-learner', learnerName: 'Test Learner',
    generatedAt: '2026-09-10T18:00:00.000Z', timeZone: 'UTC',
    sections: [{ subject: 'scripture', next: { unitId: 'u1', title: 'Psalms', actionLabel: 'scan to print' } }],
    tokensBySubject: { scripture: 'sch:TESTTESTTEST0001' },
  };

  it('absent makeup leaves the agenda byte-identical', () => {
    expect(JSON.stringify(agendaDocument({ ...base, makeup: null }))).toBe(JSON.stringify(agendaDocument(base)));
    expect(JSON.stringify(agendaDocument({ ...base, makeup: { token: 'sch:MAKEMAKEMAKE4444', items: [], deadline: null } })))
      .toBe(JSON.stringify(agendaDocument(base)));
  });

  it('adds one line and one plain QR naming the missed days', () => {
    const doc = agendaDocument({
      ...base,
      makeup: { token: 'sch:MAKEMAKEMAKE4444', accessCode: '777777', items: ITEMS.slice(0, 2), deadline: '2026-09-12' },
    });
    expect(() => validateDocument(doc)).not.toThrow();
    expect(doc.blocks.some((b) => b.md === 'Makeup work: Mon Math, Wed English. Due Saturday night.')).toBe(true);
    const card = qrs(doc).find((b) => b.action === 'sch:MAKEMAKEMAKE4444');
    expect(card).toEqual({
      type: 'scan_action', action: 'sch:MAKEMAKEMAKE4444', label: 'Scan to print your makeup sheet', panelCode: '777777',
    });
    expect(qrs(doc)).toHaveLength(2);
  });
});

const resultBase = { sessionId: 'ses_a', unitTitle: 'Check Subtraction with Addition', result: 'passed', percent: 100 };

describe('resultDocument makeup line', () => {
  it('names the day and subject a makeup pass counted for', () => {
    const doc = resultDocument({ ...resultBase, makeup: { forDay: '2026-11-18', subject: 'math' } });
    expect(doc.blocks[1]).toMatchObject({ type: 'rich_text', md: 'Makeup: this counts for Wednesday\'s math.' });
  });
  it('prints nothing extra for ordinary work or a fail', () => {
    expect(resultDocument(resultBase).blocks.some((b) => /Makeup/.test(b.md ?? ''))).toBe(false);
    expect(resultDocument({ ...resultBase, result: 'needs_remediation', makeup: { forDay: '2026-11-18', subject: 'math' } })
      .blocks.some((b) => /Makeup/.test(b.md ?? ''))).toBe(false);
  });
});
