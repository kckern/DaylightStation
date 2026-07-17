import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
import { PriorityList } from './PriorityList.jsx';

const wrap = (ui) => render(<MantineProvider><MemoryRouter>{ui}</MemoryRouter></MantineProvider>);
beforeEach(() => { localStorage.clear(); navigate.mockReset(); });

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
  it('dismisses a card and keeps it dismissed', () => {
    wrap(<PriorityList priorities={items} />);
    fireEvent.click(screen.getAllByLabelText(/dismiss/i)[1]); // plan_gap
    expect(screen.queryByText('Name your purpose')).not.toBeInTheDocument();
  });
});
