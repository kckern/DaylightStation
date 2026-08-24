import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import GeoQuizRunner from './GeoQuizRunner.jsx';

const submit = vi.fn();
const gradedSessionMock = vi.fn(() => ({ sessionId: 'ses_1', submit, status: 'ready' }));
vi.mock('./useGradedSession.js', () => ({ useGradedSession: (...a) => gradedSessionMock(...a) }));

const bank = { id: 'geo:us-state-capitals', title: 'US Capitals', items: [
  { id: 'i1', type: 'multiple_choice', prompt: 'Capital of Nevada?', answer: 'Carson City', choices: ['Carson City', 'Reno'] },
  { id: 'i2', type: 'multiple_choice', prompt: 'Capital of Oregon?', answer: 'Salem', choices: ['Salem', 'Portland'] },
] };

beforeEach(() => {
  submit.mockReset();
  gradedSessionMock.mockReset().mockReturnValue({ sessionId: 'ses_1', submit, status: 'ready' });
});

async function confirmChoice(name) {
  const choice = await screen.findByRole('button', { name });
  fireEvent.click(choice);
  fireEvent.click(choice);
}

it('drops correct items and ends with a mastery summary', async () => {
  submit.mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  await confirmChoice('Carson City');
  await screen.findByRole('button', { name: 'Next' });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await confirmChoice('Salem');
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  expect(await screen.findByTestId('geo-summary')).toHaveTextContent('Mastered 2 / 2');
});

it('requeues a missed item until it is answered correctly', async () => {
  submit.mockResolvedValueOnce({ correct: false, expected: 'Carson City' })
        .mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  await confirmChoice('Reno'); // wrong on i1
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  // i2 next, answer right
  await confirmChoice('Salem');
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  // i1 resurfaces
  expect(await screen.findByText('Capital of Nevada?')).toBeInTheDocument();
});

it('requeues an unrecorded answer as not-mastered (no crash, no mastery)', async () => {
  submit.mockResolvedValueOnce({ unrecorded: true }).mockResolvedValue({ correct: true, expected: 'x' });
  render(<GeoQuizRunner bank={bank} onExit={() => {}} />);
  await confirmChoice('Carson City');
  expect(await screen.findByTestId('unrecorded')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));

  // i1 was requeued (not mastered) behind i2 - answer i2 correctly first.
  await confirmChoice('Salem');
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));

  // i1 resurfaces - still not mastered, no summary yet.
  expect(await screen.findByText('Capital of Nevada?')).toBeInTheDocument();
  expect(screen.queryByTestId('geo-summary')).toBeNull();

  // Now answer i1 correctly (mock default is correct:true) - only then is mastery reached.
  await confirmChoice('Carson City');
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  expect(await screen.findByTestId('geo-summary')).toHaveTextContent('Mastered 2 / 2');
});

it('shows a session-lost card when the hook reports a lost session, without a silent exit', async () => {
  const onExit = vi.fn();
  gradedSessionMock.mockReturnValue({ sessionId: 'ses_1', submit, status: 'ready', sessionLost: true });
  render(<GeoQuizRunner bank={bank} onExit={onExit} />);
  expect(await screen.findByTestId('session-lost')).toHaveTextContent(/took a long break and timed out/i);
  expect(onExit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(onExit).toHaveBeenCalled();
});
