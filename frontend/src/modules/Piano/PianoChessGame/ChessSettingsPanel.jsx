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
