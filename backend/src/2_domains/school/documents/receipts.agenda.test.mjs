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
    //
    // ABSENT, not null. `lessonAction` omits the key entirely rather than
    // writing `eyebrow: null`, because the block validator's guard is
    // `!== undefined` — a literal null reads as "present but not a string" and
    // fails validateDocument() for the whole agenda. Asserting `toBeNull()`
    // demanded the exact shape that breaks the sheet, so this test has been
    // red since that fix landed.
    expect(lessonCard(build([section()]))).not.toHaveProperty('eyebrow');
  });

  it('prints the offer\'s OWN action label, never a wording of its own', () => {
    // This is what makes the wording configurable per course — "Learn at the
    // Piano" reaches the paper only because the card prints `actionLabel`
    // verbatim rather than deciding for itself. It is pinned because the
    // failure mode is silent: a card that quietly substitutes its own words
    // still prints, and looks fine, and is wrong.
    const doc = build([section({
      next: { unitId: 'u1', title: 'Rhythm', actionLabel: 'learn at the piano' },
    })]);
    expect(lessonCard(doc).meta).toBe('LEARN AT THE PIANO');
  });

  it('falls back to SCAN TO PRINT when an offer names no action', () => {
    // The fallback describes what scanning DOES — it prints a worksheet. (It
    // was briefly changed to "scan to start" on the theory that the child is
    // already holding printed paper, which confuses the agenda with what the
    // scan produces.)
    expect(lessonCard(build([section()])).meta).toBe('SCAN TO PRINT');
  });

  it('keeps progress off the action row', () => {
    // The progress label used to ride here as `<action> · 34/366 · next:
    // <title>`, which is what collided with itself in the footer and repeated
    // the card's own title. Progress belongs to the bars now.
    const doc = build([section({
      progressLabel: '34/366 · next: Rhythm',
      next: { unitId: 'u1', title: 'Rhythm', actionLabel: 'learn at the piano' },
    })]);
    expect(lessonCard(doc).meta).not.toMatch(/34\/366|next:/);
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
