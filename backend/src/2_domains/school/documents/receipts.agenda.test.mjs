import { describe, it, expect } from 'vitest';
import { agendaDocument } from './receipts.mjs';

const section = (extra = {}) => ({
  subject: 'scripture',
  servedToday: false,
  next: { unitId: 'cfm-mon', title: 'Psalms 49-51', actionLabel: 'scan to print' },
  ...extra,
});

const build = (sections) => agendaDocument({
  learnerId: 'test-learner',
  learnerName: 'Test Learner',
  generatedAt: '2026-08-25T23:48:31.080Z',
  timeZone: 'UTC',
  sections,
  tokensBySubject: { scripture: 'sch:TESTTESTTEST0001' },
});

const lessonCard = (doc) => doc.blocks.find((b) => b.type === 'scan_action');

describe('agendaDocument lesson cards', () => {
  it('puts the SUBJECT in the eyebrow, not "Today"', () => {
    // Every card on the page is today's — the page IS the day — so a TODAY
    // eyebrow on each one spent the card's most prominent small line restating
    // the masthead. Worse, the receipt renderer truncates the eyebrow at its
    // first '·', so the old `Today · scripture` printed as the single word
    // "TODAY" and the subject never appeared at all.
    expect(lessonCard(build([section()])).eyebrow).toBe('scripture');
  });

  it('rails a catch-up offer', () => {
    expect(lessonCard(build([section({ catchUp: true })])).rail).toBe('Catch-up');
  });

  it('leaves on-schedule work unrailed', () => {
    // Absent, not empty: the renderer treats any non-blank string as a rail, so
    // an always-present field would put a bar on every card.
    expect(lessonCard(build([section({ catchUp: false })]))).not.toHaveProperty('rail');
    expect(lessonCard(build([section()]))).not.toHaveProperty('rail');
  });
});
