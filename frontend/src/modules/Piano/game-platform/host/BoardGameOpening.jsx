import './boardGameCeremony.scss';

export default function BoardGameOpening({
  opponent, playerLabel = 'You', turnLabel = 'Your move', className = '',
  versusClassName = '', turnClassName = '',
}) {
  return (
    <div className={`pg-opening ${className}`.trim()} role="status" aria-live="polite">
      <p className={`pg-opening__versus ${versusClassName}`.trim()}>{playerLabel} versus {opponent?.name || 'the opponent'}</p>
      <p className={`pg-opening__turn ${turnClassName}`.trim()}>{turnLabel}</p>
    </div>
  );
}
