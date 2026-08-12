import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChessSettingsPanel from './ChessSettingsPanel.jsx';

const CONFIG = {
  default_rung: 'learner',
  rungs: [
    { id: 'first-moves', label: 'First moves', skill: 0, movetime_ms: 100 },
    { id: 'learner', label: 'Learner', skill: 3, movetime_ms: 200 },
    { id: 'steady', label: 'Steady', skill: 8, movetime_ms: 300 },
  ],
  opponent_delay_ms: 700,
  shuffle_each_turn: true,
  feedback: { flash_rejected: true, toast: true },
};

describe('ChessSettingsPanel', () => {
  it('offers every rung from the config as a tap target', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    for (const label of ['First moves', 'Learner', 'Steady']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('marks the active rung', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="steady" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Steady' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('emits a sparse patch when a rung is chosen', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Steady' }));
    expect(onChange).toHaveBeenCalledWith({ default_rung: 'steady' });
  });

  it('offers no hint-level control — help is a gesture at the keys, not a setting', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('Show legal moves')).toBeNull();
    expect(screen.queryByRole('button', { name: /always/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /after a mistake/i })).toBeNull();
  });

  it('offers the shuffle and opponent-delay controls too', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /shuffle/i })).toBeTruthy();
    for (const label of ['300', '700', '1200']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('emits patches for shuffle and delay in config shape', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle/i }));
    expect(onChange).toHaveBeenCalledWith({ shuffle_each_turn: false });
    fireEvent.click(screen.getByRole('button', { name: /1200/ }));
    expect(onChange).toHaveBeenCalledWith({ opponent_delay_ms: 1200 });
  });

  it('offers the destination-label toggle as two discrete tap targets', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Show chords' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide chords' })).toBeTruthy();
  });

  it('marks the active label choice, defaulting to on when the key is absent', () => {
    // CONFIG carries no show_destination_labels — absent means on.
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Show chords' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hide chords' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('marks Hide when the config says false', () => {
    const config = { ...CONFIG, feedback: { ...CONFIG.feedback, show_destination_labels: false } };
    render(<ChessSettingsPanel config={config} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Hide chords' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Show chords' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('emits the label patch in config shape, nested under feedback', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide chords' }));
    expect(onChange).toHaveBeenCalledWith({ feedback: { show_destination_labels: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Show chords' }));
    expect(onChange).toHaveBeenCalledWith({ feedback: { show_destination_labels: true } });
  });

  it('uses no sliders — every control is a discrete tap target', () => {
    const { container } = render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });
});
