import React, { useState } from 'react';

const MODES = [
  { id: 'follow', label: 'Follow' },
  { id: 'metronome', label: 'Metronome' },
  { id: 'play', label: 'Play' },
  { id: 'manual', label: 'Manual' },
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
  parts = [],
  activeParts = {},
  roles = {},
  onCyclePart,
  keyboardVisible,
  onToggleKeyboard,
  meta = {},
}) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState(scale);
  const [infoOpen, setInfoOpen] = useState(false);

  const position = `${Math.min(step + 1, total)} / ${total}`;

  const openSize = () => {
    setSizeDraft(scale);
    setSizeOpen((v) => !v);
  };

  const commitScale = () => {
    onScale(Number(sizeDraft));
  };

  const renderPartChip = (part) => {
    const { staff, label } = part;
    if (mode === 'play') {
      const role = roles[staff] || 'mute';
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

      {/* Center — playback cluster */}
      <div className="piano-score-playback">
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
        <span className="piano-score-position tabular-nums">{position}</span>
      </div>

      {/* Right — view & parts */}
      <div className="piano-score-view">
        <div className="piano-score-parts">
          {parts.map(renderPartChip)}
        </div>

        <button
          type="button"
          className={`piano-score-btn piano-score-keyboard${keyboardVisible ? ' is-on' : ''}`}
          aria-label="Keyboard"
          aria-pressed={keyboardVisible}
          onClick={onToggleKeyboard}
        >
          {'⌨'}
        </button>

        <button
          type="button"
          className="piano-score-btn piano-score-flow"
          aria-label="Flow"
          onClick={onToggleFlow}
        >
          {flow === 'wrapped' ? '≡' : '→'}
        </button>

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
      </div>
    </div>
  );
}
