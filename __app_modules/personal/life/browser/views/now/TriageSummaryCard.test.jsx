import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

import { TriageSummaryCard } from "./TriageSummaryCard.jsx";

const wrap = (ui) => render(<MantineProvider><MemoryRouter>{ui}</MemoryRouter></MantineProvider>);
const base = {
  enrolled: true, mode: 'live', mailbox: 'ok', mailboxName: 'Mailbox A', lastPassAt: 1,
  preDone: { archived: 12, closed: 3 }, open: { unsure: 2, reply: 4, todo: 1 }, draftsReady: 3,
};
describe('TriageSummaryCard', () => {
  it('renders nothing for a user who is not enrolled', () => {
    wrap(<TriageSummaryCard summary={{ ...base, enrolled: false }} />);
    expect(screen.queryByText('Triage')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Triage summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    wrap(<TriageSummaryCard summary={null} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('shows the counts and links to the session', () => {
    wrap(<TriageSummaryCard summary={base} />);
    expect(screen.getByText('12 emails archived')).toBeInTheDocument();
    expect(screen.getByText('3 stale todos')).toBeInTheDocument();
    expect(screen.getByText('4 need your call')).toBeInTheDocument(); // 2 unsure + 1 todo + 1 undrafted reply
    expect(screen.getByText('3 replies drafted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start triage/i })).toHaveAttribute('href', '/life/now/triage');
  });
  it('shows the reconnect line when the mailbox needs reconnecting', () => {
    wrap(<TriageSummaryCard summary={{ ...base, mailbox: 'reconnect_needed' }} />);
    expect(screen.getByText(/Reconnect Mailbox A/)).toBeInTheDocument();
  });
  it('falls back to "your mailbox" without a display name', () => {
    wrap(<TriageSummaryCard summary={{ ...base, mailbox: 'reconnect_needed', mailboxName: null }} />);
    expect(screen.getByText(/Reconnect your mailbox/)).toBeInTheDocument();
  });
  it('shows a quiet retry line when the summary failed to load', () => {
    const retry = vi.fn();
    wrap(<TriageSummaryCard summary={null} error="boom" onRetry={retry} />);
    expect(screen.getByText('Triage unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalled();
  });
  it('does not show the reconnect line when the mailbox is fine', () => {
    wrap(<TriageSummaryCard summary={base} />);
    expect(screen.queryByText(/Reconnect/)).not.toBeInTheDocument();
  });
  it('in a dry run reads "Dry run: would have archived N"', () => {
    wrap(<TriageSummaryCard summary={{ ...base, mode: 'dryRun', wouldHave: { archived: 7, closed: 1 } }} />);
    expect(screen.getByText('Dry run: would have archived 7 · closed 1')).toBeInTheDocument();
    expect(screen.queryByText(/emails archived/)).not.toBeInTheDocument();
  });
});
