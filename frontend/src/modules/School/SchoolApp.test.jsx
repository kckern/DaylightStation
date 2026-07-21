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

describe('SchoolApp', () => {
  it('unclaimed browser sees both an assigned and a generic bank (gate loosened)', async () => {
    render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByText('Caps')).toBeInTheDocument();
    expect(screen.getByText('Animals')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank opens the picker; picking a profile proceeds into the runner', async () => {
    render(<SchoolApp clear={() => {}} />);
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); // ProfilePicker
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank then dismissing the picker refuses it, does not enter the runner, and narrows the list to generic', async () => {
    render(<SchoolApp clear={() => {}} />);
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
    await screen.findByText('Animals');
    fireEvent.click(within(cardFor('Animals')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // dismiss picker -> guest, but generic work proceeds

    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });
});
