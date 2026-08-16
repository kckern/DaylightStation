/**
 * Settings, in the game, in the player's hands.
 *
 * There is no hint control here: help is asked for at the keys (semitone
 * clusters), not configured, so "no help up front" is the board's resting
 * state rather than a setting anyone can leave on. Refusal loudness (flash,
 * toast) is a different question and stays in YAML.
 *
 * Every control is a discrete tap target — this runs on a kiosk, and a slider
 * on a touchscreen is a guess, not a choice.
 */
const DELAY_CHOICES_MS = [300, 700, 1200];

export default function ChessSettingsPanel({ config, rungId, onChange, onClose }) {
  const rungs = Array.isArray(config?.rungs) ? config.rungs : [];
  const shuffle = config?.shuffle_each_turn !== false;
  const delayMs = config?.opponent_delay_ms ?? 700;
  const labelsOn = config?.feedback?.show_destination_labels !== false;
  const soundOn = config?.feedback?.sound !== false;
  const addressing = config?.addressing === 'staff' ? 'staff' : 'chords';

  return (
    <section className="chess-settings" aria-label="Chess settings">
      <header className="chess-settings__head">
        <h2 className="chess-settings__title">Settings</h2>
        <button type="button" className="chess-settings__close" onClick={onClose}>Done</button>
      </header>

      <h3 className="chess-settings__group">Opponent</h3>
      <div className="chess-settings__row">
        {rungs.map((rung) => (
          <button
            key={rung.id}
            type="button"
            className={`chess-settings__opt${rung.id === rungId ? ' is-active' : ''}`}
            aria-pressed={rung.id === rungId}
            onClick={() => onChange({ default_rung: rung.id })}
          >
            {rung.label}
          </button>
        ))}
      </div>

      {/* The addressing vocabulary — which skill the board asks for. Reading
          both clefs comes years before spelling chords, so this is the setting
          that decides whether a given child can play at all. Takes effect on
          the next game, like the chord map, and for the same reason. */}
      <h3 className="chess-settings__group">Squares are</h3>
      <div className="chess-settings__row">
        {[
          { id: 'chords', label: 'Chords' },
          { id: 'staff', label: 'Notes on a staff' },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`chess-settings__opt${addressing === opt.id ? ' is-active' : ''}`}
            aria-pressed={addressing === opt.id}
            onClick={() => onChange({ addressing: opt.id })}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <h3 className="chess-settings__group">Chord map</h3>
      <div className="chess-settings__row">
        {/* Takes effect next game: the map is dealt when the game is created,
            and a mid-game re-deal would rearrange the board under the player. */}
        <button
          type="button"
          className={`chess-settings__opt${shuffle ? ' is-active' : ''}`}
          aria-pressed={shuffle}
          onClick={() => onChange({ shuffle_each_turn: !shuffle })}
        >
          Shuffle chords each turn
          <span className="chess-settings__note">next game</span>
        </button>
      </div>

      <h3 className="chess-settings__group">Name the squares</h3>
      <div className="chess-settings__row">
        {/* Not a hint control: the labels appear only after the player picks a
            piece up, and that double-play was the request. This just chooses
            whether the board answers it. */}
        {[{ id: true, label: 'Show chords' }, { id: false, label: 'Hide chords' }].map((opt) => (
          <button
            key={String(opt.id)}
            type="button"
            className={`chess-settings__opt${labelsOn === opt.id ? ' is-active' : ''}`}
            aria-pressed={labelsOn === opt.id}
            onClick={() => onChange({ feedback: { show_destination_labels: opt.id } })}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <h3 className="chess-settings__group">Sound</h3>
      <div className="chess-settings__row">
        {/* The board confirms a move, a capture, a refusal and a check out
            loud. Operator-facing because a room with someone practising in it
            is a room where a second voice is sometimes unwelcome. */}
        {[{ id: true, label: 'Sound on' }, { id: false, label: 'Silent' }].map((opt) => (
          <button
            key={String(opt.id)}
            type="button"
            className={`chess-settings__opt${soundOn === opt.id ? ' is-active' : ''}`}
            aria-pressed={soundOn === opt.id}
            onClick={() => onChange({ feedback: { sound: opt.id } })}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <h3 className="chess-settings__group">Opponent replies after</h3>
      <div className="chess-settings__row">
        {DELAY_CHOICES_MS.map((ms) => (
          <button
            key={ms}
            type="button"
            className={`chess-settings__opt${ms === delayMs ? ' is-active' : ''}`}
            aria-pressed={ms === delayMs}
            onClick={() => onChange({ opponent_delay_ms: ms })}
          >
            {ms} ms
          </button>
        ))}
      </div>
    </section>
  );
}
