/**
 * Every feed puts paper in the child's hand (2026-09-15). The consumer's
 * panel ceremony already promised "never silence"; this suite holds the
 * same promise for the thermal printer — a non-graded outcome prints a slip
 * that says what the panel says, and a duplicate feed of a still-unfinished
 * card says "still not finished", never "nothing new".
 */
import { describe, it, expect } from 'vitest';
import { createSchoolPrintScanConsumer } from "./SchoolPrintScanConsumer.mjs";

const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

const row = (n, status, given = 'A') => ({ row: n, itemId: `q${n}`, itemType: 'multiple_choice', status, given: status === 'blank' ? null : given, points: 1, earned: status === 'correct' ? 1 : 0 });

/** The learner's card at 08:18: South Dakota rows 28-33, row 33 blank. */
const southDakota = () => ({
  cardId: '5278294', recordId: 'civilization/atlas/ws-ses-4jqdgpr5b3@ca29ac85c:v0:28-33',
  documentId: 'civilization/atlas/ws-ses-4jqdgpr5b3', rev: 'ca29ac85c', variant: 0, learnerId: 'user_4',
  sessionId: 'ses_4jqdgpr5b3', renderedAt: '2026-09-15T14:19:34.046Z', revisionSuperseded: false,
  results: [row(28, 'correct'), row(29, 'correct'), row(30, 'correct'), row(31, 'correct'), row(32, 'correct'), row(33, 'blank')],
  totalPoints: 6, earnedPoints: 5, unscannedItems: [],
});

function harness({ recordOutcome, card = southDakota }) {
  let handler = null;
  const spoken = [];
  const printed = [];
  const realtime = {
    onPrintSheet: (_config, cb) => { handler = cb; return () => {}; },
    printScanResolved: (announcement) => { spoken.push(announcement); },
  };
  const consumer = createSchoolPrintScanConsumer({
    realtime,
    resolveCardScan: { async execute() { return { results: [card()] }; } },
    recordCardScanOutcome: { async execute() { return recordOutcome(); } },
    receipts: { async print(document) { printed.push(document); return { printed: true, reason: null }; } },
    printDocuments: { getPublished: (id, rev) => ({
      'civilization/atlas/ws-ses-4jqdgpr5b3@ca29ac85c': { title: 'South Dakota' },
      'scripture/baptism-path/part-1@57124ce28': { title: 'Baptism 1/5 · Jesus Showed the Way' },
    }[`${id}@${rev}`] ?? null) },
    logger: { info() {}, warn() {}, debug() {}, error() {} },
  });
  return { consumer, spoken, printed, feed: async () => { handler({ testId: '5278294', answers: { 28: 'A' } }); await settle(); } };
}

const text = (doc) => doc.blocks.map((block) => block.md ?? '').join('\n');

