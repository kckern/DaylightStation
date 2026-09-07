import { describe, it, expect } from 'vitest';
import { agendaDocument } from './receipts.mjs';
import { validateDocument } from './documentValidation.mjs';

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

// --- the reading-log card ----------------------------------------------------
// It is a LESSON card like every other thing a child is asked to do that day.
// See docs/_wip/plans/2026-09-06-reading-log-card-parity-design.md §3.

const READING_TOKEN = 'sch:READINGREADING1';

const withReading = (extra = {}, sections = [section()]) => agendaDocument({
  learnerId: 'test-learner',
  learnerName: 'Test Learner',
  generatedAt: '2026-08-25T23:48:31.080Z',
  timeZone: 'UTC',
  sections,
  tokensBySubject: { scripture: 'sch:TESTTESTTEST0001' },
  readingToken: READING_TOKEN,
  readingAccessCode: '481902',
  readingSubject: 'english',
  ...extra,
});

const readingCard = (doc) => doc.blocks.find((b) => b.action === READING_TOKEN);

describe('agendaDocument reading card', () => {
  it('prints the reading log as a lesson card', () => {
    const doc = withReading({
      readingFeature: {
        state: 'reading',
        book: { title: 'Hatchet', authors: ['Gary Paulsen'] },
        page: 84, percent: 46, pageCount: 184, alsoReading: [],
      },
    });
    const card = readingCard(doc);
    expect(card.presentation).toBe('lesson');
    expect(card.label).toBe('Hatchet');
    expect(card.unit).toBe('Gary Paulsen');
    expect(card.icon).toBe('english');
    expect(card.taxonomy).toEqual({
      subject: 'English', course: 'Reading log', unit: 'Gary Paulsen', lesson: 'Hatchet',
    });
    expect(card.description).toMatch(/Page 84 of 184/);
    expect(card.meta).toBe('UPDATE ON THE PANEL');
    expect(card.panelCode).toBe('481902');
    expect(validateDocument(doc).errors).toEqual([]);
  });

  it('draws the book bar against the SHELF ITEM\'s length', () => {
    // The fraction printed in the description and the bar's denominator are one
    // number, so a catalog that disagrees about a book's length cannot make the
    // two contradict each other on the same card.
    const doc = withReading({
      readingFeature: {
        state: 'reading',
        book: { title: 'Hatchet', authors: ['Gary Paulsen'] },
        page: 84, percent: 46, pageCount: 184, alsoReading: [],
      },
    });
    expect(readingCard(doc).progress).toContainEqual(
      expect.objectContaining({ completed: 84, total: 184 }),
    );
  });

  it('carries a four-string taxonomy even with no book facts', () => {
    // A taxonomy missing any of the four fails validateDocument for the WHOLE
    // agenda (blocks.mjs:284), so the card that can name nothing is the guard.
    const doc = withReading({
      readingFeature: { state: 'empty', book: null, alsoReading: [] },
    });
    const card = readingCard(doc);
    expect(Object.values(card.taxonomy).every((v) => typeof v === 'string' && v.length)).toBe(true);
    expect(card.label).toBe('Start a book');
    expect(card.unit).toBe('Books');
    expect(validateDocument(doc).errors).toEqual([]);
  });

  it('still prints the card when the feature could not be read at all', () => {
    // An absent `readingFeature` is the unreadable shape, never a missing card
    // and never "start a book" — a damaged shelf is not an empty one.
    const doc = withReading({ readingFeature: null });
    const card = readingCard(doc);
    expect(card.presentation).toBe('lesson');
    expect(card.label).toBe('Reading log');
    expect(card.meta).toBe('OPEN ON THE PANEL');
    expect(card).not.toHaveProperty('progress');
    expect(validateDocument(doc).errors).toEqual([]);
  });

  it('takes its icon from the subject the shelf sits under', () => {
    // An enrollment may place the shelf under any subject; a hardcoded
    // `english` would print the wrong glyph in the gutter.
    const doc = withReading({
      readingSubject: 'reading',
      readingFeature: { state: 'empty', book: null, alsoReading: [] },
    });
    expect(readingCard(doc).icon).toBe('reading');
    expect(readingCard(doc).taxonomy.subject).toBe('Reading');
  });

  it('says "All done today" when the only thing on the page is the reading card', () => {
    // `nothingLeft` used to be read off `blocks.length`. The reading card is
    // unconditional, so counting it would make "All done today" unreachable
    // forever. See the 2026-09-06 reading-log card parity plan, Task 7.
    const doc = withReading(
      { readingFeature: { state: 'empty', book: null, alsoReading: [] } },
      [section({ servedToday: true, servedWork: [{ title: 'Psalms 49-51' }] })],
    );
    const tally = doc.blocks.find((b) => b.type === 'done_summary');
    expect(tally.label).toBe('All done today');
  });

  it('names the other books it is not headlining', () => {
    const doc = withReading({
      readingFeature: {
        state: 'reading',
        book: { title: 'Hatchet', authors: ['Gary Paulsen'] },
        page: 84, percent: 46, pageCount: 184,
        alsoReading: ['Frindle', 'The Hobbit'],
      },
    });
    expect(readingCard(doc).description).toMatch(/Also reading: Frindle and The Hobbit\./);
  });

  it('says so when a book is set aside rather than claiming an empty shelf', () => {
    const doc = withReading({
      readingFeature: {
        state: 'set-aside',
        book: { title: 'The Hobbit', authors: ['J.R.R. Tolkien'] },
        page: null, percent: null, pageCount: null, alsoReading: [],
      },
    });
    const card = readingCard(doc);
    expect(card.label).toBe('The Hobbit');
    expect(card.description).toMatch(/[Pp]ick it back up/);
    expect(card.description).not.toMatch(/put it on your shelf/);
  });

  it('asks for the next book once one is finished', () => {
    const doc = withReading({
      readingFeature: {
        state: 'finished',
        book: { title: 'Hatchet', authors: ['Gary Paulsen'] },
        page: 184, percent: 100, pageCount: 184, alsoReading: [],
      },
    });
    const card = readingCard(doc);
    expect(card.description).toMatch(/You finished it\./);
    expect(card.meta).toBe('ADD A BOOK ON THE PANEL');
  });

  it('rails a met obligation Done without taking the card off the page', () => {
    // The shelf never closes: a met obligation prints the same card wearing a
    // Done rail and a working code, unlike a subject card which collapses into
    // the tally.
    const doc = withReading({
      readingFeature: {
        state: 'reading', book: { title: 'Hatchet', authors: [] },
        page: 84, percent: 46, pageCount: 184, alsoReading: [],
        obligationMet: true,
        progressRows: [{ label: 'Reading this week', completed: 4, total: 7 }],
      },
    });
    const card = readingCard(doc);
    expect(card.rail).toBe('Done');
    expect(card.progress).toContainEqual(
      expect.objectContaining({ label: 'Reading this week', completed: 4, total: 7 }),
    );
  });

  it('drops the page clause for a book measured in minutes', () => {
    const doc = withReading({
      readingFeature: {
        state: 'reading', book: { title: 'Hatchet', authors: [] },
        page: null, percent: null, pageCount: null, minutes: 200, daysRead: 4,
        alsoReading: [],
      },
    });
    const card = readingCard(doc);
    expect(card.description).not.toMatch(/Page/);
    expect(card.description).toMatch(/3h 20m so far/);
    expect(card).not.toHaveProperty('progress');
  });
});
