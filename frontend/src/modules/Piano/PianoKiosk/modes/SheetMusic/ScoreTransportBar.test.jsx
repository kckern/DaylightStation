import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreTransportBar from './ScoreTransportBar.jsx';

const base = {
  mode: 'follow', onMode: vi.fn(),
  running: false, onToggleRun: vi.fn(), onReset: vi.fn(),
  step: 0, total: 40,
  flow: 'wrapped', onToggleFlow: vi.fn(),
  scale: 1, onScale: vi.fn(),
  parts: [{ staff: 0, label: 'RH' }, { staff: 1, label: 'LH' }],
  activeParts: { 0: true, 1: true }, roles: {}, onCyclePart: vi.fn(),
  keyboardVisible: true, onToggleKeyboard: vi.fn(),
  meta: { title: 'X', tempo: 90 },
};

describe('ScoreTransportBar', () => {
  it('renders the four mode tabs and fires onMode', () => {
    render(<ScoreTransportBar {...base} />);
    fireEvent.click(screen.getByRole('tab', { name: /metronome/i }));
    expect(base.onMode).toHaveBeenCalledWith('metronome');
  });

  it('shows one part chip per staff and cycles it', () => {
    render(<ScoreTransportBar {...base} />);
    fireEvent.click(screen.getByRole('button', { name: /LH/ }));
    expect(base.onCyclePart).toHaveBeenCalledWith(1);
  });

  it('shows position readout total', () => {
    render(<ScoreTransportBar {...base} />);
    expect(screen.getByText(/\/\s*40/)).toBeInTheDocument();
  });

  it('size is a single button that opens a modal (no inline +/-), and commits scale on release', () => {
    render(<ScoreTransportBar {...base} />);
    const sizeBtn = screen.getByRole('button', { name: /size/i });
    expect(screen.queryByRole('button', { name: /^A[−-]$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^A\+$/ })).toBeNull();
    fireEvent.click(sizeBtn);
    const slider = screen.getByRole('slider', { name: /size/i });
    fireEvent.change(slider, { target: { value: '1.3' } });
    fireEvent.mouseUp(slider); // commit on release
    expect(base.onScale).toHaveBeenCalledWith(1.3);
  });
});
