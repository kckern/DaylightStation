import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import LoopControl from './LoopControl.jsx';

describe('LoopControl', () => {
  it('inactive: shows "Loop" with a chevron and no clear button', () => {
    render(<LoopControl active={false} scopeLabel="" sections={[]} />);
    const trigger = screen.getByRole('button', { name: 'Loop' });
    expect(trigger).toHaveTextContent('Loop');
    expect(trigger.querySelector('svg')).not.toBeNull(); // chevron-down icon
    expect(screen.queryByRole('button', { name: /clear loop/i })).toBeNull();
  });

  it('active: shows the range in the trigger label and a one-tap clear (L2)', () => {
    const onClear = vi.fn();
    render(<LoopControl active scopeLabel="m9–m16" sections={[]} onClearFocus={onClear} />);
    const trigger = screen.getByRole('button', { name: 'Loop' });
    expect(trigger).toHaveTextContent('Loop m9–m16');
    fireEvent.click(screen.getByRole('button', { name: /clear loop/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('active: the trigger keeps its chevron — it still opens the sheet (C4)', () => {
    render(<LoopControl active scopeLabel="m9–m16" sections={[]} onClearFocus={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Loop' });
    expect(trigger.querySelector('svg')).not.toBeNull(); // chevron-down icon on the TRIGGER itself
  });

  it('sheet offers sections, Select measures…, and (when active) Clear loop', () => {
    const onPick = vi.fn();
    render(<LoopControl active scopeLabel="A" sections={[{ label: 'A' }]} onPickSection={onPick} onStartSelect={() => {}} onClearFocus={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onPick).toHaveBeenCalledWith({ label: 'A' });
  });

  it('active sheet offers endpoint nudging that does not close the sheet (L2)', () => {
    const onNudge = vi.fn();
    render(<LoopControl active scopeLabel="m9–m16" sections={[]} onNudge={onNudge} onStartSelect={() => {}} onClearFocus={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
    fireEvent.click(screen.getByRole('button', { name: /start earlier/i }));
    expect(onNudge).toHaveBeenCalledWith('in', -1);
    expect(screen.getByRole('button', { name: /end later/i })).toBeInTheDocument(); // sheet still open
  });

  it('inactive: the open sheet has no Clear loop option', () => {
    render(<LoopControl active={false} scopeLabel="" sections={[{ label: 'A' }]} onPickSection={() => {}} onStartSelect={() => {}} onClearFocus={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
    const sheet = screen.getByRole('dialog', { name: 'Loop' });
    expect(within(sheet).queryByRole('button', { name: /clear loop/i })).toBeNull();
  });
});
