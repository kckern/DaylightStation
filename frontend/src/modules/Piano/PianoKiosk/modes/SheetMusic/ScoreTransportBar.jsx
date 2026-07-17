import React, { useState, memo } from 'react';
import HandsControl from './HandsControl.jsx';
import LoopControl from './LoopControl.jsx';
import ViewMenu from './ViewMenu.jsx';
import { PlayIcon, PauseIcon, RestartIcon, QuarterNoteIcon, ChevronDownIcon } from './icons.jsx';

// Tab order: Listen · Learn · Polish · Perform.
const MODES = [
  { id: 'listen', label: 'Listen' },
  { id: 'learn', label: 'Learn' },
  { id: 'polish', label: 'Polish' },
  { id: 'perform', label: 'Perform' },
];

const ROLE_TITLES = {
  play: 'Play',
  you: 'You',
  mute: 'Mute',
};

// Tempo & size are discrete segmented steppers (the kiosk's canonical touch
// control — cf. SoundPanel/VolumeModal's Off/Low/Med/High/Max), never a slider
// or typed value. Percent labels double as the readout.
const TEMPO_STEPS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
];
// (Size steps moved into ViewMenu, which now owns the size control.)
// Which step is lit for a current value — the nearest one by amount.
const nearestStep = (steps, val) => {
  let best = 0;
  let bestDist = Infinity;
  steps.forEach((s, i) => {
    const d = Math.abs(s.value - val);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
};

/**
 * ScoreModeTabs — the left segmented mode control (Listen/Learn/Polish/Perform).
 *
 * Memoized: it depends only on `mode`/`onMode`, so a cursor-step advance (which
 * only touches the shell's position readout) leaves this subtree untouched.
 */
const ScoreModeTabs = memo(function ScoreModeTabs({ mode, onMode }) {
  return (
    <div className="piano-score-modes" role="tablist" aria-label="Score mode">
      {MODES.map(({ id, label }) => {
        const selected = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`piano-score-mode-tab${selected ? ' is-active' : ''}`}
            onClick={() => onMode(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
});

/**
 * ScoreTransportButtons — Restart (icon) + run (Play/Pause icons). Stable
 * geography (audit C2): both render in EVERY mode but Perform and gate in place
 * via `disabled` instead of unmounting, so mode changes never shuffle the bar.
 * Restart is inert until there is a run to restart; the run button in Learn is
 * a permanently disabled Play (Learn advances as you play, not on a transport).
 * Memoized so a step advance can't reconcile them (they depend on mode/running,
 * not step).
 */
const ScoreTransportButtons = memo(function ScoreTransportButtons({ mode, running, onToggleRun, onReset, ready = true, canRestart = false }) {
  if (mode === 'perform') return null;
  const isLearn = mode === 'learn';
  // Until geometry extraction publishes a timeline the transport is inert; show a
  // disabled "Preparing…" so the bar doesn't look live while it can't play (audit H0).
  const runLabel = isLearn ? 'Learn advances as you play' : !ready ? 'Preparing' : running ? 'Pause' : 'Play';
  return (
    <>
      <button
        type="button"
        className="piano-score-btn piano-score-reset"
        aria-label="Restart"
        disabled={!canRestart}
        onClick={onReset}
      >
        <RestartIcon />
      </button>
      <button
        type="button"
        className={`piano-score-btn piano-score-run${!ready && !isLearn ? ' is-preparing' : ''}`}
        aria-label={runLabel}
        aria-pressed={running}
        disabled={isLearn || !ready}
        onClick={onToggleRun}
      >
        {isLearn ? <PlayIcon /> : !ready ? '…' : running ? <PauseIcon /> : <PlayIcon />}
      </button>
    </>
  );
});

/**
 * ScorePracticeCluster — the center-zone practice controls: metronome + Loop.
 * These moved out of the right cluster (audit C1/C2) so the practice loop and
 * click sit beside the transport they modify. Both render in every mode but
 * Perform; the metronome gates IN PLACE (disabled in Listen — Listen's own
 * performance is the beat) instead of unmounting, preserving spatial memory.
 *
 * Memoized and step-INDEPENDENT: none of its props change as the cursor
 * advances, so React.memo bails out per step.
 */
const ScorePracticeCluster = memo(function ScorePracticeCluster({
  mode,
  clickActive = false,
  bpm = 90,
  onToggleClick,
  loopActive = false,
  scopeLabel = '',
  sections = [],
  onPickSection,
  onStartSelect,
  onClearFocus,
  onNudge,
}) {
  if (mode === 'perform') return null;
  // Listen disables the click (its own performance is the beat); a persisted
  // clickActive must not paint the accent on a button that can't act.
  const metronomeDisabled = mode === 'listen';
  return (
    <>
      <button
        type="button"
        className={`piano-score-btn piano-score-click${clickActive && !metronomeDisabled ? ' is-on' : ''}`}
        aria-label="Metronome"
        aria-pressed={clickActive}
        disabled={metronomeDisabled}
        onClick={onToggleClick}
      >
        <QuarterNoteIcon />
        <span className="tabular-nums">{bpm}</span>
      </button>
      <LoopControl
        active={loopActive}
        scopeLabel={scopeLabel}
        sections={sections}
        onPickSection={onPickSection}
        onStartSelect={onStartSelect}
        onClearFocus={onClearFocus}
        onNudge={onNudge}
      />
    </>
  );
});

/**
 * ScoreViewControls — the expensive right cluster: part chips / Hands, key
 * transpose, tempo & view popovers. This is the bulk of the bar's DOM +
 * local popover state. (The metronome and Loop control live in the center
 * ScorePracticeCluster since audit C1/C2.)
 *
 * Stable geography (audit C2): every control renders in all non-Perform modes;
 * mode gating disables IN PLACE (Key dims outside Listen) instead of unmounting,
 * so the cluster never reflows on a mode change.
 *
 * Memoized and step-INDEPENDENT: none of its props change as the cursor advances,
 * so `React.memo` bails out and this whole subtree is skipped per step. Only the
 * shell's position readout re-renders on a step advance.
 *
 * `onBodyRender` is optional render instrumentation for tests to prove the memo
 * actually bails (it's called once per real render); production passes nothing.
 */
const ScoreViewControls = memo(function ScoreViewControls({
  mode,
  flow,
  onToggleFlow,
  scale,
  onScale,
  tempoMult = 1,
  onTempo,
  transpose = 0,
  onTranspose,
  parts = [],
  activeParts = {},
  roles = {},
  onCyclePart,
  grandStaff = false,
  handsVariant = 'hands',
  handsValue = 'both',
  onHandsChange,
  keyboardVisible,
  onToggleKeyboard,
  baseBpm = 90, // the piece's written tempo (unscaled) — each tempo step shows the BPM it produces (M4)
  meta = {},
  onBodyRender,
}) {
  if (onBodyRender) onBodyRender();

  // Single-open popover discipline (audit M4): tempo and the View menu share one
  // state, so opening one closes the other, and a shared backdrop dismisses on an
  // outside tap. 'tempo' | 'view' | null.
  const [openPopover, setOpenPopover] = useState(null);
  const toggle = (name) => setOpenPopover((cur) => (cur === name ? null : name));
  const closePopover = () => setOpenPopover(null);

  // Per-mode cluster gating (all derived from `mode`, so identical across steps).
  // Perform (music-stand mode) is the ONLY mode that drops chrome; everything
  // else stays mounted and gates in place (audit C2).
  const isPerform = mode === 'perform';
  if (isPerform) return null;
  // Key transpose only ACTS in Listen (the demo can be re-pitched); elsewhere the
  // control stays put but its buttons disable and the wrapper dims.
  const keyEnabled = mode === 'listen';

  const renderPartChip = (part) => {
    const { staff, label } = part;
    if (mode === 'listen') {
      const role = roles[staff] || 'play';
      const roleTitle = ROLE_TITLES[role] || role;
      return (
        <button
          key={staff}
          type="button"
          className={`piano-score-part-chip is-role-${role}`}
          onClick={() => onCyclePart(staff)}
        >
          {`${label}: ${roleTitle}`}
        </button>
      );
    }
    const on = !!activeParts[staff];
    return (
      <button
        key={staff}
        type="button"
        className={`piano-score-part-chip${on ? ' is-on' : ' is-off'}`}
        aria-pressed={on}
        onClick={() => onCyclePart(staff)}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="piano-score-view">
      {grandStaff
        ? <HandsControl variant={handsVariant} value={handsValue} onChange={onHandsChange} />
        : <div className="piano-score-parts">{parts.map(renderPartChip)}</div>}

      <div className={`piano-score-key${keyEnabled ? '' : ' is-dimmed'}`} role="group" aria-label="Key">
        <span className="piano-score-key-label">Key</span>
        <button
          type="button"
          className="piano-score-btn piano-score-key-down"
          aria-label="Transpose down"
          disabled={!keyEnabled}
          onClick={() => onTranspose?.(transpose - 1)}
        >
          {'−'}
        </button>
        <span className="piano-score-key-readout tabular-nums">
          {transpose > 0 ? `+${transpose}` : String(transpose)}
        </span>
        <button
          type="button"
          className="piano-score-btn piano-score-key-up"
          aria-label="Transpose up"
          disabled={!keyEnabled}
          onClick={() => onTranspose?.(transpose + 1)}
        >
          {'+'}
        </button>
      </div>

      <div className="piano-score-tempo-wrap">
        <button
          type="button"
          className="piano-score-btn piano-score-tempo"
          aria-label="Tempo"
          aria-expanded={openPopover === 'tempo'}
          onClick={() => toggle('tempo')}
        >
          {`Tempo ${Math.round(tempoMult * 100)}%`}
          <ChevronDownIcon />
        </button>
        {openPopover === 'tempo' && (
          <div className="piano-score-tempo-modal" role="dialog" aria-label="Tempo">
            <div className="piano-score-steps" role="group" aria-label="Tempo">
              {TEMPO_STEPS.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  className={`piano-score-btn piano-score-step${i === nearestStep(TEMPO_STEPS, tempoMult) ? ' is-on' : ''}`}
                  aria-pressed={i === nearestStep(TEMPO_STEPS, tempoMult)}
                  onClick={() => onTempo?.(s.value)}
                >
                  {s.label}
                  <span className="piano-score-step__bpm tabular-nums"><QuarterNoteIcon /> {Math.round(baseBpm * s.value)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="piano-score-view-wrap">
        <button
          type="button"
          className="piano-score-btn piano-score-viewmenu"
          aria-label="View options"
          aria-expanded={openPopover === 'view'}
          onClick={() => toggle('view')}
        >
          {'View'}
          <ChevronDownIcon />
        </button>
        {openPopover === 'view' && (
          <ViewMenu
            flow={flow}
            onToggleFlow={onToggleFlow}
            scale={scale}
            onScale={onScale}
            keyboardVisible={keyboardVisible}
            onToggleKeyboard={onToggleKeyboard}
            meta={meta}
          />
        )}
      </div>

      {/* Shared backdrop: an outside tap dismisses whichever popover is open (M4). */}
      {openPopover && (
        <button type="button" className="piano-score-popover-backdrop" aria-label="Close" onClick={closePopover} />
      )}
    </div>
  );
});

/**
 * ScoreTransportBar — pinned bottom transport for the sheet-music player.
 *
 * Purely presentational: all state is lifted to props. No MIDI / OSMD / logging /
 * router concerns live here. Replaces the old top toolbar (top bar becomes
 * breadcrumb-only).
 *
 * Stable three-zone geography (audit C1/C2): a fixed grid of
 *   left  — mode tabs
 *   center — Restart · Play/Pause · metronome · Loop · position readout
 *   right — Hands/parts · Key · Tempo · View menu
 * Every control renders in ALL modes but Perform; per-mode gating disables/dims
 * IN PLACE instead of unmounting, so nothing ever moves under the finger:
 *  Listen  — all live except metronome (disabled — the performance is the beat)
 *            and the Learn-only Play lockout; Key enabled here only.
 *  Learn   — Play disabled ("Learn advances as you play"); metronome free-runs;
 *            Key dimmed.
 *  Polish  — full transport; metronome arms the run click; Key dimmed.
 *  Perform — tabs + a {page} / {pages} indicator only (music-stand mode).
 *
 * Perf structure (Task 10): this component is a THIN SHELL. It threads props and
 * owns only the cheap, step-dependent position readout in the center column. The
 * four expensive clusters — mode tabs, transport buttons, the practice cluster,
 * and the right-hand view controls — are `React.memo`'d children whose props don't
 * change as the cursor steps, so advancing `step` re-renders only this shell + the
 * small readout, and the memoized subtrees bail out. (Approach B: sub-section
 * memoization; the readout must stay nested inside the grid's center zone, so it
 * can't be split off as a sibling à la Approach A.)
 */
export default function ScoreTransportBar({
  mode,
  onMode,
  running,
  onToggleRun,
  onReset,
  ready,
  canRestart,
  step,
  total,
  measure,
  measureTotal,
  page = 1,
  pages = 1,
  flow,
  onToggleFlow,
  scale,
  onScale,
  // NOTE: threaded-only props are intentionally NOT defaulted here. Object/array
  // defaults (e.g. `parts = []`, `meta = {}`) mint a FRESH reference every render
  // for an omitted prop, which would defeat React.memo on ScoreViewControls. The
  // memoized children apply their own defaults instead, so an omitted prop stays
  // referentially stable (`undefined`) across a step advance.
  tempoMult,
  onTempo,
  transpose,
  onTranspose,
  parts,
  activeParts,
  roles,
  onCyclePart,
  grandStaff,
  handsVariant,
  handsValue,
  onHandsChange,
  sections,
  loopActive,
  scopeLabel,
  onPickSection,
  onStartSelect,
  onClearFocus,
  onNudge,
  keyboardVisible,
  onToggleKeyboard,
  clickActive,
  onToggleClick,
  bpm,
  baseBpm,
  meta,
  onBodyRender,
}) {
  // Musicians think in measures, not note-steps (audit L2): show "m 3 / 24" when a
  // measure count is available, falling back to the step readout otherwise.
  const position = measureTotal > 0
    ? `m ${Math.min(measure ?? 1, measureTotal)} / ${measureTotal}`
    : `${Math.min(step + 1, total)} / ${total}`;

  const isPerform = mode === 'perform';
  // The position readout and page indicator exist in every mode but Perform.
  const hasPosition = !isPerform;

  return (
    <div className="piano-score-transportbar">
      {/* Left — mode tabs (memoized; step-independent) */}
      <ScoreModeTabs mode={mode} onMode={onMode} />

      {/* Center — transport buttons + practice cluster (memoized) + the per-step position readout (shell) */}
      <div className="piano-score-playback">
        <ScoreTransportButtons
          mode={mode}
          running={running}
          onToggleRun={onToggleRun}
          onReset={onReset}
          ready={ready}
          canRestart={canRestart}
        />
        <ScorePracticeCluster
          mode={mode}
          clickActive={clickActive}
          bpm={bpm}
          onToggleClick={onToggleClick}
          loopActive={loopActive}
          scopeLabel={scopeLabel}
          sections={sections}
          onPickSection={onPickSection}
          onStartSelect={onStartSelect}
          onClearFocus={onClearFocus}
          onNudge={onNudge}
        />
        {hasPosition && <span className="piano-score-position tabular-nums">{position}</span>}
        {isPerform && (
          <span className="piano-score-page-indicator tabular-nums" aria-label="Page">{`${page} / ${pages}`}</span>
        )}
      </div>

      {/* Right — parts, key, tempo & view controls (memoized; step-independent) */}
      <ScoreViewControls
        mode={mode}
        flow={flow}
        onToggleFlow={onToggleFlow}
        scale={scale}
        onScale={onScale}
        tempoMult={tempoMult}
        onTempo={onTempo}
        transpose={transpose}
        onTranspose={onTranspose}
        parts={parts}
        activeParts={activeParts}
        roles={roles}
        onCyclePart={onCyclePart}
        grandStaff={grandStaff}
        handsVariant={handsVariant}
        handsValue={handsValue}
        onHandsChange={onHandsChange}
        keyboardVisible={keyboardVisible}
        onToggleKeyboard={onToggleKeyboard}
        baseBpm={baseBpm}
        meta={meta}
        onBodyRender={onBodyRender}
      />
    </div>
  );
}

// Exported for targeted render-count testing of the memoized expensive subtree.
export { ScoreViewControls };
