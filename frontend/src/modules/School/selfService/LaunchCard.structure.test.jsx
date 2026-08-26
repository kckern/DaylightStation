/**
 * What the launch card SAYS, and in what order.
 *
 * ⚠️ jsdom cannot see layout, computed styles or fonts. Nothing here proves the
 * card looks right — the type scale, the poster's alignment and the weight of
 * the primary button all need a real browser. What these tests do hold is the
 * labelling decision underneath the redesign: the header names WHERE this came
 * from (subject › course) and nothing else, the unit leads the copy column, and
 * the lesson is named exactly once — as the heading a child came to read.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LaunchCard from './LaunchCard.jsx';

const noop = () => {};

const FULL_CARD = {
  schema: 'school.self-service-card/v2',
  ok: true,
  context: {
    learner: { id: 'kid1', displayName: 'Alpha', avatar: { kind: 'learner', id: 'kid1' } },
    taxonomy: {
      subject: { id: 'math', label: 'Math & Money' },
      course: { id: 'fractions', title: 'Fractions', artwork: { kind: 'course-poster', courseId: 'fractions' } },
      module: { id: 'foundations', title: 'Foundations', position: 1 },
      lesson: { id: 'fractions-3', title: 'Fractions 3' },
    },
    trail: [
      { kind: 'subject', id: 'math', label: 'Math & Money' },
      { kind: 'course', id: 'fractions', label: 'Fractions' },
      { kind: 'module', id: 'foundations', label: 'Foundations' },
      { kind: 'lesson', id: 'fractions-3', label: 'Fractions 3' },
    ],
    progress: [{ scope: 'course', label: 'Course', completed: 2, total: 6 }],
  },
  presentation: { status: 'ready', message: null },
  actions: [
    { kind: 'print', label: 'Print my worksheet', role: 'primary' },
    { kind: 'exit', label: 'Go back', role: 'secondary' },
  ],
};

/** The live shape verified against `plex:675689` — a Plex-hosted piano course. */
const PIANO_CARD = {
  schema: 'school.self-service-card/v2',
  ok: true,
  context: {
    learner: { id: 'milo', displayName: 'Milo', avatar: { kind: 'learner', id: 'milo' } },
    taxonomy: {
      subject: { id: 'arts', label: 'Arts & Culture' },
      course: { id: 'plex:675689', title: 'Hoffman Academy', artwork: { kind: 'course-poster', courseId: 'plex:675689' } },
      module: { id: 'unit-2', title: 'Unit 2 · Chords & the Grand Staff', position: 2 },
      lesson: {
        id: 'plex:676040',
        title: 'Rhythm Improvisation with Chords',
        artwork: { kind: 'lesson-thumbnail', path: '/api/v1/proxy/plex/library/metadata/676040/thumb/1783605321' },
        description: 'New term: Triad\nCombine Do, Mi, and So to make a three-note chord',
      },
    },
    trail: [
      { kind: 'subject', id: 'arts', label: 'Arts & Culture' },
      { kind: 'course', id: 'plex:675689', label: 'Hoffman Academy' },
      { kind: 'module', id: 'unit-2', label: 'Unit 2 · Chords & the Grand Staff' },
      { kind: 'lesson', id: 'plex:676040', label: 'Rhythm Improvisation with Chords' },
    ],
    progress: [
      { scope: 'course', label: 'Course', measures: 'unit', completed: 1, total: 18, position: 2 },
      {
        scope: 'module', label: 'Unit 2 · Chords & the Grand Staff', measures: 'lesson',
        completed: 12, total: 23, position: 13, current: true,
      },
    ],
  },
  presentation: { status: 'ready', message: null },
  actions: [
    { kind: 'program', label: 'Open Hoffman Academy', target: 'piano-course', role: 'primary' },
    { kind: 'exit', label: 'Go back', role: 'secondary' },
  ],
};

const renderCard = (card) => render(
  <LaunchCard card={card} onAction={noop} onConfirm={noop} onExit={noop} />,
);

