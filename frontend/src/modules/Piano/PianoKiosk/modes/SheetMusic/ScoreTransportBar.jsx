import React, { useState } from 'react';

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
 * ScoreTransportBar — pinned bottom transport for the sheet-music player.
 *
 * Purely presentational: all state is lifted to props. No MIDI / OSMD / logging /
 * router concerns live here. Replaces the old top toolbar (top bar becomes
 * breadcrumb-only).
 *
 * Mode-aware clusters (deeper per-mode features land in later tasks):
 *  Listen  — playback (reset/run/position), part roles, tempo, play-along, size/keyboard/info, click toggle.
 *  Learn   — parts + click toggle + position (transport is a no-op — Learn waits).
 *  Polish  — parts + run/reset + position.
 *  Perform — a page-indicator placeholder only (no parts / no transport / no view controls).
 */
export default function ScoreTransportBar({
  mode,
  onMode,
  running,
  onToggleRun,
  onReset,
  step,
  total,
  flow,
  onToggleFlow,
  scale,
  onScale,
  tempoMult = 1,
  onTempo,
  playAlong = false,
  onTogglePlayAlong,
  parts = [],
  activeParts = {},
  roles = {},
  onCyclePart,
  keyboardVisible,
  onToggleKeyboard,
  clickOn = false,
  onToggleClick,
  meta = {},
}) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState(scale);
  const [infoOpen, setInfoOpen] = useState(false);
  const [tempoOpen, setTempoOpen] = useState(false);
  const [tempoDraft, setTempoDraft] = useState(tempoMult);

  const position = `${Math.min(step + 1, total)} / ${total}`;

  // Per-mode cluster gating.
  const isPerform = mode === 'perform';
  // Run (▶/❚❚) + reset (⟲) drive the transport, which only auto-advances in
  // Polish/Listen; Learn waits (transport empty → no-ops) and Perform is static.
  const hasTransport = mode === 'polish' || mode === 'listen';
  // Parts (roles in Listen; active on/off in Learn/Polish) and the position readout
  // and view controls exist in every mode but Perform.
  const hasParts = !isPerform;
  const hasPosition = !isPerform;
  const hasViewControls = !isPerform;
  // The metronome-click toggle lives in Listen and Learn (Polish/Perform omit it).
  const hasClick = mode === 'listen' || mode === 'learn';
  // Tempo control + play-along light-up are Listen-only (jukebox performance).
  const hasListenExtras = mode === 'listen';

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
    <div className="piano-score-transportbar">
      {/* Left — mode tabs */}
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

      {/* Center — playback cluster (mode-aware) */}
      <div className="piano-score-playback">
        {hasTransport && (
          <button
            type="button"
            className="piano-score-btn piano-score-reset"
            aria-label="Reset"
            onClick={onReset}
          >
            {'⟲'}
          </button>
        )}
        {hasTransport && (
          <button
            type="button"
            className="piano-score-btn piano-score-run"
            aria-label={running ? 'Pause' : 'Play'}
            aria-pressed={running}
            onClick={onToggleRun}
          >
            {running ? '❚❚' : '▶'}
          </button>
        )}
        {hasPosition && <span className="piano-score-position tabular-nums">{position}</span>}
        {isPerform && (
          <span className="piano-score-page-indicator" aria-label="Page">Perform</span>
        )}
      </div>

      {/* Right — parts, click & view controls (mode-aware) */}
      <div className="piano-score-view">
        {hasParts && (
          <div className="piano-score-parts">
            {parts.map(renderPartChip)}
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
    </div>
  );
}
