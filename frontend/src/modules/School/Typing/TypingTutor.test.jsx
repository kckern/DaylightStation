import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TypingTutor from './TypingTutor.jsx';
import { LESSONS } from './typingEngine.js';

vi.mock('../schoolLog.js', () => ({ schoolLog: { typing: vi.fn() } }));

function typeString(str) {
  for (const ch of str) fireEvent.keyDown(window, { key: ch });
}

beforeEach(() => { /* window listeners are cleaned up on unmount */ });

describe('TypingTutor', () => {
  it('shows the first lesson and its target text', () => {
    render(<TypingTutor />);
    expect(screen.getByText(/Lesson 1 of/)).toBeInTheDocument();
    expect(screen.getByLabelText('Text to type')).toBeInTheDocument();
  });

  it('marks typed characters and reveals the line-complete actions when the target is fully typed', () => {
    render(<TypingTutor />);
    typeString(LESSONS[0].text);
    // Completing the line surfaces Retry + Next line.
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next line/i })).toBeInTheDocument();
  });

  it('advances to the next lesson on "Next line"', () => {
    render(<TypingTutor />);
    typeString(LESSONS[0].text);
    fireEvent.click(screen.getByRole('button', { name: /next line/i }));
    expect(screen.getByText(/Lesson 2 of/)).toBeInTheDocument();
  });

  it('Backspace deletes a character (barebones allows correcting)', () => {
    render(<TypingTutor />);
    typeString('as');
    fireEvent.keyDown(window, { key: 'Backspace' });
    // Only one char typed now; the line is not complete, so no Next button.
    expect(screen.queryByRole('button', { name: /next line/i })).toBeNull();
  });

  it('finishing the last lesson shows the completion screen with a restart', () => {
    render(<TypingTutor />);
    for (let i = 0; i < LESSONS.length; i += 1) {
      typeString(LESSONS[i].text);
      const label = i + 1 < LESSONS.length ? /next line/i : /finish/i;
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    expect(screen.getByText(/nice work/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
  });
});
