import React, { useState, memo } from 'react';
import HandsControl from './HandsControl.jsx';
import LoopControl from './LoopControl.jsx';
import ViewSheet from './ViewSheet.jsx';
import Icon from '../../icons/Icon.jsx';
import TransportButton from '../../transport/TransportButton.jsx';
import KeySheet from '../../transport/KeySheet.jsx';
import TempoSheet, { TEMPO_STEPS, nearestStep } from '../../transport/TempoSheet.jsx';
import VolumeControl from '../../transport/VolumeControl.jsx';

/**
 * ScoreTransportButtons — Restart (icon) + run (Play/Pause icons). Stable
 * geography (audit C2): both render in EVERY mode but Perform and gate in place
 * via `disabled` instead of unmounting, so mode changes never shuffle the bar.
 * Restart is inert until there is a run to restart; `playLocked` turns the run
 * button into a disabled Play labelled "Learn advances as you play" — the state
 * Learn's gate (a range with looping on) puts it in, where the cursor moves on
 * what the user plays rather than on a transport. Learn's machine states pass
 * `playLocked` false and get an ordinary live Play/Pause.
 * Memoized so a step advance can't reconcile them (they depend on mode/running,
 * not step).
 */
const ScoreTransportButtons = memo(function ScoreTransportButtons({ mode, running, onToggleRun, onReset, ready = true, canRestart = false, playLocked = false }) {
  if (mode === 'perform') return null;
  // Until geometry extraction publishes a timeline the transport is inert; show a
  // disabled "Preparing…" so the bar doesn't look live while it can't play (audit H0).
  const runLabel = playLocked ? 'Learn advances as you play' : !ready ? 'Preparing' : running ? 'Pause' : 'Play';
  return (
    <>
      <button
        type="button"
        className="piano-tbtn piano-score-btn piano-score-reset"
        aria-label="Restart"
        disabled={!canRestart}
        onClick={onReset}
      >
        <Icon name="previous" />
      </button>
      <button
        type="button"
        className={`piano-tbtn piano-score-btn piano-score-run${!ready && !playLocked ? ' is-preparing' : ''}`}
        aria-label={runLabel}
        aria-pressed={running}
        disabled={playLocked || !ready}
        onClick={onToggleRun}
      >
        {playLocked ? <Icon name="play" /> : !ready ? '…' : running ? <Icon name="pause" /> : <Icon name="play" />}
      </button>
    </>
  );
});

/**
 * ScorePracticeCluster — the center-zone practice controls: metronome + Loop.
 * These moved out of the right cluster (audit C1/C2) so the practice loop and
 * click sit beside the transport they modify. Both render in every mode but
 * Perform; the metronome gates IN PLACE via the caller-supplied `clickDisabled`
 * (wave-3 G: Listen's metronome is session-local, same as Learn's — the mode
 * itself no longer disables it, only ScorePlayer's tempo-map guard does)
 * instead of unmounting, preserving spatial memory.
 *
 * Memoized and step-INDEPENDENT: none of its props change as the cursor
 * advances, so React.memo bails out per step.
 */
const ScorePracticeCluster = memo(function ScorePracticeCluster({
  mode,
  clickActive = false,
  onToggleClick,
  clickDisabled = false,
  loopActive = false,
  loopEnabled = true,
  scopeLabel = '',
  sections = [],
  onPickSection,
  onStartSelect,
  onClearFocus,
  onNudge,
  onToggleLoop,
}) {
  if (mode === 'perform') return null;
  // Gating is the caller's call now (wave-3 G): Listen's metronome is
  // session-local + free-running like Learn's, only gated by the tempo-map
  // guard ScorePlayer computes (`clickDisabled`) — no mode check here. A
  // disabled-in-place button must not paint the accent it can't act on.
  return (
    <>
      <button
        type="button"
        className={`piano-tbtn piano-score-btn piano-score-click${clickActive && !clickDisabled ? ' is-on' : ''}`}
        aria-label="Metronome"
        aria-pressed={clickActive && !clickDisabled}
        disabled={clickDisabled}
        onClick={onToggleClick}
      >
        <Icon name="metronome" />
      </button>
      <LoopControl
        active={loopActive}
        enabled={loopEnabled}
        scopeLabel={scopeLabel}
        sections={sections}
        onPickSection={onPickSection}
        onStartSelect={onStartSelect}
        onClearFocus={onClearFocus}
        onNudge={onNudge}
        onToggleEnabled={onToggleLoop}
      />
    </>
  );
});

