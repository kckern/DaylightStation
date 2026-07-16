import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import LoopControl from './LoopControl.jsx';

describe('LoopControl', () => {
  it('inactive: shows "Loop" with a chevron and no clear button', () => {
    render(<LoopControl active={false} scopeLabel="" sections={[]} />);
    const trigger = screen.getByRole('button', { name: /^loop/i });
    expect(trigger).toHaveTextContent('Loop');
    expect(trigger.querySelector('svg')).not.toBeNull(); // ChevronDownIcon
    expect(screen.queryByRole('button', { name: /clear loop/i })).toBeNull();
  });

  it('active: shows the range in the trigger and a one-tap clear (L2)', () => {
    const onClear = vi.fn();
    render(<LoopControl active scopeLabel="m9–m16" sections={[]} onClearFocus={onClear} />);
    expect(screen.getByRole('button', { name: /loop m9/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear loop/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('menu offers sections, Select measures…, and (when active) Clear loop', () => {
    const onPick = vi.fn();
    render(<LoopControl active scopeLabel="A" sections={[{ label: 'A' }]} onPickSection={onPick} onStartSelect={() => {}} onClearFocus={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /loop a/i }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onPick).toHaveBeenCalledWith({ label: 'A' });
  });

  it('active menu offers endpoint nudging that does not close the menu (L2)', () => {
    const onNudge = vi.fn();
    render(<LoopControl active scopeLabel="m9–m16" sections={[]} onNudge={onNudge} onStartSelect={() => {}} onClearFocus={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /loop m9/i }));
    fireEvent.click(screen.getByRole('button', { name: /start earlier/i }));
    expect(onNudge).toHaveBeenCalledWith('in', -1);
    expect(screen.getByRole('button', { name: /end later/i })).toBeInTheDocument(); // menu still open
  });

  it('inactive: the open menu has no Clear loop option', () => {
    render(<LoopControl active={false} scopeLabel="" sections={[{ label: 'A' }]} onPickSection={() => {}} onStartSelect={() => {}} onClearFocus={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^loop/i }));
    const menu = screen.getByRole('dialog', { name: /loop range/i });
    expect(within(menu).queryByRole('button', { name: /clear loop/i })).toBeNull();
  });
});
