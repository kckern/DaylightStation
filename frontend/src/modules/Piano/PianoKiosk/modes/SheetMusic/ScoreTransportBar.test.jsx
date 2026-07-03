import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreTransportBar from './ScoreTransportBar.jsx';

const base = {
  mode: 'learn', onMode: vi.fn(),
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
  it('renders the four named mode tabs (Listen/Learn/Polish/Perform) and fires onMode', () => {
    render(<ScoreTransportBar {...base} />);
    for (const name of [/listen/i, /learn/i, /polish/i, /perform/i]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('tab', { name: /polish/i }));
    expect(base.onMode).toHaveBeenCalledWith('polish');
  });

  it('exposes a metronome-click toggle in Learn/Listen (aria-pressed reflects clickOn)', () => {
    const onToggleClick = vi.fn();
    const { rerender } = render(
      <ScoreTransportBar {...base} clickOn={false} onToggleClick={onToggleClick} />,
    );
    const click = screen.getByRole('button', { name: /metronome click/i });
    expect(click).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(click);
    expect(onToggleClick).toHaveBeenCalled();
    rerender(<ScoreTransportBar {...base} clickOn onToggleClick={onToggleClick} />);
    expect(screen.getByRole('button', { name: /metronome click/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('is mode-aware: Perform shows no parts/transport/view controls, Polish shows run + parts', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="perform" />);
    expect(screen.queryByRole('button', { name: /^LH$/ })).toBeNull(); // no part chips
    expect(screen.queryByRole('button', { name: /pause|play/i })).toBeNull(); // no transport
    expect(screen.queryByRole('button', { name: /size/i })).toBeNull(); // no view controls
    expect(screen.queryByRole('button', { name: /metronome click/i })).toBeNull(); // no click in Perform

    rerender(<ScoreTransportBar {...base} mode="polish" />);
    expect(screen.getByRole('button', { name: /^▶$|play/i })).toBeInTheDocument(); // transport present
    expect(screen.getByRole('button', { name: /LH/ })).toBeInTheDocument(); // parts present
    expect(screen.queryByRole('button', { name: /metronome click/i })).toBeNull(); // no click in Polish
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
