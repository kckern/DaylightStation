import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LearnTempoSheet from './LearnTempoSheet.jsx';
import { TEMPO_STAGES } from './tempoStages.js';

const base = { open: true, stages: TEMPO_STAGES, selectedId: 'steady', effectiveBpm: 54, onPick: vi.fn(), onClose: vi.fn() };

describe('LearnTempoSheet', () => {
  it('offers six direct buttons with the current choice selected', () => {
    render(<LearnTempoSheet {...base} />);
    const options = within(screen.getByRole('group', { name: 'Tempo stages' }));
    expect(options.getAllByRole('button').map((button) => button.textContent)).toEqual(['Extra slow', 'Very slow', 'Slow', 'Steady', 'Nearly there', 'Full speed']);
    expect(options.getByRole('button', { name: 'Steady' })).toHaveAttribute('aria-pressed', 'true');
    expect(options.getByRole('button', { name: 'Slow' })).toHaveAttribute('aria-pressed', 'false');
    expect(options.getByRole('button', { name: 'Steady' })).toHaveFocus();
    expect(screen.getByText('54 BPM')).toBeInTheDocument();
  });

  it('picks one stage exactly once and closes', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<LearnTempoSheet {...base} onPick={onPick} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Very slow' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ id: 'very-slow', label: 'Very slow', percent: 25 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['Escape', 'Back'])('closes with %s without choosing a stage', (action) => {
    const onClose = vi.fn();
    const onPick = vi.fn();
    render(<LearnTempoSheet {...base} onClose={onClose} onPick={onPick} />);
    if (action === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('returns focus to its launcher after dismissal', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Choose tempo</button><LearnTempoSheet {...base} open={open} onClose={() => setOpen(false)} /></>;
    }
    render(<Harness />);
    const launcher = screen.getByRole('button', { name: 'Choose tempo' });
    launcher.focus();
    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });

  it('renders no dialog when closed', () => {
    render(<LearnTempoSheet {...base} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