describe('SchoolPrintScanConsumer — a slip for every non-graded feed', () => {
  it('prints "not finished yet" with the sheet title and the empty row on a partial scan', async () => {
    const { spoken, printed, feed } = harness({
      recordOutcome: () => ({ session: { reason: 'partial-scan', sessionId: 'ses_4jqdgpr5b3' } }),
    });
    await feed();
    expect(spoken.map((a) => a.kind)).toEqual(['scan-rows-incomplete']);
    expect(spoken[0]).toMatchObject({ title: 'South Dakota', answered: 5, total: 6, blankRows: [33], ambiguousRows: [] });
    expect(printed).toHaveLength(1);
    expect(text(printed[0])).toContain('SOUTH DAKOTA — NOT FINISHED YET');
    expect(text(printed[0])).toContain('Row 33 is still empty.');
  });

  it('prints "still not finished" on the duplicate feed, and tells the panel the same', async () => {
    const { spoken, printed, feed } = harness({
      recordOutcome: () => ({ recorded: false, reason: 'already-recorded' }),
    });
    await feed();
    expect(spoken.map((a) => a.kind)).toEqual(['scan-not-recorded']);
    expect(spoken[0].unfinished).toEqual([
      { title: 'South Dakota', answered: 5, total: 6, blankRows: [33], ambiguousRows: [] },
    ]);
    expect(printed).toHaveLength(1);
    expect(text(printed[0])).toContain('STILL NOT FINISHED');
    expect(text(printed[0])).toContain('Row 33 is still empty.');
    expect(text(printed[0])).not.toMatch(/nothing new/i);
  });

  it('prints no slip for a graded sheet — its receipt already came out', async () => {
    const { spoken, printed, feed } = harness({
      recordOutcome: () => ({ session: { advancedTo: 'graded', sessionId: 'ses_4jqdgpr5b3', percent: 100, correctCount: 6, totalCount: 6 } }),
    });
    await feed();
    expect(spoken.map((a) => a.kind)).toEqual(['scan-graded']);
    expect(printed).toHaveLength(0);
  });

  it('still speaks to the panel when no receipt printer is wired', async () => {
    let handler = null;
    const spoken = [];
    createSchoolPrintScanConsumer({
      realtime: { onPrintSheet: (_c, cb) => { handler = cb; return () => {}; }, printScanResolved: (a) => spoken.push(a) },
      resolveCardScan: { async execute() { return { results: [southDakota()] }; } },
      recordCardScanOutcome: { async execute() { return { session: { reason: 'partial-scan', sessionId: 's' } }; } },
      logger: { info() {}, warn() {}, debug() {}, error() {} },
    });
    handler({ testId: '5278294', answers: {} });
    await settle();
    expect(spoken.map((a) => a.kind)).toEqual(['scan-rows-incomplete']);
  });

  // 2026-10-10: a sheet printed straight from /print/render has no lesson
  // session. A child's first feed of a 10/10 sheet printed "NOTHING NEW TO
  // MARK … everything on it was already marked".
  describe('a sheet with no session behind it', () => {
    const baptism = ({ learnerId = null, statuses = Array(10).fill('correct') } = {}) => () => ({
      cardId: '5705644', recordId: 'scripture/baptism-path/part-1@57124ce28:v0:1-10',
      documentId: 'scripture/baptism-path/part-1', rev: '57124ce28', variant: 0, learnerId,
      renderedAt: '2026-10-10T04:07:03.422Z', revisionSuperseded: false,
      results: statuses.map((status, i) => row(i + 1, status)),
      totalPoints: 10, earnedPoints: statuses.filter((s) => s === 'correct').length, unscannedItems: [],
    });

    it('prints the score for an anonymous sheet, never "nothing new"', async () => {
      const { spoken, printed, feed } = harness({
        card: baptism(), recordOutcome: () => ({ recorded: false, reason: 'unattributed' }),
      });
      await feed();
      expect(spoken.map((a) => a.kind)).toEqual(['scan-scored']);
      expect(spoken[0]).toMatchObject({ correctCount: 10, totalCount: 10, missedRows: [] });
      expect(printed).toHaveLength(1);
      expect(text(printed[0])).toContain('BAPTISM 1/5 · JESUS SHOWED THE WAY — 10 / 10');
      expect(text(printed[0])).not.toMatch(/nothing new|already marked/i);
    });

    it('prints the score for a learner-bound sheet that was recorded without a session', async () => {
      const statuses = Array(10).fill('correct');
      statuses[2] = 'incorrect';
      statuses[6] = 'incorrect';
      const { spoken, printed, feed } = harness({
        card: baptism({ learnerId: 'learner2', statuses }), recordOutcome: () => ({ recorded: true, attemptIds: ['a'] }),
      });
      await feed();
      expect(spoken.map((a) => a.kind)).toEqual(['scan-scored']);
      expect(spoken[0]).toMatchObject({ learnerId: 'learner2', correctCount: 8, totalCount: 10, missedRows: [3, 7] });
      expect(text(printed[0])).toContain('— 8 / 10');
      expect(text(printed[0])).toContain('Look again at rows 3 and 7.');
    });

    it('says "not finished yet" when an anonymous sheet has an empty row', async () => {
      const statuses = Array(10).fill('correct');
      statuses[9] = 'blank';
      const { spoken, printed, feed } = harness({
        card: baptism({ statuses }), recordOutcome: () => ({ recorded: false, reason: 'unattributed' }),
      });
      await feed();
      expect(spoken.map((a) => a.kind)).toEqual(['scan-rows-incomplete']);
      expect(text(printed[0])).toContain('Row 10 is still empty.');
    });
  });
});
