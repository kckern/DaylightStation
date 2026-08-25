/**
 * What the launch card SAYS, and in what order.
 *
 * ⚠️ jsdom cannot see layout, computed styles or fonts. Nothing here proves the
 * card looks right — the type scale, the poster's alignment and the weight of
 * the primary button all need a real browser. What these tests do hold is the
 * labelling decision underneath the redesign: the taxonomy is named ONCE, as an
 * eyebrow above the title, instead of three times (trail, subject line, and a
 * "course · module" line) competing with the lesson name a child came to read.
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
    { kind: 'exit', label: 'Close', role: 'secondary' },
  ],
};

const renderCard = (card) => render(
  <LaunchCard card={card} onAction={noop} onConfirm={noop} onExit={noop} />,
);

describe('LaunchCard labelling', () => {
  it('names the lesson once as the heading and once as the last crumb, and nowhere else', () => {
    renderCard(FULL_CARD);

    expect(screen.getByRole('heading', { name: 'Fractions 3' })).toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: /lesson context/i });
    expect(trail).toHaveTextContent('Math & Money›Fractions›Foundations›Fractions 3');
    // The standalone "Fractions · Foundations" line is gone: the trail already
    // says both, and repeating them under the title pushed the one thing a
    // child needs to read further down the card.
    expect(screen.queryByText('Fractions · Foundations')).toBeNull();
  });

  it('puts the trail inside the head, above the title it introduces', () => {
    const { container } = renderCard(FULL_CARD);

    const head = container.querySelector('.school-selfservice-card__head');
    const trail = within(head).getByRole('navigation', { name: /lesson context/i });
    const title = within(head).getByRole('heading', { level: 1 });
    // Node.compareDocumentPosition: FOLLOWING (4) means the title comes after
    // the trail in document order — the eyebrow reads first.
    expect(trail.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('drops the separate subject line when the trail already opens with the subject', () => {
    const { container } = renderCard(FULL_CARD);

    expect(container.querySelector('.school-selfservice-card__subject')).toBeNull();
    expect(within(screen.getByRole('navigation', { name: /lesson context/i }))
      .getByText('Math & Money')).toBeInTheDocument();
  });

  it('still names the subject on a card that carries no trail to say it', () => {
    const { container } = renderCard({
      schema: 'school.self-service-card/v1',
      ok: true,
      subject: 'Mathematics',
      title: 'Fractions 3',
      actions: [{ kind: 'print', label: 'Print my worksheet' }],
    });

    expect(screen.queryByRole('navigation', { name: /lesson context/i })).toBeNull();
    expect(container.querySelector('.school-selfservice-card__subject')).toHaveTextContent('Mathematics');
    expect(screen.getByRole('heading', { name: 'Fractions 3' })).toBeInTheDocument();
  });

  it('marks exactly one action primary so there is one obvious thing to press', () => {
    const { container } = renderCard(FULL_CARD);

    const primaries = container.querySelectorAll('.school-selfservice-card__action.is-primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Print my worksheet');
    expect(container.querySelector('.school-selfservice-card__action.is-secondary'))
      .toHaveTextContent('Close');
  });
});
