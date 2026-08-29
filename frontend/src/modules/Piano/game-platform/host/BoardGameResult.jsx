import OpponentPanel from '../opponent/OpponentPanel.jsx';
import './boardGameCeremony.scss';

const HEADLINE = { win: 'You win', loss: 'You lose', draw: 'Draw' };

export default function BoardGameResult({
  result, opponent, level, speech = null, promoted = false, message = null,
  metrics = null, onPlayAgain, classPrefix = null, decoration = null,
}) {
  const entries = metrics && !Array.isArray(metrics) ? Object.entries(metrics) : metrics;
  return (
    <div className={`pg-result pg-result--${result || 'draw'}${classPrefix ? ` ${classPrefix} ${classPrefix}--${result || 'draw'}` : ''}`} role="status">
      {decoration}
      <div className={`pg-result__card${classPrefix ? ` ${classPrefix}__card` : ''}`}>
        {opponent && <OpponentPanel opponent={opponent} level={level} size="lg" speech={speech} />}
        <p className={`pg-result__headline${classPrefix ? ` ${classPrefix}__headline` : ''}`}>{HEADLINE[result] || 'Game over'}</p>
        {message && <p className={`pg-result__message${classPrefix ? ` ${classPrefix}__outcome` : ''}`}>{message}</p>}
        {promoted && <p className={`pg-result__promoted${classPrefix ? ` ${classPrefix}__promoted` : ''}`}>New opponent unlocked</p>}
        {entries?.length > 0 && (
          <dl className={`pg-result__metrics${classPrefix ? ` ${classPrefix}__tallies` : ''}`}>{entries.map(([label, value]) => (
            <div key={label} className={classPrefix ? `${classPrefix}__tally` : undefined}>
              <dt className={classPrefix ? `${classPrefix}__tally-label` : undefined}>{label}</dt>
              <dd className={classPrefix ? `${classPrefix}__tally-value` : undefined}>{value}</dd>
            </div>
          ))}</dl>
        )}
        <button type="button" className={`pg-result__again${classPrefix ? ` ${classPrefix}__again` : ''}`} onClick={onPlayAgain}>Play again</button>
        <p className={`pg-result__hint${classPrefix ? ` ${classPrefix}__hint` : ''}`}>or play any octave</p>
      </div>
    </div>
  );
}
