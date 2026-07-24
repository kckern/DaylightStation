import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import GeoQuizRunner from './GeoQuizRunner.jsx';

const submit = vi.fn();
vi.mock('./useGradedSession.js', () => ({ useGradedSession: () => ({ sessionId: 'ses_1', submit, status: 'ready' }) }));

const bank = { id: 'geo:us-state-capitals', title: 'US Capitals', items: [
  { id: 'i1', type: 'multiple_choice', prompt: 'Capital of Nevada?', answer: 'Carson City', choices: ['Carson City', 'Reno'] },
  { id: 'i2', type: 'multiple_choice', prompt: 'Capital of Oregon?', answer: 'Salem', choices: ['Salem', 'Portland'] },
] };

beforeEach(() => submit.mockReset());

it('drops correct items and ends with a mastery summary', async () => {
  submit.mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Carson City' }));
  await screen.findByRole('button', { name: 'Next' });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Salem' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  expect(await screen.findByTestId('geo-summary')).toHaveTextContent('Mastered 2 / 2');
});

it('requeues a missed item until it is answered correctly', async () => {
  submit.mockResolvedValueOnce({ correct: false, expected: 'Carson City' })
        .mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reno' })); // wrong on i1
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  // i2 next, answer right
  fireEvent.click(await screen.findByRole('button', { name: 'Salem' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  // i1 resurfaces
  expect(await screen.findByText('Capital of Nevada?')).toBeInTheDocument();
});

it('requeues an unrecorded answer as not-mastered (no crash, no mastery)', async () => {
  submit.mockResolvedValueOnce({ unrecorded: true }).mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Carson City' }));
  expect(await screen.findByTestId('unrecorded')).toBeInTheDocument();
});
