import React, { useState, memo } from 'react';

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
 * ScoreTransportButtons — reset (⟲) + run (▶/❚❚). These drive the transport,
 * which only auto-advances in Polish/Listen; Learn waits and Perform is static,
 * so they render only when `hasTransport`. Memoized so a step advance can't
 * reconcile them (they depend on mode/running, not step).
 */
const ScoreTransportButtons = memo(function ScoreTransportButtons({ mode, running, onToggleRun, onReset }) {
  const hasTransport = mode === 'polish' || mode === 'listen';
  if (!hasTransport) return null;
  return (
    <>
      <button
        type="button"
        className="piano-score-btn piano-score-reset"
        aria-label="Reset"
        onClick={onReset}
      >
        {'⟲'}
      </button>
      <button
        type="button"
        className="piano-score-btn piano-score-run"
        aria-label={running ? 'Pause' : 'Play'}
        aria-pressed={running}
        onClick={onToggleRun}
      >
        {running ? '❚❚' : '▶'}
      </button>
    </>
  );
});

/**
 * ScoreViewControls — the expensive right cluster: part chips, focus range,
 * click/scoring/play-along toggles, transpose, tempo & size popovers, keyboard,
 * flow, and the info popover. This is the bulk of the bar (~250 lines of DOM +
 * local popover state).
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
  playAlong = false,
  onTogglePlayAlong,
  parts = [],
  activeParts = {},
  roles = {},
  onCyclePart,
  sections = [],
  focus = null,
  loopArm = false,
  onPickSection,
  onArmLoop,
  onClearFocus,
  keyboardVisible,
  onToggleKeyboard,
  clickOn = false,
  onToggleClick,
  scoringOn = true,
  onToggleScoring,
  meta = {},
  onBodyRender,
}) {
  if (onBodyRender) onBodyRender();

  const [sizeOpen, setSizeOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState(scale);
  const [infoOpen, setInfoOpen] = useState(false);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [tempoDraft, setTempoDraft] = useState(tempoMult);

  // Per-mode cluster gating (all derived from `mode`, so identical across steps).
  const isPerform = mode === 'perform';
  const hasParts = !isPerform;
  const hasViewControls = !isPerform;
  // The metronome-click toggle lives in Listen and Learn (Polish/Perform omit it).
  const hasClick = mode === 'listen' || mode === 'learn';
  // Tempo control + play-along light-up are Listen-only (jukebox performance).
  const hasListenExtras = mode === 'listen';
  // Focus range (section chips + custom loop) is a Learn + Polish practice affordance.
  const hasFocus = mode === 'learn' || mode === 'polish';
  // Scoring on/off is a Polish-only toggle (grades measures red/yellow/green).
  const hasScoring = mode === 'polish';
  // Readout of the active range: a section shows its label; a custom loop shows a
  // 1-based measure span (indices are 0-based internally).
  const focusLabel = focus
    ? (focus.label || `m${focus.inMeasure + 1}–m${focus.outMeasure + 1}`)
    : null;

  const openSize = () => {
    setSizeDraft(scale);
    setSizeOpen((v) => !v);
  };

  const commitScale = () => {
    onScale(Number(sizeDraft));
  };

  const openTempo = () => {
    setTempoDraft(tempoMult);
    setTempoOpen((v) => !v);
  };

  const commitTempo = () => {
    onTempo?.(Number(tempoDraft));
  };

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
        {`${on ? '✓ ' : ''}${label}`}
      </button>
    );
  };

  return (
    <div className="piano-score-view">
      {hasParts && (
        <div className="piano-score-parts">
          {parts.map(renderPartChip)}
        </div>
      )}

      {hasFocus && (
        <div className="piano-score-focus" role="group" aria-label="Practice range">
          {sections.length > 0 && sections.map((s) => (
            <button
              key={s.label}
              type="button"
              className="piano-score-btn piano-score-section-chip"
              onClick={() => onPickSection?.(s)}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            className={`piano-score-btn piano-score-loop${loopArm ? ' is-on' : ''}`}
            aria-label="Loop range"
            aria-pressed={loopArm}
            onClick={onArmLoop}
          >
            {'Loop'}
          </button>
          {focus && (
            <button
              type="button"
              className="piano-score-btn piano-score-focus-clear"
              aria-label="Clear range"
              onClick={onClearFocus}
            >
              {'Clear'}
            </button>
          )}
          {focusLabel && (
            <span className="piano-score-focus-readout tabular-nums">{focusLabel}</span>
          )}
        </div>
      )}

      {hasClick && (
        <button
          type="button"
          className={`piano-score-btn piano-score-click${clickOn ? ' is-on' : ''}`}
          aria-label="Metronome click"
          aria-pressed={clickOn}
          onClick={onToggleClick}
        >
          {'♩'}
        </button>
      )}

      {hasScoring && (
        <button
          type="button"
          className={`piano-score-btn piano-score-scoring${scoringOn ? ' is-on' : ''}`}
          aria-label="Scoring"
          aria-pressed={scoringOn}
          onClick={onToggleScoring}
        >
          {'Scoring'}
        </button>
      )}

      {hasListenExtras && (
        <button
          type="button"
          className={`piano-score-btn piano-score-playalong${playAlong ? ' is-on' : ''}`}
          aria-label="Play along"
          aria-pressed={playAlong}
          onClick={onTogglePlayAlong}
        >
          {'Play-along'}
        </button>
      )}

      {hasListenExtras && (
        <div className="piano-score-key" role="group" aria-label="Key">
          <span className="piano-score-key-label">Key</span>
          <button
            type="button"
            className="piano-score-btn piano-score-key-down"
            aria-label="Transpose down"
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
            onClick={() => onTranspose?.(transpose + 1)}
          >
            {'+'}
          </button>
        </div>
      )}

      {hasListenExtras && (
        <div className="piano-score-tempo-wrap">
          <button
            type="button"
            className="piano-score-btn piano-score-tempo"
            aria-label="Tempo"
            aria-expanded={tempoOpen}
            onClick={openTempo}
          >
            {`Tempo ${Math.round(tempoMult * 100)}%`}
          </button>
          {tempoOpen && (
            <div className="piano-score-tempo-modal" role="dialog" aria-label="Tempo">
              <input
                type="range"
                role="slider"
                aria-label="Tempo"
                min="0.25"
                max="2"
                step="0.05"
                defaultValue={tempoMult}
                onChange={(e) => setTempoDraft(e.target.value)}
                onMouseUp={commitTempo}
                onTouchEnd={commitTempo}
                onKeyUp={commitTempo}
              />
              <span className="piano-score-tempo-preview tabular-nums">
                {`${Math.round(Number(tempoDraft) * 100)}%`}
              </span>
              <button
                type="button"
                className="piano-score-btn piano-score-tempo-apply"
                onClick={() => {
                  commitTempo();
                  setTempoOpen(false);
                }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {hasViewControls && (
        <button
          type="button"
          className={`piano-score-btn piano-score-keyboard${keyboardVisible ? ' is-on' : ''}`}
          aria-label="Keyboard"
          aria-pressed={keyboardVisible}
          onClick={onToggleKeyboard}
        >
          {'⌨'}
        </button>
      )}

      {hasViewControls && (
        <button
          type="button"
          className="piano-score-btn piano-score-flow"
          aria-label="Flow"
          onClick={onToggleFlow}
        >
          {flow === 'wrapped' ? '≡' : '→'}
        </button>
      )}

      {hasViewControls && (
        <div className="piano-score-size-wrap">
          <button
            type="button"
            className="piano-score-btn piano-score-size"
            aria-label="Size"
            aria-expanded={sizeOpen}
            onClick={openSize}
          >
            {`Size ${Math.round(scale * 100)}%`}
          </button>
          {sizeOpen && (
            <div className="piano-score-size-modal" role="dialog" aria-label="Size">
              <input
                type="range"
                role="slider"
                aria-label="Size"
                min="0.7"
                max="2"
                step="0.05"
                defaultValue={scale}
                onChange={(e) => setSizeDraft(e.target.value)}
                onMouseUp={commitScale}
                onTouchEnd={commitScale}
                onKeyUp={commitScale}
              />
              <span className="piano-score-size-preview tabular-nums">
                {`${Math.round(Number(sizeDraft) * 100)}%`}
              </span>
              <button
                type="button"
                className="piano-score-btn piano-score-size-apply"
                onClick={() => {
                  commitScale();
                  setSizeOpen(false);
                }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {hasViewControls && (
        <div className="piano-score-info-wrap">
          <button
            type="button"
            className="piano-score-btn piano-score-info"
            aria-label="Info"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((v) => !v)}
          >
            {'ⓘ'}
          </button>
          {infoOpen && (
            <div className="piano-score-info-popover" role="dialog" aria-label="Info">
              <dl>
                {meta.title != null && (
                  <><dt>Title</dt><dd>{meta.title}</dd></>
                )}
                {meta.composer != null && (
                  <><dt>Composer</dt><dd>{meta.composer}</dd></>
                )}
                {meta.key != null && (
                  <><dt>Key</dt><dd>{meta.key}</dd></>
                )}
                {meta.time != null && (
                  <><dt>Time</dt><dd>{meta.time}</dd></>
                )}
                {meta.tempo != null && (
                  <><dt>Tempo</dt><dd>{meta.tempo}</dd></>
                )}
                {meta.measures != null && (
                  <><dt>Measures</dt><dd>{meta.measures}</dd></>
                )}
              </dl>
            </div>
          )}
        </div>
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
 * Mode-aware clusters:
 *  Listen  — playback (reset/run/position), part roles, tempo, play-along, size/keyboard/info, click toggle.
 *  Learn   — parts + click toggle + position (transport is a no-op — Learn waits).
 *  Polish  — parts + run/reset + position.
 *  Perform — a {page} / {pages} indicator only (no parts / no transport / no view controls).
 *
 * Perf structure (Task 10): this component is a THIN SHELL. It threads props and
 * owns only the cheap, step-dependent position readout in the center column. The
 * three expensive clusters — mode tabs, transport buttons, and the right-hand view
 * controls — are `React.memo`'d children whose props don't change as the cursor
 * steps, so advancing `step` re-renders only this shell + the small readout, and
 * the memoized subtrees bail out. (Approach B: sub-section memoization; the readout
 * must stay nested inside the space-between flex layout, so it can't be split off
 * as a sibling à la Approach A.)
 */