describe('LaunchCard header', () => {
  it('names only the subject and the course, led by the subject icon', () => {
    const { container } = renderCard(FULL_CARD);

    const header = screen.getByRole('navigation', { name: /lesson context/i });
    expect(header).toHaveTextContent('Math & Money›Fractions');
    // The module and the lesson have left the crumbs entirely: the unit is its
    // own line and the lesson is the heading, so repeating either here would be
    // the second and third time a child is told the same thing.
    expect(within(header).queryByText('Foundations')).toBeNull();
    expect(within(header).queryByText('Fractions 3')).toBeNull();
    expect(header.querySelector('.school-selfservice-card__crumbs-icon svg')).toBeTruthy();
    // The old eyebrow-in-the-right-column trail and its degraded-path stand-in
    // are both gone; there is one header, and it is the card's.
    expect(container.querySelector('.school-selfservice-card__trail')).toBeNull();
    expect(container.querySelector('.school-selfservice-card__subject')).toBeNull();
  });

  it('spans the card — it sits above both columns, not inside the copy column', () => {
    const { container } = renderCard(FULL_CARD);

    const header = container.querySelector('.school-selfservice-card__crumbs');
    const shell = container.querySelector('.school-selfservice-card__shell');
    const content = container.querySelector('.school-selfservice-card__content');
    expect(header.parentElement).toBe(shell);
    expect(content.contains(header)).toBe(false);
    // Document order: the header reads before the poster and the copy.
    expect(header.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('still draws a mark for a subject the icon set has never heard of', () => {
    const { container } = renderCard({
      schema: 'school.self-service-card/v1',
      ok: true,
      subject: 'Mathematics',
      title: 'Fractions 3',
      actions: [{ kind: 'print', label: 'Print my worksheet' }],
    });

    const header = screen.getByRole('navigation', { name: /lesson context/i });
    expect(header).toHaveTextContent('Mathematics');
    // An unknown name renders NOTHING through `Icon`, which would open the
    // header on a silent gap. The fallback keeps the line whole.
    expect(container.querySelector('.school-selfservice-card__crumbs-icon svg')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fractions 3' })).toBeInTheDocument();
  });

  it('draws no header at all for a card carrying neither subject nor course', () => {
    renderCard({ ok: true, title: 'Fractions 3', actions: [] });
    expect(screen.queryByRole('navigation', { name: /lesson context/i })).toBeNull();
  });
});

describe('LaunchCard copy column', () => {
  it('leads with the unit, then the lesson as the heading, then its description', () => {
    const { container } = renderCard(PIANO_CARD);

    const head = container.querySelector('.school-selfservice-card__head');
    const unit = within(head).getByText('Unit 2 · Chords & the Grand Staff');
    const title = within(head).getByRole('heading', { level: 1, name: 'Rhythm Improvisation with Chords' });
    const description = screen.getByTestId('selfservice-lesson-description');
    expect(unit.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the description line breaks as lines, not as markup', () => {
    renderCard(PIANO_CARD);

    const description = screen.getByTestId('selfservice-lesson-description');
    expect(description.querySelectorAll('span')).toHaveLength(2);
    expect(description).toHaveTextContent('New term: Triad');
    expect(description).toHaveTextContent('Combine Do, Mi, and So to make a three-note chord');
    expect(description.innerHTML).not.toContain('<br');
  });

  it('omits the unit line and the description when the lesson has neither', () => {
    const { container } = renderCard(FULL_CARD);

    expect(container.querySelector('.school-selfservice-card__unit'))
      .toHaveTextContent('Foundations');
    expect(screen.queryByTestId('selfservice-lesson-description')).toBeNull();
  });

  it('draws the lesson still under the poster, in the art column', () => {
    const { container } = renderCard(PIANO_CARD);

    const still = screen.getByRole('img', { name: 'Rhythm Improvisation with Chords still' });
    expect(container.querySelector('.school-selfservice-card__art').contains(still)).toBe(true);
  });

  it('draws no still for a lesson that has none — the key is absent, not empty', () => {
    const { container } = renderCard(FULL_CARD);
    expect(container.querySelector('.school-selfservice-card__still')).toBeNull();
  });
});

describe('LaunchCard progress rows', () => {
  it('says where the learner IS standing, not only what is behind them', () => {
    renderCard(PIANO_CARD);

    // `completed: 1` — rendering that would read "1 of 18" while the child is
    // sitting in unit 2. `measures` supplies the noun.
    expect(screen.getByRole('progressbar', { name: 'Course: Unit 2 of 18' }))
      .toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /^Unit 2 · Chords & the Grand Staff: 13 of 23$/ }))
      .toBeInTheDocument();
  });

  it('keeps aria-valuenow on what is genuinely finished, with the reading in valuetext', () => {
    renderCard(PIANO_CARD);

    const course = screen.getByRole('progressbar', { name: 'Course: Unit 2 of 18' });
    expect(course).toHaveAttribute('aria-valuenow', '1');
    expect(course).toHaveAttribute('aria-valuemax', '18');
    expect(course).toHaveAttribute('aria-valuetext', 'Unit 2 of 18');
  });

  it('draws the item being worked as its own segment past the finished ones', () => {
    const { container } = renderCard(PIANO_CARD);

    const [courseRow] = container.querySelectorAll('.school-selfservice-card__progress-row');
    // 1 of 18 finished, standing in unit 2 — so one unit's width of "underway"
    // starting where "complete" ends.
    expect(courseRow.querySelector('.is-complete').style.width).toBe(`${1 / 18 * 100}%`);
    expect(courseRow.querySelector('.is-underway').style.left).toBe(`${1 / 18 * 100}%`);
    expect(courseRow.querySelector('.is-underway').style.width).toBe(`${1 / 18 * 100}%`);
  });

  it('marks the row carrying `current`', () => {
    const { container } = renderCard(PIANO_CARD);

    const current = container.querySelectorAll('.school-selfservice-card__progress-row.is-current');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Unit 2 · Chords & the Grand Staff');
    expect(current[0]).toHaveAttribute('data-current', 'true');
  });

  it('keeps the completed-of-total reading for a row with no position to report', () => {
    renderCard(FULL_CARD);

    // The curriculum path (worksheets, quiz banks) ships no `measures`, no
    // `position` and no `current` — and must not be worded as though it did.
    const row = screen.getByRole('progressbar', { name: 'Course: 2 of 6' });
    expect(row).toHaveAttribute('aria-valuenow', '2');
    expect(row).toHaveAttribute('aria-valuetext', '2 of 6');
  });

  it('still honours the curriculum path’s inProgress segment', () => {
    const { container } = renderCard({
      ...FULL_CARD,
      context: {
        ...FULL_CARD.context,
        progress: [{ scope: 'course', label: 'Course', completed: 2, total: 6, inProgress: 1 }],
      },
    });

    const row = container.querySelector('.school-selfservice-card__progress-row');
    expect(row.querySelector('.is-underway').style.width).toBe(`${1 / 6 * 100}%`);
  });
});

describe('LaunchCard actions', () => {
  it('marks exactly one action primary so there is one obvious thing to press', () => {
    const { container } = renderCard(FULL_CARD);

    const primaries = container.querySelectorAll('.school-selfservice-card__action.is-primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Print my worksheet');
    expect(container.querySelector('.school-selfservice-card__action.is-secondary'))
      .toHaveTextContent('Go back');
  });

  it('gives every action a mark, drawn as inline SVG rather than a glyph', () => {
    const { container } = renderCard(FULL_CARD);

    for (const button of container.querySelectorAll('.school-selfservice-card__action')) {
      expect(button.querySelector('.school-selfservice-card__action-icon svg')).toBeTruthy();
    }
  });

  it('says what a child DOES for a program the house knows, not "Open <course>"', () => {
    renderCard(PIANO_CARD);

    const primary = screen.getByTestId('selfservice-action-program');
    expect(primary).toHaveTextContent('Learn at the piano');
    expect(primary).not.toHaveTextContent('Open Hoffman Academy');
    // And it draws the piano, as inline SVG with a real path in it — an icon
    // whose fill lives in an inner <style> parses to an empty box here while
    // looking fine in a browser, so the path is what gets asserted.
    expect(primary.querySelectorAll('.school-selfservice-card__action-icon svg path'))
      .toHaveLength(1);
    // Tabbing to this button is the whole context a screen-reader user gets,
    // and the visible words lead the name so the two still match for voice.
    expect(primary).toHaveAccessibleName('Learn at the piano: Rhythm Improvisation with Chords');
  });

  it('keeps the domain’s own label for a program it has no wording for', () => {
    renderCard({
      ...PIANO_CARD,
      actions: [
        // A programId the house has never heard of — the fallback has to be a
        // real one, not merely an unmapped one, or this passes for the wrong
        // reason the moment that program gains wording.
        { kind: 'program', label: 'Open Astronomy Lab', target: 'astronomy-lab', role: 'primary' },
        { kind: 'exit', label: 'Go back', role: 'secondary' },
      ],
    });

    expect(screen.getByTestId('selfservice-action-program'))
      .toHaveTextContent('Open Astronomy Lab');
  });

  // Every launcher `schoolLifecycle` registers, with the words a child reads.
  // The icon assertion is the load-bearing half: `Icon` renders NOTHING for a
  // name with no file behind it, so a typo'd icon key ships an unmarked button
  // that looks deliberate. Asserting a real <path> is the only way to tell the
  // two apart from a test — see the piano-svg trap above.
  it.each([
    ['piano-course', 'Learn at the piano'],
    ['sentence-ladder', 'Practice sentences'],
    ['language-reels', 'Watch and listen'],
    ['rubiks-cube', 'Solve the cube'],
  ])('says what a child does for %s', (target, label) => {
    renderCard({
      ...PIANO_CARD,
      actions: [
        { kind: 'program', label: `Open ${target}`, target, role: 'primary' },
        { kind: 'exit', label: 'Go back', role: 'secondary' },
      ],
    });

    const primary = screen.getByTestId('selfservice-action-program');
    expect(primary).toHaveTextContent(label);
    expect(primary).not.toHaveTextContent(`Open ${target}`);
    expect(primary.querySelectorAll('.school-selfservice-card__action-icon svg path').length)
      .toBeGreaterThan(0);
  });

  it('names the way out without borrowing the lesson title', () => {
    renderCard(PIANO_CARD);
    expect(screen.getByTestId('selfservice-action-exit'))
      .toHaveAccessibleName('Go back');
  });
});