/**
 * ScoreViewControls — the expensive right cluster: part chips / Hands, key
 * transpose, tempo & view sheets. This is the bulk of the bar's DOM +
 * local sheet-open state. (The metronome and Loop control live in the center
 * ScorePracticeCluster since audit C1/C2.)
 *
 * Stable geography (audit C2): every control renders in all non-Perform modes;
 * mode gating (e.g. the metronome disabling in Listen) applies IN PLACE instead
 * of unmounting, so the cluster never reflows on a mode change. Key transposes
 * in every mode but Perform — the engrave re-pitches and Learn/Polish evaluate
 * against the transposed steps.
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
  onCyclePart,
  grandStaff = false,
  handsValue = 'both',
  onHandsChange,
  keyboardVisible,
  onToggleKeyboard,
  baseBpm = 90, // the piece's written tempo (unscaled) — each tempo step shows the BPM it produces (M4)
  keyFifths,
  keyMode,
  onBodyRender,
}) {
  if (onBodyRender) onBodyRender();

  // Key / Tempo / View each own an independent open boolean (wave-2 T8 drops
  // the old shared `openPopover` + backdrop machinery). Every one of them is a
  // TransportSheet, which brings its own full-screen scrim — an outside tap
  // dismisses whichever sheet is open, and a tap that would otherwise open a
  // second sheet lands on that scrim first and just closes the first one. Two
  // sheets can never visibly stack in practice, so single-open discipline is
  // inherent to the primitive rather than coordinated here.
  const [keyOpen, setKeyOpen] = useState(false);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  // Per-mode cluster gating (all derived from `mode`, so identical across steps).
  // Perform (music-stand mode) is the ONLY mode that drops chrome; everything
  // else stays mounted and gates in place (audit C2).
  const isPerform = mode === 'perform';
  if (isPerform) return null;
  // Key transpose acts in every practice mode; the engrave re-pitches and the
  // evaluator follows the engraved steps, so Learn/Polish get a live Key chip too.
  const keyEnabled = mode !== 'perform';

  const renderPartChip = (part) => {
    const { staff, label } = part;
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
      <span className="piano-score-divider" aria-hidden="true" />

      {grandStaff
        ? <HandsControl value={handsValue} onChange={onHandsChange} />
        : <div className="piano-score-parts">{parts.map(renderPartChip)}</div>}

      <div className={`piano-score-key${keyEnabled ? '' : ' is-dimmed'}`}>
        <TransportButton
          label={`Key ${transpose > 0 ? `+${transpose}` : transpose}`}
          icon="chevron-down"
          ariaLabel="Key"
          disabled={!keyEnabled}
          on={transpose !== 0}
          onPress={() => setKeyOpen((v) => !v)}
        />
      </div>
      <KeySheet
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        value={transpose}
        onPick={(n) => { onTranspose?.(n); setKeyOpen(false); }}
        keyFifths={keyFifths}
        keyMode={keyMode}
      />

      <div className="piano-score-tempo-wrap">
        <TransportButton
          label={String(Math.round(baseBpm * tempoMult))}
          icon="quarter-note"
          ariaLabel="Tempo"
          on={tempoMult !== 1}
          onPress={() => setTempoOpen((v) => !v)}
        />
        <TempoSheet
          open={tempoOpen}
          onClose={() => setTempoOpen(false)}
          value={tempoMult}
          onPick={(v) => { onTempo?.(v); setTempoOpen(false); }}
          baseBpm={baseBpm}
        />
      </div>

      <div className="piano-score-view-wrap">
        <button
          type="button"
          className="piano-score-btn piano-score-viewmenu"
          aria-label="View options"
          aria-expanded={viewOpen}
          onClick={() => setViewOpen((v) => !v)}
        >
          {'View'}
          <Icon name="chevron-down" />
        </button>
        <ViewSheet
          open={viewOpen}
          onClose={() => setViewOpen(false)}
          flow={flow}
          onToggleFlow={onToggleFlow}
          scale={scale}
          onScale={onScale}
          keyboardVisible={keyboardVisible}
          onToggleKeyboard={onToggleKeyboard}
        />
      </div>

      <VolumeControl className="piano-score-volume" />
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
 * The mode ladder (Listen/Learn/Polish/Perform) has moved to the header — a
 * crumb opens {@link ../ModeSheet.jsx|ModeSheet} — so this bar no longer owns
 * a left zone's CONTENT. `mode` remains a prop purely for in-place gating
 * (wave-2 B).
 *
 * Stable three-zone geography (audit C1/C2), geometry UNCHANGED by wave-2 B:
 *   left   — empty (formerly the mode tabs; kept as a flex column so the
 *            center cluster stays truly centered, not just centered-in-what's-left)
 *   center — Restart · Play/Pause · metronome · Loop · position readout
 *   right  — Hands/parts · Key · Tempo · View menu
 * Every control renders in ALL modes but Perform; per-mode gating disables/dims
 * IN PLACE instead of unmounting, so nothing ever moves under the finger:
 *  Listen  — all live, including a free-running metronome (session-local, same
 *            as Learn's — gated by `clickDisabled`, the caller's tempo-map
 *            guard, not the mode, wave-3 G) and the Learn-only Play lockout; Key live.
 *  Learn   — Play disabled ("Learn advances as you play") only while the gate is
 *            armed (a range with looping on — `playLocked`); the machine states
 *            get a live transport. Metronome free-runs; Key live (transposes the
 *            engrave Learn evaluates against).
 *  Polish  — full transport; metronome arms the run click; Key live.
 *  Perform — only a {page} / {pages} indicator (music-stand mode).
 *
 * Perf structure (Task 10): this component is a THIN SHELL. It threads props and
 * owns only the cheap, step-dependent position readout in the center column. The
 * expensive clusters — transport buttons, the practice cluster, and the
 * right-hand view controls — are `React.memo`'d children whose props don't
 * change as the cursor steps, so advancing `step` re-renders only this shell + the
 * small readout, and the memoized subtrees bail out. (Approach B: sub-section
 * memoization; the readout must stay nested inside the grid's center zone, so it
 * can't be split off as a sibling à la Approach A.)
 */
