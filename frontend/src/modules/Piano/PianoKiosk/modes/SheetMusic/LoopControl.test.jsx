import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import LoopControl from './LoopControl.jsx';

describe('LoopControl', () => {
  it('with no range, the loop toggle starts on-score selection', () => {
    const onStartSelect = vi.fn();
    render(<LoopControl active={false} onStartSelect={onStartSelect} onToggleEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }));
    expect(onStartSelect).toHaveBeenCalled();
  });

  it('with a range, the toggle flips looping without clearing', () => {
    const onToggleEnabled = vi.fn(); const onClearFocus = vi.fn();
    render(<LoopControl active enabled scopeLabel="m9–m16" onToggleEnabled={onToggleEnabled} onClearFocus={onClearFocus} />);
    const btn = screen.getByRole('button', { name: 'Loop' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn.textContent).toContain('m9–m16');
    fireEvent.click(btn);
    expect(onToggleEnabled).toHaveBeenCalled();
    expect(onClearFocus).not.toHaveBeenCalled();
  });

  it('disabled-but-set range shows unlit toggle', () => {
    render(<LoopControl active enabled={false} scopeLabel="m9–m16" onToggleEnabled={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the chevron opens the loop sheet', () => {
    render(<LoopControl active sections={[{ label: 'A' }]} onToggleEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop options' }));
    expect(screen.getByRole('dialog', { name: 'Loop' })).toBeInTheDocument();
  });

  it('inactive: the trigger has no clear button and the chevron is separate', () => {
    render(<LoopControl active={false} scopeLabel="" sections={[]} onToggleEnabled={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Loop' });
    expect(trigger).toHaveTextContent(''); // no scope label when inactive
    expect(trigger.querySelector('svg')).not.toBeNull(); // repeat icon
    expect(screen.getByRole('button', { name: 'Loop options' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear loop/i })).toBeNull();
  });

  it('active: shows the range in the trigger label and a one-tap clear (L2)', () => {
    const onClear = vi.fn();
    render(<LoopControl active enabled scopeLabel="m9–m16" onClearFocus={onClear} onToggleEnabled={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Loop' });
    expect(trigger).toHaveTextContent('m9–m16');
    fireEvent.click(screen.getByRole('button', { name: /clear loop/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('sheet (opened via the chevron) offers sections, Select measures…, and (when active) Clear loop', () => {
    const onPick = vi.fn();
    render(<LoopControl active enabled scopeLabel="A" sections={[{ label: 'A' }]} onPickSection={onPick} onStartSelect={() => {}} onClearFocus={() => {}} onToggleEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop options' }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onPick).toHaveBeenCalledWith({ label: 'A' });
  });

  it('active sheet offers endpoint nudging that does not close the sheet (L2)', () => {
    const onNudge = vi.fn();
    render(<LoopControl active enabled scopeLabel="m9–m16" sections={[]} onNudge={onNudge} onStartSelect={() => {}} onClearFocus={() => {}} onToggleEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop options' }));
    fireEvent.click(screen.getByRole('button', { name: /start earlier/i }));
    expect(onNudge).toHaveBeenCalledWith('in', -1);
    expect(screen.getByRole('button', { name: /end later/i })).toBeInTheDocument(); // sheet still open
  });

  it('inactive: the open sheet has no Clear loop option', () => {
    render(<LoopControl active={false} scopeLabel="" sections={[{ label: 'A' }]} onPickSection={() => {}} onStartSelect={() => {}} onClearFocus={() => {}} onToggleEnabled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Loop options' }));
    const sheet = screen.getByRole('dialog', { name: 'Loop' });
    expect(within(sheet).queryByRole('button', { name: /clear loop/i })).toBeNull();
  });
});
