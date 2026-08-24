import {
  GameSheet, GameField, GameChoice, GameToggle,
} from '../game-platform/chrome/index.js';
import AddressingSettings from '../game-platform/addressing/AddressingSettings.jsx';

/**
 * Settings, in the game, in the player's hands.
 *
 * There is no hint control here: help is asked for at the keys (semitone
 * clusters), not configured, so "no help up front" is the board's resting state
 * rather than a setting anyone can leave on. Refusal loudness (flash, toast) is
 * a different question and stays in YAML.
 *
 * Every control is a discrete tap target — this runs on a kiosk, and a slider on
 * a touchscreen is a guess, not a choice. What it is NOT any more is six
 * hand-rolled radio groups: this panel built its own segmented control six
 * times, marked each with `aria-pressed` (a toggle's attribute, on a set where
 * exactly one option is chosen), rendered two plain booleans as two-button
 * choices, and printed raw milliseconds at a child. All six are `GameChoice` and
 * `GameToggle` now, and the panel is a real dialog.
 */

/**
 * How long the character waits before replying, in words a player can act on.
 *
 * The old control printed "300 ms / 700 ms / 1200 ms". A number in milliseconds
 * is not a unit anyone chooses in, so the label describes the feel rather than
 * exposing an implementation unit.
 */
const REPLY_SPEEDS = [
  { value: 300, label: 'Quick' },
  { value: 700, label: 'Normal' },
  { value: 1200, label: 'Thoughtful' },
];

const VOCABULARIES = [
  { value: 'chords', label: 'Chords' },
  { value: 'staff', label: 'Notes on a staff' },
];

export default function ChessSettingsPanel({ config, rungId, onChange, onClose }) {
  const rungs = Array.isArray(config?.rungs) ? config.rungs : [];
  const shuffle = config?.addressing?.shuffle !== 'never';
  const delayMs = config?.opponent_delay_ms ?? 700;
  const labelsOn = config?.feedback?.show_destination_labels !== false;
  const soundOn = config?.feedback?.sound !== false;
  const addressing = config?.addressing?.vocabulary === 'staff' ? 'staff' : 'chords';

  return (
    <GameSheet title="Settings" onClose={onClose} className="chess-settings">
      <GameField label="Opponent">
        <GameChoice
          value={rungId}
          options={rungs.map((rung) => ({ value: rung.id, label: rung.label }))}
          onChange={(value) => onChange({ default_rung: value })}
        />
      </GameField>

      {/* The reading ladder, shared with every other addressed board — see
          game-platform/addressing/AddressingSettings.jsx. */}
      <AddressingSettings config={config} axisSize={8} onChange={onChange} />

      {/* The vocabulary on its own, for the case the ladder cannot serve: a
          child who reads well but cannot spell, or the reverse. Reading both
          clefs comes years before spelling chords, so this is the setting that
          decides whether a given child can play at all. */}
      <GameField label="Squares are" note="Takes effect next game.">
        <GameChoice
          value={addressing}
          options={VOCABULARIES}
          onChange={(value) => onChange({ addressing: { vocabulary: value } })}
        />
      </GameField>

      {/* One boolean, one switch. This was a single `aria-pressed` button whose
          accessible name carried its own caveat, so "next game" was read out
          every time the option was announced. */}
      <GameField label="Chord map" note="Takes effect next game — a mid-game re-deal would rearrange the board under the player.">
        <GameToggle
          label="Shuffle chords each turn"
          checked={shuffle}
          onChange={(next) => onChange({ addressing: { shuffle: next ? 'each_turn' : 'never' } })}
        />
      </GameField>

      {/* Not a hint control: the labels appear only after the player picks a
          piece up, and that double-play was the request. This just chooses
          whether the board answers it. */}
      <GameField label="Name the squares">
        <GameToggle
          label="Show the chord on every square you can reach"
          checked={labelsOn}
          onChange={(next) => onChange({ feedback: { show_destination_labels: next } })}
        />
      </GameField>

      {/* The board confirms a move, a capture, a refusal and a check out loud.
          Operator-facing because a room with someone practising in it is a room
          where a second voice is sometimes unwelcome. */}
      <GameField label="Sound">
        <GameToggle
          label="Play the board's cues"
          checked={soundOn}
          onChange={(next) => onChange({ feedback: { sound: next } })}
        />
      </GameField>

      <GameField label="Opponent replies">
        <GameChoice
          value={delayMs}
          options={REPLY_SPEEDS}
          onChange={(value) => onChange({ opponent_delay_ms: value })}
        />
      </GameField>
    </GameSheet>
  );
}
