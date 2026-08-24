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
  addressing: { vocabulary: 'chords', shuffle: 'each_turn' },
  feedback: { flash_rejected: true, toast: true },
};

describe('ChessSettingsPanel', () => {
  it('offers every rung from the config as a tap target', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    for (const label of ['First moves', 'Learner', 'Steady']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }
  });

  it('marks the active rung — as a chosen radio, not a pressed toggle', () => {
    // `aria-pressed` says "this button is stuck down"; a set where exactly one
    // option is chosen is a radiogroup, and assistive tech reads the two very
    // differently ("pressed" vs "1 of 3, selected").
    render(<ChessSettingsPanel config={CONFIG} rungId="steady" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Steady' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Learner' }).getAttribute('aria-checked')).toBe('false');
  });

  it('emits a sparse patch when a rung is chosen', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Steady' }));
    expect(onChange).toHaveBeenCalledWith({ default_rung: 'steady' });
  });

  it('offers no hint-level control — help is a gesture at the keys, not a setting', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('Show legal moves')).toBeNull();
    expect(screen.queryByRole('button', { name: /always/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /after a mistake/i })).toBeNull();
  });

  it('offers the shuffle switch and the reply-speed choice', () => {
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('switch', { name: /shuffle/i })).toBeTruthy();
    // In words, not milliseconds — "700 ms" is not a unit anyone chooses in.
    for (const label of ['Quick', 'Normal', 'Thoughtful']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    }
    expect(screen.queryByText(/\d+ ms/)).toBeNull();
  });

  it('emits patches for shuffle and reply speed in config shape', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: /shuffle/i }));
    expect(onChange).toHaveBeenCalledWith({ addressing: { shuffle: 'never' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Thoughtful' }));
    expect(onChange).toHaveBeenCalledWith({ opponent_delay_ms: 1200 });
  });

  it('is a real dialog: announced, labelled, and dismissable from the keyboard', () => {
    const onClose = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Settings');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('marks the square-naming switch from the config', () => {
    // Two buttons that said "Show chords" and "Hide chords" were one boolean
    // wearing a segmented control — and a segmented control implies the options
    // are peers, when one of them is simply "off".
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('switch', { name: /show the chord/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('marks it off when the config says false', () => {
    const config = { ...CONFIG, feedback: { ...CONFIG.feedback, show_destination_labels: false } };
    render(<ChessSettingsPanel config={config} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('switch', { name: /show the chord/i }).getAttribute('aria-checked')).toBe('false');
  });

  it('emits the label patch in config shape, nested under feedback', () => {
    const onChange = vi.fn();
    render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: /show the chord/i }));
    expect(onChange).toHaveBeenCalledWith({ feedback: { show_destination_labels: false } });
  });

  it('uses no sliders — every control is a discrete tap target', () => {
    const { container } = render(<ChessSettingsPanel config={CONFIG} rungId="learner" onChange={() => {}} onClose={() => {}} />);
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });
});
