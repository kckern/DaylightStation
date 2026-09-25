import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SpendPanel } from './SpendPanel.jsx';

const days = Array.from({ length: 30 }, (_, i) => {
  const date = `2026-09-${String(i - 4).padStart(2, '0')}`;
  return { date: i < 4 ? `2026-08-${28 + i}` : date, costUsd: i === 29 ? 0.34 : i % 5 === 0 ? 0.12 : 0, runs: i % 5 === 0 || i === 29 ? 3 : 0, changed: i === 29 ? 2 : 0 };
});
const spend = {
  days, today: 0.34, week: 0.58, month: 1.1, capUsd: 1, cappedToday: false, ledgerTodayUsd: 0.36,
  byTrigger: [{ trigger: 'captures', runs: 12, costUsd: 0.6, avgUsd: 0.05 }, { trigger: 'dailySweep', runs: 3, costUsd: 0.3, avgUsd: 0.1 }],
  byModel: [{ model: 'gpt-4.1-mini', runs: 15, costUsd: 0.9, avgUsd: 0.06, tokens: { input: 1, cached: 0, output: 1 } }],
};
const mount = data => render(<MantineProvider><SpendPanel spend={{ data }} /></MantineProvider>);

describe('Auditor spend panel', () => {
  it('draws one bar slot per day with a text summary', () => {
    mount(spend);
    expect(document.querySelectorAll('.health-auditor-spend__slot').length).toBe(30);
    expect(screen.getByText(/Last 30 days: \$1\.06 over 21 runs\. Highest day: .*\$0\.34/)).toBeTruthy();
  });
  it('draws the daily cap line only when there is a cap', () => {
    const { unmount } = mount(spend);
    expect(document.querySelector('.health-auditor-spend__cap')).toBeTruthy();
    expect(screen.getByText('Cap $1.00')).toBeTruthy();
    unmount();
    mount({ ...spend, capUsd: null });
    expect(document.querySelector('.health-auditor-spend__cap')).toBeNull();
  });
  it('reads out a day on focus', () => {
    mount(spend);
    const slots = screen.getAllByRole('button', { name: /runs/ });
    expect(slots.length).toBe(30);
    fireEvent.focus(slots[29]);
    expect(screen.getByRole('status').textContent).toMatch(/\$0\.34 · 3 runs · 2 changed/);
  });
  it('lists cost per run by trigger and by model', () => {
    mount(spend);
    const trigger = screen.getByRole('table', { name: 'Cost per run by trigger' });
    const rows = within(trigger).getAllByRole('row');
    expect(rows.length).toBe(3);
    expect(within(rows[1]).getByText('New food captured')).toBeTruthy();
    expect(within(rows[1]).getByText('$0.0500')).toBeTruthy();
    expect(within(rows[1]).getByText('$0.60')).toBeTruthy();
    expect(within(rows[2]).getByText('Daily sweep')).toBeTruthy();
    const model = screen.getByRole('table', { name: 'Cost per run by model' });
    expect(within(model).getByText('gpt-4.1-mini')).toBeTruthy();
    expect(within(model).getByText('$0.90')).toBeTruthy();
  });
  it('shows an empty state when nothing ran in 30 days', () => {
    mount({ ...spend, days: days.map(day => ({ ...day, costUsd: 0, runs: 0, changed: 0 })), byTrigger: [], byModel: [] });
    expect(screen.getByText('No auditor runs in the last 30 days')).toBeTruthy();
    expect(document.querySelector('.health-auditor-spend__slot')).toBeNull();
  });
});
