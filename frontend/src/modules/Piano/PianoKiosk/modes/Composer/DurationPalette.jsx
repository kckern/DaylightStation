// DurationPalette.jsx — the toolbar's note-value palette, absorbing the pattern
// every desktop/tablet notation app uses (Dorico, Maestro, Crescendo): a row of
// real note-value GLYPHS, the active one highlighted, each TAPPABLE and printed
// with its numpad digit so the physical-keypad mapping is self-documenting (you
// never have to remember that 5 = quarter — the button says so). Taps and numpad
// keys share one path (useComposerInput's setters), so keyboard and touch agree.
//
// Glyphs are hand-drawn inline SVG rather than Unicode music symbols (U+1D15x
// half/whole/16th tofu in many system fonts on the kiosk's Firefox) — reliable
// at any size, inherit `currentColor`. The dot / rest / delete marks come from
// icons.jsx, which extends that same house pattern to the rest of the mode.
import { IconBackspace, IconDot, IconQuarterRest } from './icons.jsx';

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
    // Drawn at 26px in the 24-unit box (i.e. slightly upscaled): the buttons are
    // sized for a child's fingertip, and a 20px glyph floated in a ~54px target
    // reads as a small mark in a big empty box rather than as the button's face.
    <svg className="composer-glyph" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
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

// The palette carries THREE interaction semantics, and they must stay
// distinguishable at a glance or the toolbar reads as one undifferentiated row:
//   - STICKY MODES (durations, dot) — aria-pressed, accent fill while selected;
//   - ONE-SHOT ACTIONS (rest, delete) — fire and revert, never pressed-looking;
//   - a GLOBAL TOGGLE (write) — its own state dot, since "is the piano writing?"
//     is the one thing the kid must be able to read from across the room.
export function DurationPalette({ hud, setDuration, toggleDot, toggleArm, addRest, deleteBack }) {
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
            {/* KEYCAP, not a bare digit. Printed plain, "1 3 5 7 9" under
                noteheads is exactly how FINGERING is notated in every piano
                method book — the one reading a piano-teaching app must not
                invite. The chip styling says "this is a key you press". */}
            <span className="composer-palette__keycap">{d.key}</span>
          </button>
        ))}
      </div>

      {/* DOTTED — drawn as what it means: a notehead followed by the
          augmentation dot. The old `♩.` was a Unicode note, i.e. tofu on the
          kiosk, in the very file whose header explains why the durations beside
          it are hand-drawn. */}
      <button
        type="button"
        className={`composer-palette__mod composer-palette__dotted${dots ? ' is-active' : ''}`}
        aria-pressed={!!dots}
        aria-label="Dotted note (numpad .)"
        title="Dotted · numpad ."
        onClick={toggleDot}
      >
        <NoteGlyph type="quarter" />
        <IconDot size={13} className="composer-palette__aug-dot" />
      </button>

      <button
        type="button"
        className="composer-palette__mod composer-palette__rest"
        aria-label="Add a rest (numpad 0)"
        title="Rest · numpad 0"
        onClick={addRest}
      >
        <IconQuarterRest size={24} />
        <span>Rest</span>
      </button>

      {/* DELETE — the touch path for the Backspace / numpad-minus binding, and
          the one control on this toolbar whose misfire is not recoverable by
          simply trying again: it and Rest used to sit adjacent at identical
          size in identical chrome, told apart only by their words, so a kid
          reaching for "remove that" who drifted one button left ADDED a rest
          instead. Three signals now separate them, and they are deliberately
          redundant because any one alone is thin:
            - SHAPE — a backspace keycap next to a rest glyph, which is a far
              bigger visual gap than "Delete" next to "Rest";
            - SPACE — the divider before it takes it out of the rest cluster,
              so the two are no longer neighbours at all;
            - a restrained warm TINT — enough to mark it as the destructive one,
              not enough to be alarming. Deleting a note is routine here and
              undo sits at the other end of the toolbar; a red alert button
              would teach a kid to fear the control they need most.
          Safe to tap on an empty score: deleteBeforeCaret no-ops. */}
      <span className="composer-palette__sep" aria-hidden="true" />
      <button
        type="button"
        className="composer-palette__mod composer-palette__delete"
        aria-label="Delete the last note (Backspace)"
        title="Delete the last note · Backspace"
        onClick={deleteBack}
      >
        <IconBackspace size={22} />
        <span>Delete</span>
      </button>

      {/* The WRITE toggle. Its label is CONSTANT in both states, deliberately:
          it names what the control does, not what state it is in. The old
          "Play" / "Armed" pair failed twice over — "Play" is a transport word on
          the most transport-looking control in a mode that plays nothing (a kid
          taps it expecting to hear their song), and a state-naming toggle is
          ambiguous in the classic way ("does tapping Play start it, or am I in
          it?"). The state dot + accent fill carry on/off. */}
      <button
        type="button"
        className={`composer-palette__arm${armed ? ' is-armed' : ''}`}
        aria-pressed={!!armed}
        aria-label={armed ? 'Write is on — the piano writes notes here (numpad 4)' : 'Write is off — play freely (numpad 4)'}
        title="Write · numpad 4"
        onClick={toggleArm}
      >
        <span className="composer-palette__arm-dot" aria-hidden="true" />
        Write
      </button>
    </div>
  );
}

export default DurationPalette;
