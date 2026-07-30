import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreTransportBar from './ScoreTransportBar.jsx';

const base = {
  mode: 'learn',
  running: false, onToggleRun: vi.fn(), onReset: vi.fn(),
  step: 0, total: 40,
  flow: 'wrapped', onToggleFlow: vi.fn(),
  scale: 1, onScale: vi.fn(),
  parts: [{ staff: 0, label: 'RH' }, { staff: 1, label: 'LH' }],
  activeParts: { 0: true, 1: true }, onCyclePart: vi.fn(),
  keyboardVisible: true, onToggleKeyboard: vi.fn(),
};

describe('ScoreTransportBar', () => {
  it('is an icon-only metronome toggle in Polish — no BPM readout (aria-pressed reflects clickActive)', () => {
    const onToggleClick = vi.fn();
    const { rerender } = render(
      <ScoreTransportBar {...base} mode="polish" clickActive={false} bpm={72} onToggleClick={onToggleClick} />,
    );
    const click = screen.getByRole('button', { name: 'Metronome' });
    expect(click).toHaveAttribute('aria-pressed', 'false');
    expect(click.textContent).toBe(''); // icon-only — no bpm span (wave-2 T6)
    expect(click.querySelector('svg')).not.toBeNull(); // MetronomeIcon
    fireEvent.click(click);
    expect(onToggleClick).toHaveBeenCalled();
    rerender(<ScoreTransportBar {...base} mode="polish" clickActive bpm={72} onToggleClick={onToggleClick} />);
    expect(screen.getByRole('button', { name: 'Metronome' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('metronome ACTS in Learn, Polish AND Listen — gated in place by clickDisabled, never unmounted (M1/M2, C2, wave-3 G)', () => {
    // wave-3 G: Listen's metronome is session-local and free-running, same as
    // Learn's — the bar no longer hardcodes it off for the mode. Gating is now
    // purely the caller-supplied `clickDisabled` prop (the tempo-map guard).
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" clickActive onToggleClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeEnabled();
    rerender(<ScoreTransportBar {...base} mode="polish" clickActive onToggleClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeEnabled();
    // Without clickDisabled, Listen's metronome is ENABLED — it was hardcoded
    // disabled before wave-3 G; now the mode alone never gates it.
    rerender(<ScoreTransportBar {...base} mode="listen" clickActive onToggleClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeEnabled();
  });

  it('clickDisabled disables the metronome button in ANY mode (the tempo-map guard, wave-3 G)', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" clickActive clickDisabled onToggleClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeDisabled();
    rerender(<ScoreTransportBar {...base} mode="polish" clickActive clickDisabled onToggleClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeDisabled();
    rerender(<ScoreTransportBar {...base} mode="listen" clickActive clickDisabled onToggleClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeDisabled();
  });

  it('is mode-aware: Perform shows no parts/transport/view controls, Polish shows run + parts', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="perform" />);
    expect(screen.queryByRole('button', { name: /^LH$/ })).toBeNull(); // no part chips
    expect(screen.queryByRole('button', { name: /pause|play/i })).toBeNull(); // no transport
    expect(screen.queryByRole('button', { name: /size/i })).toBeNull(); // no view controls
    expect(screen.queryByRole('button', { name: /metronome/i })).toBeNull(); // no click in Perform

    rerender(<ScoreTransportBar {...base} mode="polish" />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(); // transport present
    expect(screen.getByRole('button', { name: /LH/ })).toBeInTheDocument(); // parts present
    expect(screen.getByRole('button', { name: /metronome/i })).toBeInTheDocument(); // click lives in Polish (J1)
  });

  it('shows one part chip per staff and cycles it (>2-staff fallback)', () => {
    render(<ScoreTransportBar {...base} parts={[{ staff: 0, label: 'RH' }, { staff: 1, label: 'LH' }, { staff: 2, label: 'P3' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /LH/ }));
    expect(base.onCyclePart).toHaveBeenCalledWith(1);
  });

  it('grand-staff (2 staves) shows the Hands toggles, not chips (J4)', () => {
    const onHandsChange = vi.fn();
    render(<ScoreTransportBar {...base} mode="learn" grandStaff handsValue="both" onHandsChange={onHandsChange} />);
    expect(screen.getByRole('group', { name: /hands/i })).toBeInTheDocument();
    // Both hands lit; turning Right off narrows practice to the left hand.
    fireEvent.click(screen.getByRole('button', { name: 'Right hand' }));
    expect(onHandsChange).toHaveBeenCalledWith('lh');
  });

  it('Listen renders the same Hands control as Learn/Polish (one semantic)', () => {
    render(<ScoreTransportBar {...base} mode="listen" grandStaff handsValue="both" onHandsChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Hands' })).toBeInTheDocument();
  });

  it('Perform is zero-chrome: the bar renders nothing at all', () => {
    const { container } = render(<ScoreTransportBar {...base} mode="perform" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows position readout total', () => {
    render(<ScoreTransportBar {...base} />);
    expect(screen.getByText(/\/\s*40/)).toBeInTheDocument();
  });

  it('prefixes the position readout with the live Polish score, and omits it before any grade (wave-3 H)', () => {
    const props = { ...base, mode: 'polish', step: 11, measure: 12, measureTotal: 24 };
    // Before a measure has been graded there is no score to show — plain position.
    const { rerender } = render(<ScoreTransportBar {...props} scoreLabel={null} />);
    expect(screen.getByTestId('score-position')).toHaveTextContent('m 12 / 24');
    expect(screen.getByTestId('score-position').textContent).not.toMatch(/%/);
    // Once a grade exists, the score leads — the readout is one span, not two.
    rerender(<ScoreTransportBar {...props} scoreLabel="82%" />);
    expect(screen.getByTestId('score-position')).toHaveTextContent('82% · m 12 / 24');
  });

  it('disables Play with a Preparing label until geometry is ready (H0)', () => {
    render(<ScoreTransportBar {...base} mode="polish" ready={false} total={0} />);
    const play = screen.getByRole('button', { name: /preparing/i });
    expect(play).toBeDisabled();
  });

  it('enables Play once ready', () => {
    render(<ScoreTransportBar {...base} mode="polish" ready total={10} />);
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play).toBeEnabled();
  });

  it('listen mode: tempo button opens a segmented stepper that commits via onTempo on tap', () => {
    const onTempo = vi.fn();
    render(<ScoreTransportBar {...base} mode="listen" tempoMult={1} onTempo={onTempo} />);
    const tempoBtn = screen.getByRole('button', { name: /^tempo/i });
    expect(tempoBtn).toHaveTextContent('90'); // round(baseBpm=90 × tempoMult=1)
    fireEvent.click(tempoBtn);
    // No slider / no typed value — discrete percent steps commit on tap.
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^150%/ }));
    expect(onTempo).toHaveBeenCalledWith(1.5);
  });

  it('tempo chip shows the effective ♩BPM (baseBpm × tempoMult), not a percent label', () => {
    render(<ScoreTransportBar {...base} mode="listen" baseBpm={90} tempoMult={1.25} onTempo={vi.fn()} />);
    const tempo = screen.getByRole('button', { name: 'Tempo' });
    expect(tempo).toHaveTextContent('113'); // round(90 × 1.25)
    expect(tempo.querySelector('svg')).not.toBeNull(); // quarter-note icon
  });

  it('polish mode: tempo stepper is present and commits via onTempo; no key/play-along', () => {
    const onTempo = vi.fn();
    render(<ScoreTransportBar {...base} mode="polish" tempoMult={1} onTempo={onTempo} />);
    const tempoBtn = screen.getByRole('button', { name: /^tempo/i });
    expect(tempoBtn).toHaveTextContent('90'); // round(baseBpm=90 × tempoMult=1)
    fireEvent.click(tempoBtn);
    fireEvent.click(screen.getByRole('button', { name: /^80%/ }));
    expect(onTempo).toHaveBeenCalledWith(0.8);
    // Key stays live in Polish (transpose acts in every practice mode); play-along is gone.
    expect(screen.getByRole('button', { name: 'Key' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /play along/i })).toBeNull();
  });

  it('has no Play-along toggle — Listen light-up is always on (J5)', () => {
    render(<ScoreTransportBar {...base} mode="listen" />);
    expect(screen.queryByRole('button', { name: /play along/i })).toBeNull();
  });

  it('listen mode: Key opens the sheet and tapping an offset commits via onTranspose', () => {
    const onTranspose = vi.fn();
    render(<ScoreTransportBar {...base} mode="listen" transpose={1} onTranspose={onTranspose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Key' })); // open the sheet
    expect(screen.getByRole('dialog', { name: 'Key' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+2' })); // direct-pick +2
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

  // Wave-3 F: the loop popover (LoopControl + LoopSheet — sections, "Select
  // measures…", ±1 nudges) is retired outright. Its replacement is LoopGroup's
  // four flat buttons: two mark buttons that ARM an endpoint for the next tap on
  // the score, a loop toggle, and a clear. No menu, no two-tap wizard.
  it('learn mode: the loop cluster is four flat buttons that arm, toggle and clear', () => {
    const onArm = vi.fn();
    const onToggleLoop = vi.fn();
    const onClearFocus = vi.fn();
    render(
      <ScoreTransportBar
        {...base}
        mode="learn"
        loopActive
        loopEnabled
        inLabel="m3"
        outLabel="m6"
        onArm={onArm}
        onToggleLoop={onToggleLoop}
        onClearFocus={onClearFocus}
      />,
    );
    // The range shows as its two endpoints, on the buttons that set them.
    const markIn = screen.getByRole('button', { name: 'Mark loop start' });
    const markOut = screen.getByRole('button', { name: 'Mark loop end' });
    expect(markIn).toHaveTextContent('m3');
    expect(markOut).toHaveTextContent('m6');
    fireEvent.click(markIn);
    expect(onArm).toHaveBeenCalledWith('in');
    fireEvent.click(markOut);
    expect(onArm).toHaveBeenCalledWith('out');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle loop' }));
    expect(onToggleLoop).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear loop' }));
    expect(onClearFocus).toHaveBeenCalled();
    // There is no menu left to open.
    expect(screen.queryByRole('button', { name: 'Loop options' })).toBeNull();
    expect(screen.queryByRole('button', { name: /select measures/i })).toBeNull();
  });

  it('the armed edge is shown on its own mark button', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" loopActive arming="in" onArm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mark loop start' }).className).toMatch(/is-arming/);
    expect(screen.getByRole('button', { name: 'Mark loop end' }).className).not.toMatch(/is-arming/);
    rerender(<ScoreTransportBar {...base} mode="learn" loopActive arming="out" onArm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mark loop start' }).className).not.toMatch(/is-arming/);
    expect(screen.getByRole('button', { name: 'Mark loop end' }).className).toMatch(/is-arming/);
  });

  it('toggle and clear are inert until a range exists', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" onArm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Toggle loop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear loop' })).toBeDisabled();
    // …and the mark buttons are live regardless: arming is how a range STARTS.
    expect(screen.getByRole('button', { name: 'Mark loop start' })).toBeEnabled();
    rerender(<ScoreTransportBar {...base} mode="learn" loopActive loopEnabled onArm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Toggle loop' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Toggle loop' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Clear loop' })).toBeEnabled();
  });

  // Wave-3 §0/§F reverses wave-2's L6: the range is LEARN-ONLY state, so Listen and
  // Polish render no loop chrome at all. Four permanently dead buttons would
  // advertise a capability those modes do not have.
  it('the loop cluster is LEARN-ONLY — Listen, Polish and Perform show no loop chrome', () => {
    for (const mode of ['listen', 'polish', 'perform']) {
      const { unmount } = render(<ScoreTransportBar {...base} mode={mode} loopActive inLabel="m3" outLabel="m6" onArm={vi.fn()} />);
      for (const name of ['Mark loop start', 'Mark loop end', 'Toggle loop', 'Clear loop']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
      unmount();
    }
    render(<ScoreTransportBar {...base} mode="learn" onArm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mark loop start' })).toBeInTheDocument();
  });

  it('has no Scoring toggle — Polish always grades (J5)', () => {
    render(<ScoreTransportBar {...base} mode="polish" />);
    expect(screen.queryByRole('button', { name: /scoring/i })).toBeNull();
  });

  it('shows a measure readout (m X / Y) when a measure count is provided (L2)', () => {
    render(<ScoreTransportBar {...base} mode="learn" measure={3} measureTotal={24} />);
    expect(screen.getByText('m 3 / 24')).toBeInTheDocument();
  });

  it('Restart is always in place, enabled only when there is a run to restart (Polish)', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="polish" canRestart={false} />);
    expect(screen.getByRole('button', { name: /restart/i })).toBeDisabled();
    rerender(<ScoreTransportBar {...base} mode="polish" canRestart />);
    expect(screen.getByRole('button', { name: /restart/i })).toBeEnabled();
  });

  it('View menu holds size as a segmented stepper (no slider), commits scale on tap', () => {
    render(<ScoreTransportBar {...base} />);
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
    expect(screen.getByRole('dialog', { name: /view/i })).toBeInTheDocument();
    // No slider / no typed value — discrete percent steps commit on tap.
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '125%' }));
    expect(base.onScale).toHaveBeenCalledWith(1.25);
  });

  it('menu affordance (C4): View carries a chevron SVG, Tempo carries a quarter-note SVG', () => {
    render(<ScoreTransportBar {...base} mode="listen" tempoMult={1} onTempo={vi.fn()} />);
    const view = screen.getByRole('button', { name: /view options/i });
    expect(view.querySelector('svg')).not.toBeNull(); // ChevronDownIcon, not a ⋯ glyph
    expect(view).toHaveTextContent('View'); // plain typography label
    expect(view.textContent).not.toContain('⋯');
    const tempo = screen.getByRole('button', { name: /^tempo/i });
    expect(tempo.querySelector('svg')).not.toBeNull(); // QuarterNoteIcon — the chip face IS the affordance (T6)
  });

  it('part chips carry no ✓ glyph — is-on/is-off styling holds the state (C3)', () => {
    render(<ScoreTransportBar {...base} mode="learn" />);
    const chip = screen.getByRole('button', { name: /RH/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip.textContent).toBe('RH'); // no "✓ " prefix
  });

  // Wave-2 T8 dropped the shared `openPopover` state that made this bar
  // cross-dismiss sheets on the parent's behalf — Key/Tempo/View are now three
  // independent booleans. In the real kiosk, two sheets can never visibly
  // stack: each TransportSheet brings its own full-screen scrim, so a tap
  // aimed at a second trigger while one sheet is open actually lands on that
  // sheet's scrim and just closes it (the trigger never receives the click).
  // RTL's fireEvent.click dispatches straight to the target element and skips
  // that hit-testing, so a same-shaped "click View, assert Tempo closed" test
  // would silently pass or fail on jsdom implementation details rather than on
  // the real behavior — it can't faithfully exercise the scrim swallow. This
  // replaces that assertion with what IS verifiable here: each sheet's own
  // scrim dismisses it, and once dismissed, opening a different sheet works
  // on its own — there's no leftover coupling between them.
  it('sheets self-dismiss via their own scrim; each opens independently (M4 successor)', () => {
    render(<ScoreTransportBar {...base} mode="listen" tempoMult={1} onTempo={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^tempo/i }));
    expect(screen.getByRole('dialog', { name: /tempo/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /dismiss tempo/i })); // tempo's own scrim
    expect(screen.queryByRole('dialog', { name: /tempo/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /view options/i }));
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

  it('memoization: transport buttons are unaffected by a step advance', () => {
    // Sanity: the shell still threads props correctly across a step change — the
    // transport and readout remain present & correct (mode tabs left the bar in
    // wave-2 B; `mode` itself is asserted via the transport buttons it gates).
    const props = { ...base, mode: 'polish', step: 0 };
    const { rerender } = render(<ScoreTransportBar {...props} />);
    expect(screen.getByRole('button', { name: /pause|play/i })).toBeInTheDocument();

    rerender(<ScoreTransportBar {...props} step={3} />);
    expect(screen.getByText('4 / 40')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pause|play/i })).toBeInTheDocument();
  });
});

describe('ScoreTransportBar — stable geography (C2)', () => {
  it('Learn renders Restart, the metronome, the Loop control — and a Play the gate can lock', () => {
    // Wave-3 §B: Play is locked by `playLocked` (Learn's GATE — a range with
    // looping on), not by the mode. Learn's machine states pass it false and get
    // an ordinary live transport in the same slot.
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" step={0} total={4} measure={1} measureTotal={2} ready canRestart={false} playLocked />);
    expect(screen.getByRole('button', { name: /restart/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /learn advances as you play/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /metronome/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle loop' })).toBeInTheDocument();

    rerender(<ScoreTransportBar {...base} mode="learn" step={0} total={4} measure={1} measureTotal={2} ready canRestart={false} />);
    expect(screen.queryByRole('button', { name: /learn advances as you play/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled(); // machine playback in Learn
  });

  it('playLocked, not the mode, is what disables the run button', () => {
    // The lock is a state, not a place: any mode can be handed it, and Learn
    // without it behaves exactly like Listen/Polish.
    const { rerender } = render(<ScoreTransportBar {...base} mode="listen" step={0} total={4} ready playLocked />);
    expect(screen.getByRole('button', { name: /learn advances as you play/i })).toBeDisabled();
    rerender(<ScoreTransportBar {...base} mode="listen" step={0} total={4} ready running />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
  });
  it('Listen renders the metronome enabled by default; clickDisabled gates it in place (wave-3 G)', () => {
    // wave-3 G: Listen's metronome is session-local + free-running like Learn's;
    // the bar's own hardcoded "disabled in Listen" rule is gone. Only the caller's
    // `clickDisabled` (ScorePlayer's single-entry tempo-map guard) can gate it.
    const { rerender } = render(<ScoreTransportBar {...base} mode="listen" step={0} total={4} ready />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeEnabled();
    rerender(<ScoreTransportBar {...base} mode="listen" step={0} total={4} ready clickDisabled />);
    expect(screen.getByRole('button', { name: /metronome/i })).toBeDisabled();
  });
  it('Perform is zero-chrome — no loop cluster, no metronome, no bar at all', () => {
    const { container } = render(<ScoreTransportBar {...base} mode="perform" />);
    expect(screen.queryByRole('button', { name: 'Toggle loop' })).toBeNull();
    expect(screen.queryByRole('button', { name: /metronome/i })).toBeNull();
    expect(container.firstChild).toBeNull();
  });
  it('Learn/Polish keep Key rendered and enabled — transpose acts in every practice mode', () => {
    const { rerender } = render(<ScoreTransportBar {...base} mode="learn" step={0} total={4} ready />);
    expect(screen.getByRole('button', { name: 'Key' })).toBeEnabled();
    rerender(<ScoreTransportBar {...base} mode="polish" step={0} total={4} ready />);
    expect(screen.getByRole('button', { name: 'Key' })).toBeEnabled();
  });
  it('transport buttons render Play/Pause as SVG icons, not glyph text', () => {
    render(<ScoreTransportBar {...base} mode="polish" step={0} total={4} ready canRestart />);
    const play = screen.getByRole('button', { name: 'Play' });
    expect(play.querySelector('svg')).not.toBeNull();
    expect(play.textContent).toBe(''); // no ▶ glyph
  });

  it('geography invariant: the ordered button list is IDENTICAL across Listen/Learn/Polish, apart from Learn\'s loop cluster', () => {
    // The C2 contract: same buttons, same order, in every practice mode — only
    // disabled state may differ. Grand staff's Hands toggles carry the same
    // Left/Right hand labels in every mode (wave-3 A: one semantic everywhere),
    // so they participate in the roll-call unchanged too.
    //
    // Wave-3 F carves out ONE documented exception: the loop cluster is Learn-only
    // state, so Learn ADDS four buttons the other modes never render (rather than
    // showing everyone four dead ones). The invariant is asserted in both halves:
    // Listen === Polish exactly, and Learn === the same list PLUS the cluster, in
    // its own contiguous slot — nothing else shifts.
    const LOOP = ['Mark loop start', 'Mark loop end', 'Toggle loop', 'Clear loop'];
    const collect = () => screen.getAllByRole('button').map((b) => {
      const name = b.getAttribute('aria-label') || b.textContent.trim();
      // Learn's run button carries an explanatory accessible name by design —
      // it is the SAME Play button in the same slot, so normalize for comparison.
      return name === 'Learn advances as you play' ? 'Play' : name;
    });
    const props = { ...base, grandStaff: true, handsValue: 'both', onHandsChange: vi.fn(), onArm: vi.fn() };
    const { rerender } = render(<ScoreTransportBar {...props} mode="listen" />);
    const listen = collect();
    expect(listen.length).toBeGreaterThan(0);
    expect(listen.filter((n) => LOOP.includes(n))).toEqual([]); // no loop chrome outside Learn
    rerender(<ScoreTransportBar {...props} mode="polish" />);
    expect(collect()).toEqual(listen);
    rerender(<ScoreTransportBar {...props} mode="learn" />);
    const learn = collect();
    expect(learn.filter((n) => !LOOP.includes(n))).toEqual(listen); // every other button, same order
    const first = learn.findIndex((n) => LOOP.includes(n));
    expect(learn.slice(first, first + LOOP.length)).toEqual(LOOP);  // …and the cluster is contiguous
  });
});
