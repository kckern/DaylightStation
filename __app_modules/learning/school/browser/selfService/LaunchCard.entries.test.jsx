/**
 * A program action with entries (owner 2026-11-06: dictation and review one
 * tap from the card) draws one button per entry; each opens the program at
 * that entry. Exit stays.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LaunchCard from "./LaunchCard.jsx";

const card = (actions) => ({
  schema: 'school.self-service-card/v2', ok: true,
  context: {
    learner: { id: 'learner1', displayName: 'Learner1' },
    taxonomy: { subject: { id: 'language', label: 'Language & Culture' }, course: { id: 'korean', title: 'UBKS' }, lesson: { id: 'l', title: 'Dictation: 10 words' } },
    trail: [], progress: [],
  },
  presentation: { status: 'ready', message: null },
  actions,
});
const ENTRIES = [
  { id: 'dictation', label: 'Practise dictation', role: 'primary' },
  { id: 'review', label: 'Review flashcards', role: 'secondary' },
  { id: 'today', label: "Today's cards", role: 'secondary' },
];

describe('LaunchCard — program entries', () => {
  it('draws a button per entry instead of "Open …", primary first, with Go back', () => {
    render(<LaunchCard card={card([{ kind: 'program', label: 'Open Dictation: 10 words', target: 'flashcards', role: 'primary', entries: ENTRIES }, { kind: 'exit', label: 'Go back', role: 'secondary' }])} onAction={() => {}} onConfirm={() => {}} onExit={() => {}} />);
    expect(screen.queryByText(/^Open /)).toBeNull();
    const dictation = screen.getByRole('button', { name: /Practise dictation/ });
    expect(dictation.className).toMatch(/is-primary/);
    expect(screen.getByRole('button', { name: /Review flashcards/ }).className).toMatch(/is-secondary/);
    expect(screen.getByRole('button', { name: /Today's cards/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go back/ })).toBeInTheDocument();
  });
  it('a tap runs the program action with that entry', () => {
    const onAction = vi.fn();
    const action = { kind: 'program', label: 'Open X', target: 'flashcards', role: 'primary', entries: ENTRIES };
    render(<LaunchCard card={card([action, { kind: 'exit', label: 'Go back', role: 'secondary' }])} onAction={onAction} onConfirm={() => {}} onExit={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Review flashcards/ }));
    expect(onAction).toHaveBeenCalledWith(action, { entry: 'review' });
  });
});
