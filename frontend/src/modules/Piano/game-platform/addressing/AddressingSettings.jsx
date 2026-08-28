import { GameField, GameStepper, GameToggle } from '../chrome/index.js';
import { ADDRESSING_RUNGS } from './dimensions.js';
import { activeRung, resolveAddressing } from './resolveAddressing.js';
import { describeAddressing } from './addressingDescription.js';

const RUNG_OPTIONS = ADDRESSING_RUNGS.map((rung) => ({ value: rung.rung, label: rung.label }));

/**
 * The reading level, as one control, for any game on the addressing ladder.
 *
 * Nobody hand-picks from 432 combinations of vocabulary, clef pair, tier,
 * ordering, cadence and inversion policy, so the control offered is the LADDER:
 * a step, with a line beneath saying what the rung resolves to. The individual
 * dimensions stay configurable in YAML for anyone who wants them.
 *
 * Shared rather than per-game because "how hard is the reading" is the same
 * question on every board, and chess having a better answer than checkers is
 * exactly the drift this platform exists to stop.
 */
export default function AddressingSettings({ config, axisSize = 8, onChange }) {
  const ladder = (config?.addressing && typeof config.addressing === 'object')
    ? config.addressing.ladder ?? null : null;
  const rung = activeRung(ladder) ?? 3;
  const pinned = Number.isFinite(ladder?.pinned);
  const resolved = resolveAddressing({ game: config, rung, axisSize });

  return (
    <>
      <GameField label="Reading level" note={describeAddressing(resolved)}>
        <GameStepper
          label="reading level"
          value={rung}
          options={RUNG_OPTIONS}
          onChange={(value) => onChange({ addressing: { ladder: { pinned: value } } })}
        />
      </GameField>

      {/* The "hold this player still" case: keep it sequential, keep it root
          notes, regardless of what they have earned. */}
      <GameField label="Hold the level">
        <GameToggle
          label="Stay here — don't move up as they win"
          checked={pinned}
          onChange={(next) => onChange({ addressing: { ladder: { pinned: next ? rung : null } } })}
        />
      </GameField>
    </>
  );
}
