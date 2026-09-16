import { gateSentence, roundHeading, standingRows } from './roundStandingModel.js';
import './RoundStanding.scss';

/**
 * Where a player stands in this round, drawn rather than counted at them.
 *
 * A child beat the same opponent six times and did not advance. Four of those
 * six had leant on the analysis engine and did not count, and no screen said
 * so — so he decided the ladder was broken. "2 of 5" alone would not have
 * answered him; it contradicts the thing he knows to be true. Six markers in
 * two rows does answer him: every win he remembers is on the screen, and the
 * rows say what kind each was.
 *
 * The rows are cumulative and only ever grow. The gate — five of your last
 * seven — is recent form and may fall, so it is a sentence underneath rather
 * than a row that could take a marker back.
 */

/** One row of markers. Drawn as a list so a screen reader counts them too. */
function StandingRow({ row }) {
  return (
    <li className={`chess-round__row chess-round__row--${row.key}`}>
      <span className="chess-round__label">{row.label}</span>
      <span className="chess-round__markers" aria-hidden="true">
        {Array.from({ length: row.filled }, (unused, index) => (
          <span key={index} className="chess-round__marker" />
        ))}
        {row.filled === 0 && <span className="chess-round__marker chess-round__marker--none" />}
      </span>
      <span className="chess-round__count">{row.filled}</span>
      <span className="chess-round__note">{row.note}</span>
    </li>
  );
}

export function RoundStanding({ standing, opponentName = null, nextName = null }) {
  if (!standing) return null;
  const rows = standingRows(standing);
  const sentence = gateSentence(standing, { nextName });
  return (
    <section className="chess-round" aria-label="Where you stand in this round">
      <h3 className="chess-round__heading">{roundHeading(standing, { opponentName })}</h3>
      <ul className="chess-round__rows">
        {rows.map((row) => <StandingRow key={row.key} row={row} />)}
      </ul>
      {sentence && <p className="chess-round__gate">{sentence}</p>}
    </section>
  );
}

export default RoundStanding;
