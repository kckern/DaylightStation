import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

const banksMock = vi.fn();
vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha' }] })),
    banks: (...a) => banksMock(...a),
    bank: vi.fn(async (id) => ({ ok: true, status: 200, data: { id, title: 'Caps', audience: 'assigned', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }] } })),
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } })),
  },
}));

beforeEach(() => {
  localStorage.clear();
  banksMock.mockReset().mockImplementation(async (audience) => ({
    ok: true, status: 200,
    data: audience === 'generic'
      ? [{ id: 'animals', title: 'Animals', audience: 'generic', itemCount: 1 }]
      : [{ id: 'caps', title: 'Caps', audience: 'assigned', itemCount: 1 }, { id: 'animals', title: 'Animals', audience: 'generic', itemCount: 1 }],
  }));
});

// Both bank cards render the title as an <h3>; find the card wrapper so we can
// scope a Quiz/Cards button lookup to the specific bank under test (the grid
// otherwise has ambiguous duplicate "Quiz"/"Cards" buttons once both an
// assigned and a generic bank are visible at once).
function cardFor(title) {
  return screen.getByText(title).closest('.school-browse__card');
}

// The home grid is now the landing surface; every bank-flow test enters the
// banks section first.
async function openBanks() {
  fireEvent.click(await screen.findByRole('button', { name: /quizzes & flashcards/i }));
}

describe('SchoolApp home', () => {
  it('lands on the section grid and fetches no banks until the section opens', async () => {
    render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(banksMock).not.toHaveBeenCalled();
    await openBanks();
    expect(await screen.findByText('Caps')).toBeInTheDocument();
  });

  it('back from the bank list returns to the home grid', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(screen.getByRole('button', { name: /back to home/i }));
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });

  it('home shows Exit school only when a clear prop exists', async () => {
    const { unmount } = render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByRole('button', { name: /exit school/i })).toBeInTheDocument();
    unmount();
    render(<SchoolApp />);
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /exit school/i })).toBeNull();
  });
});

describe('SchoolApp', () => {
  it('unclaimed browser sees both an assigned and a generic bank (gate loosened)', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    expect(await screen.findByText('Caps')).toBeInTheDocument();
    expect(screen.getByText('Animals')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank opens the picker; picking a profile proceeds into the runner', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); // ProfilePicker
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank then dismissing the picker refuses it, does not enter the runner, and narrows the list to generic', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // dismiss picker -> guest

    expect(await screen.findByText(/sign in to take this one/i)).toBeInTheDocument();
    expect(screen.queryByText('WA?')).toBeNull();

    await waitFor(() => expect(banksMock).toHaveBeenLastCalledWith('generic'));
    expect(await screen.findByText('Animals')).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });

  it('unclaimed: launching a generic bank then dismissing the picker proceeds as guest into the runner', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Animals');
    fireEvent.click(within(cardFor('Animals')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // dismiss picker -> guest, but generic work proceeds

    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });
});
