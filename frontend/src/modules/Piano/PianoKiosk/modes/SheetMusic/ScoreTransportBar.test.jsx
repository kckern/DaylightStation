import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

  it('exposes a labeled BPM metronome toggle in Polish (aria-pressed reflects clickActive)', () => {
    const onToggleClick = vi.fn();
    const { rerender } = render(
      <ScoreTransportBar {...base} mode="polish" clickActive={false} bpm={72} onToggleClick={onToggleClick} />,
    );
    const click = screen.getByRole('button', { name: /metronome/i });
    expect(click).toHaveAttribute('aria-pressed', 'false');
    expect(click).toHaveTextContent('72'); // live BPM readout (M4)
    expect(click.querySelector('svg')).not.toBeNull(); // QuarterNoteIcon
    fireEvent.click(click);
    expect(onToggleClick).toHaveBeenCalled();
    rerender(<ScoreTransportBar {...base} mode="polish" clickActive bpm={72} onToggleClick={onToggleClick} />);
    expect(screen.getByRole('button', { name: /metronome/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('metronome lives in Learn AND Polish, not Listen (M1/M2)', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" clickActive onToggleClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeInTheDocument();
    rerender(<ScoreTransportBar {...base} mode="listen" clickActive onToggleClick={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /metronome/i })).toBeNull();
  });

  it('is mode-aware: Perform shows no parts/transport/view controls, Polish shows run + parts', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="perform" />);
    expect(screen.queryByRole('button', { name: /^LH$/ })).toBeNull(); // no part chips
    expect(screen.queryByRole('button', { name: /pause|play/i })).toBeNull(); // no transport
    expect(screen.queryByRole('button', { name: /size/i })).toBeNull(); // no view controls
    expect(screen.queryByRole('button', { name: /metronome/i })).toBeNull(); // no click in Perform

    rerender(<ScoreTransportBar {...base} mode="polish" />);
    expect(screen.getByRole('button', { name: /^▶$|play/i })).toBeInTheDocument(); // transport present
    expect(screen.getByRole('button', { name: /LH/ })).toBeInTheDocument(); // parts present
    expect(screen.getByRole('button', { name: /metronome/i })).toBeInTheDocument(); // click lives in Polish (J1)
  });

  it('shows one part chip per staff and cycles it (>2-staff fallback)', () => {
    render(<ScoreTransportBar {...base} parts={[{ staff: 0, label: 'RH' }, { staff: 1, label: 'LH' }, { staff: 2, label: 'P3' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /LH/ }));
    expect(base.onCyclePart).toHaveBeenCalledWith(1);
  });

  it('grand-staff (2 staves) shows the Hands segmented control, not chips (J4)', () => {
    const onHandsChange = vi.fn();
    render(<ScoreTransportBar {...base} mode="learn" grandStaff handsVariant="hands" handsValue="both" onHandsChange={onHandsChange} />);
    expect(screen.getByRole('group', { name: /hands/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'LH' }));
    expect(onHandsChange).toHaveBeenCalledWith('lh');
  });

  it('grand-staff Listen shows the My-part control', () => {
    render(<ScoreTransportBar {...base} mode="listen" grandStaff handsVariant="mypart" handsValue="none" onHandsChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: /my part/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
  });

  it('perform mode: shows the page indicator (page / pages)', () => {
    render(<ScoreTransportBar {...base} mode="perform" page={1} pages={3} />);
    const indicator = screen.getByLabelText(/page/i);
    expect(indicator).toHaveTextContent('1 / 3');
  });

  it('shows position readout total', () => {
    render(<ScoreTransportBar {...base} />);
    expect(screen.getByText(/\/\s*40/)).toBeInTheDocument();
  });

  it('disables Play with a Preparing label until geometry is ready (H0)', () => {
    render(<ScoreTransportBar {...base} mode="polish" ready={false} total={0} />);
    const play = screen.getByRole('button', { name: /preparing/i });
    expect(play).toBeDisabled();
  });

  it('enables Play once ready', () => {
    render(<ScoreTransportBar {...base} mode="polish" ready total={10} />);
    const play = screen.getByRole('button', { name: /^play$|^▶$/i });
    expect(play).toBeEnabled();
  });

  it('listen mode: tempo button opens a segmented stepper that commits via onTempo on tap', () => {
    const onTempo = vi.fn();
    render(<ScoreTransportBar {...base} mode="listen" tempoMult={1} onTempo={onTempo} />);
    const tempoBtn = screen.getByRole('button', { name: /^tempo/i });
    expect(tempoBtn).toHaveTextContent(/100%/);
    fireEvent.click(tempoBtn);
    // No slider / no typed value — discrete percent steps commit on tap.
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^150%/ }));
    expect(onTempo).toHaveBeenCalledWith(1.5);
  });

  it('polish mode: tempo stepper is present and commits via onTempo; no key/play-along', () => {
    const onTempo = vi.fn();
    render(<ScoreTransportBar {...base} mode="polish" tempoMult={1} onTempo={onTempo} />);
    const tempoBtn = screen.getByRole('button', { name: /^tempo/i });
    expect(tempoBtn).toHaveTextContent(/100%/);
    fireEvent.click(tempoBtn);
    fireEvent.click(screen.getByRole('button', { name: /^75%/ }));
    expect(onTempo).toHaveBeenCalledWith(0.75);
    // Listen-only extras stay absent in Polish.
    expect(screen.queryByRole('button', { name: /transpose up/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /play along/i })).toBeNull();
  });

  it('has no Play-along toggle — Listen light-up is always on (J5)', () => {
    render(<ScoreTransportBar {...base} mode="listen" />);
    expect(screen.queryByRole('button', { name: /play along/i })).toBeNull();
  });

  it('listen mode: key + button transposes up by one semitone via onTranspose', () => {
    const onTranspose = vi.fn();
    render(<ScoreTransportBar {...base} mode="listen" transpose={1} onTranspose={onTranspose} />);
    fireEvent.click(screen.getByRole('button', { name: /transpose up/i }));
    expect(onTranspose).toHaveBeenCalledWith(2);
  });

  it('tempo is everywhere but Perform; play-along stays Listen-only', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" />);
    expect(screen.getByRole('button', { name: /tempo/i })).toBeInTheDocument(); // drives the Learn metronome (M2)
    expect(screen.queryByRole('button', { name: /play along/i })).toBeNull();
    rerender(<ScoreTransportBar {...base} mode="polish" />);
    expect(screen.getByRole('button', { name: /tempo/i })).toBeInTheDocument(); // Polish practices below tempo (J1)
    expect(screen.queryByRole('button', { name: /play along/i })).toBeNull(); // play-along still Listen-only
    rerender(<ScoreTransportBar {...base} mode="perform" />);
    expect(screen.queryByRole('button', { name: /tempo/i })).toBeNull(); // Perform is chrome-free
  });

  it('learn mode: Loop popover lists sections and fires onPickSection', () => {
    const onPickSection = vi.fn();
    const sections = [{ label: 'A', startMeasure: 1, endMeasure: 4 }];
    render(<ScoreTransportBar {...base} mode="learn" sections={sections} onPickSection={onPickSection} />);
    fireEvent.click(screen.getByRole('button', { name: /^loop/i })); // open popover
    fireEvent.click(screen.getByRole('button', { name: /^A$/ }));
    expect(onPickSection).toHaveBeenCalledWith(sections[0]);
  });

  it('learn mode: Loop popover offers Select measures… and Clear loop when active', () => {
    const onStartSelect = vi.fn();
    const onClearFocus = vi.fn();
    render(<ScoreTransportBar {...base} mode="learn" loopActive scopeLabel="m3–m6" onStartSelect={onStartSelect} onClearFocus={onClearFocus} />);
    // The active range surfaces on the trigger.
    expect(screen.getByRole('button', { name: /loop m3–m6/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /loop m3–m6/i }));
    fireEvent.click(screen.getByRole('button', { name: /select measures/i }));
    expect(onStartSelect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /loop m3–m6/i }));
    // Scope to the popover — the standalone one-tap clear also matches /clear loop/i.
    const menu = screen.getByRole('dialog', { name: /loop range/i });
    fireEvent.click(within(menu).getByRole('button', { name: /clear loop/i }));
    expect(onClearFocus).toHaveBeenCalled();
  });

  it('Loop control is Listen + Learn + Polish (absent only in Perform) (L6)', () => {
    const { unmount } = render(<ScoreTransportBar {...base} mode="perform" />);
    expect(screen.queryByRole('button', { name: /^loop/i })).toBeNull();
    unmount();
    for (const mode of ['listen', 'learn', 'polish']) {
      const { unmount: u } = render(<ScoreTransportBar {...base} mode={mode} />);
      expect(screen.getByRole('button', { name: /^loop/i })).toBeInTheDocument();
      u();
    }
  });

  it('has no Scoring toggle — Polish always grades (J5)', () => {
    render(<ScoreTransportBar {...base} mode="polish" />);
    expect(screen.queryByRole('button', { name: /scoring/i })).toBeNull();
  });

  it('shows a measure readout (m X / Y) when a measure count is provided (L2)', () => {
    render(<ScoreTransportBar {...base} mode="learn" measure={3} measureTotal={24} />);
    expect(screen.getByText('m 3 / 24')).toBeInTheDocument();
  });

  it('Restart button appears only when there is a run to restart (Polish)', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="polish" canRestart={false} />);
    expect(screen.queryByRole('button', { name: /restart/i })).toBeNull();
    rerender(<ScoreTransportBar {...base} mode="polish" canRestart />);
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
  });

  it('View menu (⋯) holds size as a segmented stepper (no slider), commits scale on tap', () => {
    render(<ScoreTransportBar {...base} />);
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    expect(screen.getByRole('dialog', { name: /view/i })).toBeInTheDocument();
    // No slider / no typed value — discrete percent steps commit on tap.
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '125%' }));
    expect(base.onScale).toHaveBeenCalledWith(1.25);
  });

  it('single-open popovers: opening the View menu closes Tempo (M4)', () => {
    render(<ScoreTransportBar {...base} mode="listen" tempoMult={1} onTempo={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^tempo/i }));
    expect(screen.getByRole('dialog', { name: /tempo/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    expect(screen.queryByRole('dialog', { name: /tempo/i })).toBeNull(); // tempo closed
    expect(screen.getByRole('dialog', { name: /view/i })).toBeInTheDocument();
  });

  it('memoization: advancing step re-renders only the position readout, not the expensive body', () => {
    // onBodyRender fires once per real render of the memoized ScoreViewControls
    // (the ~250-line part/chip/popover cluster). It is stable across rerenders, so
    // React.memo can still bail when only `step` changes.
    const onBodyRender = vi.fn();
    const props = { ...base, step: 0, onBodyRender }; // every value kept referentially stable

    const { rerender } = render(<ScoreTransportBar {...props} />);
    expect(onBodyRender).toHaveBeenCalledTimes(1); // mounted → body rendered once
    expect(screen.getByText('1 / 40')).toBeInTheDocument();

    // Change ONLY step; all other props keep identity → the memo must bail.
    rerender(<ScoreTransportBar {...props} step={5} />);
    expect(screen.getByText('6 / 40')).toBeInTheDocument(); // readout DID update
    expect(onBodyRender).toHaveBeenCalledTimes(1); // body did NOT re-render

    // A step advance never re-renders the body…
    rerender(<ScoreTransportBar {...props} step={9} />);
    expect(screen.getByText('10 / 40')).toBeInTheDocument();
    expect(onBodyRender).toHaveBeenCalledTimes(1);

    // …but a genuine body-prop change (mode) does.
    rerender(<ScoreTransportBar {...props} step={9} mode="polish" />);
    expect(onBodyRender).toHaveBeenCalledTimes(2);
  });

  it('memoization: mode tabs + transport buttons are unaffected by a step advance', () => {
    // Sanity: the shell still threads props correctly across a step change — the
    // tabs, transport, and readout all remain present & correct.
    const props = { ...base, mode: 'polish', step: 0 };
    const { rerender } = render(<ScoreTransportBar {...props} />);
    expect(screen.getByRole('tab', { name: /polish/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /pause|play/i })).toBeInTheDocument();

    rerender(<ScoreTransportBar {...props} step={3} />);
    expect(screen.getByText('4 / 40')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /polish/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /pause|play/i })).toBeInTheDocument();
  });
});
