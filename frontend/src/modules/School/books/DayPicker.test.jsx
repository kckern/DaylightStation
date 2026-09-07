import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DayPicker from './DayPicker.jsx';

describe('DayPicker', () => {
  it('collapsed: shows today and an affordance to open the grid', () => {
    render(<DayPicker today="2026-09-02" onConfirm={() => {}} />);
    expect(screen.getByText(/Today · Wed 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick a day/i })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('confirming while collapsed confirms today', () => {
    const onConfirm = vi.fn();
    render(<DayPicker today="2026-09-02" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Save finish/ }));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-02');
  });

  it('opened: renders the weekday header once, the crossing row as one row, today pre-selected, no future cells', () => {
    render(<DayPicker today="2026-09-02" onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));
    expect(screen.getAllByText('Mon')).toHaveLength(1);
    const rows = screen.getAllByRole('row');
    const crossing = rows.find((r) => r.textContent.includes('31') && r.textContent.includes('1'));
    expect(crossing).toBeTruthy();
    const today = screen.getByRole('gridcell', { name: /Wednesday 2 September/ });
    expect(today).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('gridcell', { name: /3 September/ })).toBeNull();
  });

  it('shows the month only where it changes', () => {
    render(<DayPicker today="2026-09-02" onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));
    expect(screen.getAllByText(/^Sep$/)).toHaveLength(1);
    expect(screen.getAllByText(/^Aug$/)).toHaveLength(1);
  });

  it('tapping a day selects it and confirming emits that key', () => {
    const onConfirm = vi.fn();
    render(<DayPicker today="2026-09-02" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));
    fireEvent.click(screen.getByRole('gridcell', { name: /Sunday 30 August/ }));
    expect(screen.getByRole('gridcell', { name: /Sunday 30 August/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Save finish/ }));
    expect(onConfirm).toHaveBeenCalledWith('2026-08-30');
  });

  it('can move to an older window instead of imposing a hidden three-week limit', () => {
    const onConfirm = vi.fn();
    render(<DayPicker today="2026-09-02" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));
    fireEvent.click(screen.getByRole('button', { name: /earlier dates/i }));
    fireEvent.click(screen.getByRole('gridcell', { name: /Sunday 2 August/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save finish/ }));
    expect(onConfirm).toHaveBeenCalledWith('2026-08-02');
    expect(screen.getByRole('button', { name: /later dates/i })).toBeEnabled();
  });

  it('stops paging before the visible window spills beyond the preceding year', () => {
    render(<DayPicker today="2026-09-02" onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));
    const earlier = screen.getByRole('button', { name: /earlier dates/i });
    for (let page = 0; page < 16; page += 1) fireEvent.click(earlier);
    expect(earlier).toBeDisabled();
    const labels = screen.getAllByRole('gridcell').map((cell) => cell.getAttribute('aria-label'));
    expect(labels).toContain('Monday 8 September');
    expect(labels).not.toContain('Monday 1 September');
  });

  it('refuses a bad today prop loudly', () => {
    expect(() => render(<DayPicker today="bad" onConfirm={() => {}} />)).toThrow(/YYYY-MM-DD/);
  });

  it('clamps a future value to today — a backdated finish is never a future date', () => {
    const onConfirm = vi.fn();
    render(<DayPicker today="2026-09-02" value="2026-09-10" onConfirm={onConfirm} />);
    expect(screen.getByText(/Today · Wed 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save finish/ }));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-02');
  });

  it('a missing onConfirm fails loudly, like a missing today', () => {
    render(<DayPicker today="2026-09-02" />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: /Save finish/ }))).toThrow();
  });

  it('freezes the date controls while a write is busy', () => {
    const onConfirm = vi.fn();
    render(<DayPicker today="2026-09-02" busy onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: /pick a day/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save finish/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Save finish/ }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  describe('fires on touch-down like every other shelf tappable (review n4)', () => {
    it('pointerdown opens the grid, picks a day and confirms — and the trailing click does not fire twice', () => {
      const onConfirm = vi.fn();
      const onChange = vi.fn();
      render(<DayPicker today="2026-09-02" onConfirm={onConfirm} onChange={onChange} />);
      const toggle = screen.getByRole('button', { name: /pick a day/i });
      fireEvent.pointerDown(toggle);
      expect(screen.getByRole('grid')).toBeInTheDocument(); // the finger landing is the tap
      fireEvent.click(toggle); // the browser's compatibility click, ~0ms later
      expect(screen.getByRole('grid')).toBeInTheDocument(); // not toggled back shut

      const cell = screen.getByRole('gridcell', { name: /Sunday 30 August/ });
      fireEvent.pointerDown(cell);
      expect(onChange).toHaveBeenCalledWith('2026-08-30');
      fireEvent.click(cell);
      expect(onChange).toHaveBeenCalledTimes(1);

      const confirm = screen.getByRole('button', { name: /Save finish/ });
      fireEvent.pointerDown(confirm);
      expect(onConfirm).toHaveBeenCalledWith('2026-08-30');
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * THE FLOOR THE SERVER NAMES (2026-09-06).
 *
 * A finish may not be dated more than `MAX_BACKDATE_DAYS` back — the write path
 * refuses it (`isBackdateAllowed`). The picker must not OFFER such a day: a
 * child who taps one and is told no has been invited into a dead end by the
 * control itself. `minDay` arrives on the shelf view as `earliestFinishDay`, so
 * the bound has one author and the panel never carries a second copy of "14".
 */
describe('DayPicker — minDay, the backdate floor', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));

  it('blanks days before the floor, exactly as it blanks the future', () => {
    render(<DayPicker today="2026-09-02" minDay="2026-08-26" onConfirm={() => {}} />);
    open();
    expect(screen.getByRole('gridcell', { name: /Wednesday 26 August/ })).toBeInTheDocument();
    expect(screen.queryByRole('gridcell', { name: /25 August/ })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: /24 August/ })).toBeNull();
  });

  it('stops paging back once the next page would be entirely blank', () => {
    render(<DayPicker today="2026-09-02" minDay="2026-08-26" onConfirm={() => {}} />);
    open();
    expect(screen.getByRole('button', { name: /earlier dates/i })).toBeDisabled();
  });

  it('clamps an initial value that is older than the floor', () => {
    const onConfirm = vi.fn();
    render(<DayPicker today="2026-09-02" minDay="2026-08-26" value="2026-07-01" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Save finish/ }));
    expect(onConfirm).toHaveBeenCalledWith('2026-08-26');
  });

  it('keeps the full year window when the server named no floor', () => {
    // A server that said nothing must not silently shrink the control. Absent
    // and malformed are the same answer: no floor.
    for (const minDay of [undefined, null, '', 'not-a-day', '2026-02-31']) {
      const { unmount } = render(<DayPicker today="2026-09-02" minDay={minDay} onConfirm={() => {}} />);
      open();
      expect(screen.getByRole('gridcell', { name: /13 August/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /earlier dates/i })).not.toBeDisabled();
      unmount();
    }
  });
});

it('compact date task keeps the calendar and save visible without a redundant close control', () => {
  render(<DayPicker today="2026-09-07" initiallyOpen compact onConfirm={() => {}} />);
  expect(screen.getByRole('grid')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Save finish/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'close' })).toBeNull();
});
