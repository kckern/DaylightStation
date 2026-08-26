import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GradedWorksheet from './GradedWorksheet.jsx';

// REAL shapes: choices carry `label` + `letter` + `correct`; `given` and
// `expected` may hold LETTERS (bubble sheet) or answer text (other paths).
const assignment = { questions: [
  { itemId: 'q1', number: 1, prompt: 'Capital of Illinois?',
    choices: [{ id: 'a', letter: 'A', label: 'Chicago' }, { id: 'b', letter: 'B', label: 'Springfield', correct: true }],
    expected: ['B'] },
  { itemId: 'q2', number: 2, prompt: 'Statehood year?',
    choices: [{ id: 'a', letter: 'A', label: '1818', correct: true }, { id: 'b', letter: 'B', label: '1808' }],
    expected: ['A'] },
] };
const assessment = { items: [
  { itemId: 'q1', questionNumber: 19, prompt: 'Capital of Illinois?', given: 'B', expected: ['B'], verdict: 'correct' },
  { itemId: 'q2', questionNumber: 20, prompt: 'Statehood year?', given: 'B', expected: ['A'], verdict: 'incorrect' },
] };

describe('GradedWorksheet', () => {
  it('prints each question exactly once', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    expect(screen.getAllByText('Capital of Illinois?')).toHaveLength(1);
    expect(screen.getAllByText('Statehood year?')).toHaveLength(1);
  });

  it('uses the worksheet numbering, never the bank-global index', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.queryByText('19.')).not.toBeInTheDocument();
  });

  it('resolves a bubbled LETTER to the answer the child actually chose', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    const given = screen.getAllByText('Springfield', { selector: '.teacher-graded-q__given' });
    expect(given).toHaveLength(1);
    expect(screen.queryByText('B', { selector: '.teacher-graded-q__given' })).not.toBeInTheDocument();
  });

  it('resolves multi-select letters to a readable list', () => {
    const multi = { items: [{ itemId: 'q1', given: 'A,B', expected: ['A', 'B'], verdict: 'correct' }] };
    render(<GradedWorksheet assignment={assignment} assessment={multi} />);
    expect(screen.getByText('Chicago, Springfield', { selector: '.teacher-graded-q__given' })).toBeInTheDocument();
  });

  it('passes answer TEXT straight through when that is what was recorded', () => {
    const textual = { items: [{ itemId: 'q1', given: 'A broken spirit', expected: ['A broken spirit'], verdict: 'correct' }] };
    render(<GradedWorksheet assignment={assignment} assessment={textual} />);
    expect(screen.getByText('A broken spirit', { selector: '.teacher-graded-q__given' })).toBeInTheDocument();
  });

  it('shows the verdict on every row', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByText('Incorrect')).toBeInTheDocument();
  });

  it('shows the right answer, as words, only when the child got it wrong', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    const corrections = screen.getAllByText(/Correct answer:/);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toHaveTextContent('1818');
    expect(corrections[0]).not.toHaveTextContent(/Correct answer: A$/);
  });

  it('renders from the answers alone when no worksheet document survives', () => {
    render(<GradedWorksheet assignment={null} assessment={assessment} />);
    expect(screen.getByText('Capital of Illinois?')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
  });

  it('renders the worksheet alone when nothing is graded yet', () => {
    render(<GradedWorksheet assignment={assignment} assessment={null} />);
    expect(screen.getByText('Capital of Illinois?')).toBeInTheDocument();
    expect(screen.getByText(/not graded/i)).toBeInTheDocument();
  });

  it('marks the chosen option among the printed choices', () => {
    render(<GradedWorksheet assignment={assignment} assessment={assessment} />);
    expect(screen.getByText('B. Springfield')).toHaveClass('is-chosen');
  });

  it('uses the choice’s own letter rather than its array position', () => {
    const sparse = { questions: [{ itemId: 'q1', number: 1, prompt: 'P?',
      choices: [{ letter: 'C', label: 'Third' }, { letter: 'E', label: 'Fifth' }] }] };
    render(<GradedWorksheet assignment={sparse} assessment={null} />);
    expect(screen.getByText('C. Third')).toBeInTheDocument();
    expect(screen.getByText('E. Fifth')).toBeInTheDocument();
  });
});
