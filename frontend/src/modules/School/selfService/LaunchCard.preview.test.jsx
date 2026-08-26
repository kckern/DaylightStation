/**
 * The launch card in PREVIEW.
 *
 * Two things a teacher's browser must guarantee and a child's panel must not
 * be confused by: nothing on the card can be pressed, and nobody glancing at
 * the screen can mistake it for live work.
 *
 * NOTE: jsdom sees structure, not layout. These say nothing about how loud the
 * preview banner reads; that needs a browser.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LaunchCard from './LaunchCard.jsx';

const card = {
  schema: 'school.self-service-card/v2',
  ok: true,
  preview: true,
  context: {
    learner: { id: 'kid1', displayName: 'Alpha', avatar: { kind: 'learner', id: 'kid1' } },
    taxonomy: {
      subject: { id: 'arts', label: 'Arts & Culture' },
      course: { id: 'plex:675689', title: 'Hoffman Academy', artwork: { kind: 'course-poster', courseId: 'plex:675689' } },
      module: { id: 'unit-4', title: 'Unit 4' },
      lesson: { id: 'plex:675712', title: 'Lesson 3' },
    },
    trail: [{ kind: 'subject', id: 'arts', label: 'Arts & Culture' }],
    progress: [],
  },
  presentation: { status: 'ready', message: 'Time for piano.', preview: true },
  actions: [
    { kind: 'program', label: 'Start the lesson', role: 'primary', inert: true },
    { kind: 'exit', label: 'Go back', role: 'secondary', inert: true },
  ],
};

const noop = () => {};

describe('LaunchCard — preview mode is inert', () => {
  it('renders every action the real card offers, but disabled', () => {
    render(<LaunchCard card={card} preview onAction={noop} onConfirm={noop} onExit={noop} />);
    expect(screen.getByTestId('selfservice-action-program')).toBeDisabled();
    expect(screen.getByTestId('selfservice-action-program')).toHaveTextContent('Start the lesson');
    expect(screen.getByTestId('selfservice-action-exit')).toBeDisabled();
  });

  it('clicking an action fires nothing — no print, no dispatch, no session', () => {
    const onAction = vi.fn();
    const onExit = vi.fn();
    render(<LaunchCard card={card} preview onAction={onAction} onConfirm={noop} onExit={onExit} />);
    fireEvent.click(screen.getByTestId('selfservice-action-program'));
    fireEvent.click(screen.getByTestId('selfservice-action-exit'));
    expect(onAction).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('says on screen that it is a preview, and marks the card for anything reading the DOM', () => {
    render(<LaunchCard card={card} preview onAction={noop} onConfirm={noop} onExit={noop} />);
    expect(screen.getByTestId('selfservice-card')).toHaveAttribute('data-preview', 'true');
    expect(screen.getByTestId('selfservice-preview-banner')).toHaveTextContent(/preview/i);
    expect(screen.getByTestId('selfservice-preview-banner')).toHaveTextContent(/nothing here is live/i);
  });

  it('the only live control is the way out of the preview, and it sits outside the card body', () => {
    const onExit = vi.fn();
    render(<LaunchCard card={card} preview onAction={noop} onConfirm={noop} onExit={onExit} />);
    fireEvent.click(screen.getByTestId('selfservice-preview-leave'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('a card carrying inert actions stays inert even without the prop — the marking travels with the card', () => {
    const onAction = vi.fn();
    render(<LaunchCard card={{ ...card, preview: false }} onAction={onAction} onConfirm={noop} onExit={noop} />);
    fireEvent.click(screen.getByTestId('selfservice-action-program'));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('a real resolved card is live exactly as before', () => {
    const onAction = vi.fn();
    const live = {
      ...card,
      preview: false,
      presentation: { status: 'ready', message: 'Time for piano.' },
      actions: [{ kind: 'program', label: 'Start the lesson', role: 'primary' }],
    };
    render(<LaunchCard card={live} onAction={onAction} onConfirm={noop} onExit={noop} />);
    expect(screen.queryByTestId('selfservice-preview-banner')).toBeNull();
    expect(screen.getByTestId('selfservice-card')).not.toHaveAttribute('data-preview');
    fireEvent.click(screen.getByTestId('selfservice-action-program'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('LaunchCard — a refused preview still says something', () => {
  it('a malformed link renders the backend sentence with a way out, never a blank card', () => {
    const onExit = vi.fn();
    const refused = {
      ok: false, preview: true, actions: [],
      sentence: 'That preview link could not be read.',
    };
    render(
      <LaunchCard card={refused} preview view="sentence" sentence={refused.sentence} onAction={noop} onConfirm={noop} onExit={onExit} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('That preview link could not be read.');
    fireEvent.click(screen.getByTestId('selfservice-done'));
    expect(onExit).toHaveBeenCalled();
  });
});
