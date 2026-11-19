import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
let mockUsername = 'alice';
vi.mock("../../hooks/useLifeUser.js", () => ({ useLifeUsername: () => mockUsername }));
import { PriorityList } from "./PriorityList.jsx";

const wrap = (ui) => render(<MantineProvider><MemoryRouter>{ui}</MemoryRouter></MantineProvider>);
beforeEach(() => { localStorage.clear(); navigate.mockReset(); mockUsername = 'alice'; });

describe('PriorityList', () => {
  const items = [
    { type: 'ceremony_due', title: 'Set your intention', reason: 'Due today', ceremonyType: 'unit_intention' },
    { type: 'plan_gap', title: 'Name your purpose', reason: 'One sentence', gap: 'purpose' },
  ];
  it('taps a ceremony_due through to the ceremony route', () => {
    wrap(<PriorityList priorities={items} />);
    fireEvent.click(screen.getByText('Set your intention'));
    expect(navigate).toHaveBeenCalledWith('/life/ceremony/unit_intention');
  });
  it('does not navigate for a goal_deadline card (related_value is a quality id, not a value)', () => {
    const goalItem = [
      { type: 'goal_deadline', title: 'Finish the draft', reason: 'Due Friday', related_value: 'quality-focus' },
    ];
    wrap(<PriorityList priorities={goalItem} />);
    fireEvent.click(screen.getByText('Finish the draft'));
    expect(navigate).not.toHaveBeenCalled();
  });
  it('dismisses a card and keeps it dismissed within the same render', () => {
    wrap(<PriorityList priorities={items} />);
    fireEvent.click(screen.getAllByLabelText(/dismiss/i)[1]); // plan_gap
    expect(screen.queryByText('Name your purpose')).not.toBeInTheDocument();
  });
  it('scopes dismissal to the current user — a different user still sees the card', () => {
    const { unmount } = wrap(<PriorityList priorities={items} />);
    fireEvent.click(screen.getAllByLabelText(/dismiss/i)[1]); // plan_gap, dismissed as 'alice'
    expect(screen.queryByText('Name your purpose')).not.toBeInTheDocument();
    unmount();

    mockUsername = 'bob';
    wrap(<PriorityList priorities={items} />);
    expect(screen.getByText('Name your purpose')).toBeInTheDocument();
  });
  it('preserves sibling and other member dismissals written since mounting', () => {
    const key = 'life.priorities.dismissed';
    const today = new Date().toISOString().slice(0, 10);
    wrap(<PriorityList priorities={items} />);
    const sibling = `alice:${today}:plan_gap:Name your purpose`;
    const otherMember = `bob:${today}:ceremony_due:Set your intention`;
    localStorage.setItem(key, JSON.stringify([sibling, otherMember]));
    fireEvent.click(screen.getByLabelText('Dismiss Set your intention'));
    expect(new Set(JSON.parse(localStorage.getItem(key)))).toEqual(new Set([sibling, otherMember, `alice:${today}:ceremony_due:Set your intention`]));
    expect(screen.queryByText('Name your purpose')).not.toBeInTheDocument();
  });
  it('retains valid dismissals alongside malformed entries', () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem('life.priorities.dismissed', JSON.stringify([null, `alice:${today}:plan_gap:Name your purpose`]));
    wrap(<PriorityList priorities={items} />);
    expect(screen.queryByText('Name your purpose')).not.toBeInTheDocument();
  });
  it('keeps both dismissals for the mounted view when storage is blocked', () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      wrap(<PriorityList priorities={items} />);
      for (const item of items) fireEvent.click(screen.getByLabelText('Dismiss ' + item.title));
      expect(screen.getByText(/caught up/)).toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });
  it('prunes dismissed entries from a prior day so a stable-titled daily card (e.g. ceremony_due) is not hidden forever', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    localStorage.setItem('life.priorities.dismissed', JSON.stringify([`alice:${yesterday}:ceremony_due:Set your intention`]));
    wrap(<PriorityList priorities={items} />);
    expect(screen.getByText('Set your intention')).toBeInTheDocument();
  });
});
