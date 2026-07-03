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

  it('listen mode: tempo button opens a modal whose slider commits via onTempo on release', () => {
    const onTempo = vi.fn();
    render(<ScoreTransportBar {...base} mode="listen" tempoMult={1} onTempo={onTempo} />);
    // Not present outside Listen.
    const tempoBtn = screen.getByRole('button', { name: /tempo/i });
    expect(tempoBtn).toHaveTextContent(/100%/);
    fireEvent.click(tempoBtn);
    const slider = screen.getByRole('slider', { name: /tempo/i });
    fireEvent.change(slider, { target: { value: '1.5' } });
    fireEvent.mouseUp(slider); // commit on release
    expect(onTempo).toHaveBeenCalledWith(1.5);
  });

  it('listen mode: play-along toggle fires onTogglePlayAlong and reflects aria-pressed', () => {
    const onTogglePlayAlong = vi.fn();
    const { rerender } = render(
      <ScoreTransportBar {...base} mode="listen" playAlong={false} onTogglePlayAlong={onTogglePlayAlong} />,
    );
    const toggle = screen.getByRole('button', { name: /play along/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onTogglePlayAlong).toHaveBeenCalled();
    rerender(<ScoreTransportBar {...base} mode="listen" playAlong onTogglePlayAlong={onTogglePlayAlong} />);
    expect(screen.getByRole('button', { name: /play along/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('listen mode: key + button transposes up by one semitone via onTranspose', () => {
    const onTranspose = vi.fn();
    render(<ScoreTransportBar {...base} mode="listen" transpose={1} onTranspose={onTranspose} />);
    fireEvent.click(screen.getByRole('button', { name: /transpose up/i }));
    expect(onTranspose).toHaveBeenCalledWith(2);
  });

  it('tempo + play-along are Listen-only (absent in Learn/Polish/Perform)', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" />);
    expect(screen.queryByRole('button', { name: /tempo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /play along/i })).toBeNull();
    rerender(<ScoreTransportBar {...base} mode="polish" />);
    expect(screen.queryByRole('button', { name: /tempo/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /play along/i })).toBeNull();
  });

  it('learn mode: renders a section chip per section and fires onPickSection with it', () => {
    const onPickSection = vi.fn();
    const sections = [{ label: 'A', startMeasure: 1, endMeasure: 4 }];
    render(<ScoreTransportBar {...base} mode="learn" sections={sections} onPickSection={onPickSection} />);
    fireEvent.click(screen.getByRole('button', { name: /^A$/ }));
    expect(onPickSection).toHaveBeenCalledWith(sections[0]);
  });

  it('learn mode: Loop toggle reflects loopArm; Clear appears only with an active range', () => {
    const onArmLoop = vi.fn();
    const onClearFocus = vi.fn();
    const { rerender } = render(
      <ScoreTransportBar {...base} mode="learn" loopArm={false} onArmLoop={onArmLoop} onClearFocus={onClearFocus} />,
    );
    const loop = screen.getByRole('button', { name: /loop range/i });
    expect(loop).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(loop);
    expect(onArmLoop).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /clear range/i })).toBeNull(); // no range yet

    rerender(
      <ScoreTransportBar {...base} mode="learn" loopArm
        focus={{ kind: 'custom', inMeasure: 2, outMeasure: 5 }} onClearFocus={onClearFocus} />,
    );
    expect(screen.getByRole('button', { name: /loop range/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('m3–m6')).toBeInTheDocument(); // 1-based readout
    fireEvent.click(screen.getByRole('button', { name: /clear range/i }));
    expect(onClearFocus).toHaveBeenCalled();
  });

  it('focus cluster is Learn-only (absent in Listen/Polish/Perform)', () => {
    for (const mode of ['listen', 'polish', 'perform']) {
      const { unmount } = render(<ScoreTransportBar {...base} mode={mode} sections={[{ label: 'A', startMeasure: 1, endMeasure: 4 }]} />);
      expect(screen.queryByRole('button', { name: /loop range/i })).toBeNull();
      unmount();
    }
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
