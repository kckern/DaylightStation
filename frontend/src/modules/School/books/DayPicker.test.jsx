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
    fireEvent.click(screen.getByRole('button', { name: /that's the day/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /that's the day/i }));
    expect(onConfirm).toHaveBeenCalledWith('2026-08-30');
  });

  it('can move to an older window instead of imposing a hidden three-week limit', () => {
    const onConfirm = vi.fn();
    render(<DayPicker today="2026-09-02" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /pick a day/i }));
    fireEvent.click(screen.getByRole('button', { name: /earlier dates/i }));
    fireEvent.click(screen.getByRole('gridcell', { name: /Sunday 2 August/ }));
    fireEvent.click(screen.getByRole('button', { name: /that's the day/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /that's the day/i }));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-02');
  });

  it('a missing onConfirm fails loudly, like a missing today', () => {
    render(<DayPicker today="2026-09-02" />);
    expect(() => fireEvent.click(screen.getByRole('button', { name: /that's the day/i }))).toThrow();
  });

  it('freezes the date controls while a write is busy', () => {
    const onConfirm = vi.fn();
    render(<DayPicker today="2026-09-02" busy onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: /pick a day/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /that's the day/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /that's the day/i }));
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

      const confirm = screen.getByRole('button', { name: /that's the day/i });
      fireEvent.pointerDown(confirm);
      expect(onConfirm).toHaveBeenCalledWith('2026-08-30');
      fireEvent.click(confirm);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
