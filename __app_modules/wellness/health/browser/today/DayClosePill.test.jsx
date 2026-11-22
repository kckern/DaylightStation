import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

import { DayClosePill } from "./DayClosePill.jsx";

const r = (ui) => render(<MantineProvider>{ui}</MantineProvider>);
// Real row shape from GET /api/v1/health/day → data[] (counted rows carry calories)
const rows = (cal) => [{ uuid: 'a', kind: 'item', status: 'accepted', calories: cal, mealTime: 'afternoon' }];
// Real dayStatus shape from GET /api/v1/health/day
const open = (extra = {}) => ({ status: null, minCalories: 1200, today: '2026-09-24', ...extra });

describe('DayClosePill', () => {
  const choose = async (item) => {
    fireEvent.click(screen.getByTestId('dayclose-pill'));
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
  };

  it('flags a past day under the threshold, quietly: a tinted pill, not a banner', () => {
    r(<DayClosePill date="2026-09-16" dayStatus={open()} items={rows(460)} />);
    const pill = screen.getByTestId('dayclose-pill');
    expect(pill.textContent).toMatch(/Only 460 cal logged/);
    expect(pill.className).toMatch(/dayclose-pill--flagged/);
  });

  it('says "Nothing logged" for an empty past day', () => {
    r(<DayClosePill date="2026-09-13" dayStatus={open()} items={[]} />);
    expect(screen.getByTestId('dayclose-pill').textContent).toMatch(/Nothing logged/);
  });

  it('fasting lives on the meals: the menu offers only Done logging', async () => {
    r(<DayClosePill date="2026-09-24" dayStatus={open()} items={rows(300)} />);
    fireEvent.click(screen.getByTestId('dayclose-pill'));
    expect(await screen.findByRole('menuitem', { name: /Done logging/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Fasted/ })).toBeNull();
  });

  it('a past day with a skipped meal is trusted: no flag, no pill', () => {
    r(<DayClosePill date="2026-09-16" dayStatus={open({ fastedMeals: ['morning'] })} items={rows(460)} />);
    expect(screen.queryByTestId('dayclose-pill')).toBeNull();
  });

  it('shows nothing for a complete past day — the coach already trusts it', () => {
    r(<DayClosePill date="2026-09-22" dayStatus={open()} items={rows(1606)} />);
    expect(screen.queryByTestId('dayclose-pill')).toBeNull();
  });

  it("never flags today, and uses the SERVER's today", () => {
    r(<DayClosePill date="2026-09-24" dayStatus={open()} items={rows(300)} />);
    const pill = screen.getByTestId('dayclose-pill');
    expect(pill.textContent).toMatch(/Close day/);
    expect(pill.className).not.toMatch(/--flagged/);
  });

  it('delegates Done logging to its owner', async () => {
    const onSet = vi.fn();
    r(<DayClosePill date="2026-09-16" dayStatus={open()} items={rows(0)} onSet={onSet} />);
    await choose(/Done logging/);
    expect(onSet).toHaveBeenCalledWith('done');
  });

  it('disables menu actions while the date submission is pending', async () => {
    r(<DayClosePill date="2026-09-16" dayStatus={open()} items={rows(0)} busy />);
    fireEvent.click(screen.getByTestId('dayclose-pill'));
    expect(await screen.findByRole('menuitem', { name: /Done logging/ })).toBeDisabled();
  });

  it('renders whatever the server says — a /fast from Telegram wins over the page', () => {
    const view = r(<DayClosePill date="2026-09-16" dayStatus={open({ status: 'done' })} items={rows(900)} />);
    expect(screen.getByTestId('dayclose-pill').textContent).toMatch(/Logging done/);
    view.rerender(<MantineProvider><DayClosePill date="2026-09-16" dayStatus={open({ status: 'fasting' })} items={rows(900)} /></MantineProvider>);
    expect(screen.getByTestId('dayclose-pill').textContent).toMatch(/Fasted/);
  });

  it('delegates Reopen to its owner', async () => {
    const onSet = vi.fn();
    r(<DayClosePill date="2026-09-16" dayStatus={open({ status: 'done' })} items={rows(900)} onSet={onSet} />);
    await choose(/Reopen day/);
    expect(onSet).toHaveBeenCalledWith(null);
  });

  it('renders a supplied submission error', () => {
    r(<DayClosePill date="2026-09-16" dayStatus={open()} items={rows(500)} error="Could not save. Try again." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
  });
});