export default function ScoreTransportBar({
  mode,
  running,
  playLocked,
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
  // defaults (e.g. `parts = []`, `activeParts = {}`) mint a FRESH reference every
  // render for an omitted prop, which would defeat React.memo on ScoreViewControls.
  // The memoized children apply their own defaults instead, so an omitted prop
  // stays referentially stable (`undefined`) across a step advance.
  tempoMult,
  onTempo,
  transpose,
  onTranspose,
  parts,
  activeParts,
  onCyclePart,
  grandStaff,
  handsValue,
  onHandsChange,
  sections,
  loopActive,
  loopEnabled,
  scopeLabel,
  onPickSection,
  onStartSelect,
  onClearFocus,
  onNudge,
  onToggleLoop,
  keyboardVisible,
  onToggleKeyboard,
  clickActive,
  onToggleClick,
  clickDisabled,
  bpm,
  baseBpm,
  keyFifths,
  keyMode,
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
      {/* Center — transport buttons + practice cluster (memoized) + the per-step position readout (shell) */}
      <div className="piano-score-playback">
        <ScoreTransportButtons
          mode={mode}
          running={running}
          playLocked={playLocked}
          onToggleRun={onToggleRun}
          onReset={onReset}
          ready={ready}
          canRestart={canRestart}
        />
        <ScorePracticeCluster
          mode={mode}
          clickActive={clickActive}
          onToggleClick={onToggleClick}
          clickDisabled={clickDisabled}
          loopActive={loopActive}
          loopEnabled={loopEnabled}
          scopeLabel={scopeLabel}
          sections={sections}
          onPickSection={onPickSection}
          onStartSelect={onStartSelect}
          onClearFocus={onClearFocus}
          onNudge={onNudge}
          onToggleLoop={onToggleLoop}
        />
        {hasPosition && <span className="piano-score-position tabular-nums" data-testid="score-position">{position}</span>}
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
        onCyclePart={onCyclePart}
        grandStaff={grandStaff}
        handsValue={handsValue}
        onHandsChange={onHandsChange}
        keyboardVisible={keyboardVisible}
        onToggleKeyboard={onToggleKeyboard}
        baseBpm={baseBpm}
        keyFifths={keyFifths}
        keyMode={keyMode}
        onBodyRender={onBodyRender}
      />
    </div>
  );
}

// Exported for targeted render-count testing of the memoized expensive subtree.
export { ScoreViewControls };
