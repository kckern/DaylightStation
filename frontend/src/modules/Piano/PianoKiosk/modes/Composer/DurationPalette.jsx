// DurationPalette.jsx — the toolbar's note-value palette, absorbing the pattern
// every desktop/tablet notation app uses (Dorico, Maestro, Crescendo): a row of
// real note-value GLYPHS, the active one highlighted, each TAPPABLE and printed
// with its numpad digit so the physical-keypad mapping is self-documenting (you
// never have to remember that 5 = quarter — the button says so). Taps and numpad
// keys share one path (useComposerInput's setters), so keyboard and touch agree.
//
// Glyphs are hand-drawn inline SVG rather than Unicode music symbols (U+1D15x
// half/whole/16th tofu in many system fonts on the kiosk's Firefox) — reliable
// at any size, inherit `currentColor`.

const DURATIONS = [
  { type: '16th', key: '1', label: 'Sixteenth' },
  { type: 'eighth', key: '3', label: 'Eighth' },
  { type: 'quarter', key: '5', label: 'Quarter' },
  { type: 'half', key: '7', label: 'Half' },
  { type: 'whole', key: '9', label: 'Whole' },
];

function NoteGlyph({ type }) {
  const hollow = type === 'half' || type === 'whole';
  const hasStem = type !== 'whole';
  const flags = type === 'eighth' ? 1 : type === '16th' ? 2 : 0;
  return (
    <svg className="composer-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <g transform="rotate(-20 8 17)">
        <ellipse
          cx="8"
          cy="17"
          rx="5"
          ry="3.4"
          fill={hollow ? 'none' : 'currentColor'}
          stroke="currentColor"
          strokeWidth={hollow ? 1.7 : 0}
        />
      </g>
      {hasStem && <line x1="12.7" y1="16" x2="12.7" y2="3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      {flags >= 1 && <path d="M12.7 3 q5.5 2.2 3.6 7.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      {flags >= 2 && <path d="M12.7 6.6 q5.5 2.2 3.6 7.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  );
}

export function DurationPalette({ hud, setDuration, toggleDot, toggleArm, addRest }) {
  const { type, dots, armed } = hud || {};
  return (
    <div className="composer-palette" role="group" aria-label="Note tools">
      <div className="composer-palette__durations">
        {DURATIONS.map((d) => (
          <button
            key={d.type}
            type="button"
            className={`composer-palette__dur${type === d.type ? ' is-active' : ''}`}
            aria-pressed={type === d.type}
            aria-label={`${d.label} note (numpad ${d.key})`}
            title={`${d.label} note · numpad ${d.key}`}
            onClick={() => setDuration(d.type)}
          >
            <NoteGlyph type={d.type} />
            <span className="composer-palette__key">{d.key}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`composer-palette__mod${dots ? ' is-active' : ''}`}
        aria-pressed={!!dots}
        aria-label="Dotted note (numpad .)"
        title="Dotted · numpad ."
        onClick={toggleDot}
      >
        <span className="composer-palette__dot">♩<b>.</b></span>
      </button>

      <button
        type="button"
        className="composer-palette__mod"
        aria-label="Add a rest (numpad 0)"
        title="Rest · numpad 0"
        onClick={addRest}
      >
        Rest
      </button>

      <button
        type="button"
        className={`composer-palette__arm${armed ? ' is-armed' : ''}`}
        aria-pressed={!!armed}
        aria-label={armed ? 'Armed — the piano writes notes (numpad 4)' : 'Play freely — the piano does not write (numpad 4)'}
        title="Arm the piano · numpad 4"
        onClick={toggleArm}
      >
        <span className="composer-palette__arm-dot" aria-hidden="true" />
        {armed ? 'Armed' : 'Play'}
      </button>
    </div>
  );
}

export default DurationPalette;
