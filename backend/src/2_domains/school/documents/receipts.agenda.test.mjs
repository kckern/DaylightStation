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
  it('carries no eyebrow — the taxonomy breadcrumb is the meaningful line', () => {
    // It used to read `Today · <subject>`, which the renderer truncates at the
    // first '·' — so it printed the single word "TODAY" on every card. Every
    // card on the page is today's (the page IS the day), so that restated the
    // masthead and nothing else. The bare subject was no better: the breadcrumb
    // directly beneath already reads "Arts › Hoffman Academy Piano › Unit 3"
    // with the subject's own SVG in the gutter, so an eyebrow repeating its
    // first word costs a row and pushes the title down.
    expect(lessonCard(build([section()])).eyebrow).toBeNull();
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