export default function ScoreTransportBar({
  mode,
  onMode,
  running,
  onToggleRun,
  onReset,
  step,
  total,
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
  playAlong,
  onTogglePlayAlong,
  parts,
  activeParts,
  roles,
  onCyclePart,
  sections,
  focus,
  loopArm,
  onPickSection,
  onArmLoop,
  onClearFocus,
  keyboardVisible,
  onToggleKeyboard,
  clickOn,
  onToggleClick,
  scoringOn,
  onToggleScoring,
  meta,
  onBodyRender,
}) {
  const position = `${Math.min(step + 1, total)} / ${total}`;

  const isPerform = mode === 'perform';
  // The position readout and page indicator exist in every mode but Perform.
  const hasPosition = !isPerform;

  return (
    <div className="piano-score-transportbar">
      {/* Left — mode tabs (memoized; step-independent) */}
      <ScoreModeTabs mode={mode} onMode={onMode} />

      {/* Center — transport buttons (memoized) + the per-step position readout (shell) */}
      <div className="piano-score-playback">
        <ScoreTransportButtons
          mode={mode}
          running={running}
          onToggleRun={onToggleRun}
          onReset={onReset}
        />
        {hasPosition && <span className="piano-score-position tabular-nums">{position}</span>}
        {isPerform && (
          <span className="piano-score-page-indicator tabular-nums" aria-label="Page">{`${page} / ${pages}`}</span>
        )}
      </div>

      {/* Right — parts, click & view controls (memoized; step-independent) */}
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
        playAlong={playAlong}
        onTogglePlayAlong={onTogglePlayAlong}
        parts={parts}
        activeParts={activeParts}
        roles={roles}
        onCyclePart={onCyclePart}
        sections={sections}
        focus={focus}
        loopArm={loopArm}
        onPickSection={onPickSection}
        onArmLoop={onArmLoop}
        onClearFocus={onClearFocus}
        keyboardVisible={keyboardVisible}
        onToggleKeyboard={onToggleKeyboard}
        clickOn={clickOn}
        onToggleClick={onToggleClick}
        scoringOn={scoringOn}
        onToggleScoring={onToggleScoring}
        meta={meta}
        onBodyRender={onBodyRender}
      />
    </div>
  );
}

// Exported for targeted render-count testing of the memoized expensive subtree.
export { ScoreViewControls };
