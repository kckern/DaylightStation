const Arrow = ({ up }) => <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" style={up ? undefined : { transform: 'rotate(180deg)' }}><path d="M5 15.5 12 8.5l7 7" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// Past this many pages the pips would crowd the buttons out: one track with a marker instead.
const MAX_PIPS = 12;

/**
 * The page turner of the score, in every mode: two tall buttons in the right
 * margin of the paper and one pip per page. No words.
 */
export default function ScorePager({ page, onPrev, onNext }) {
  if (!page || page.pages < 2) return null;
  const stop = (handler) => (event) => { event.stopPropagation(); handler?.(); };
  return (
    <nav className="piano-score-pager" aria-label="Pages" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className="piano-score-pager__turn" aria-label="Previous page" disabled={!page.hasPrev} onClick={stop(onPrev)}><Arrow up /></button>
      {page.pages > MAX_PIPS ? (
        <div className="piano-score-pager__track" role="img" aria-label={`Page ${page.index + 1} of ${page.pages}`}>
          <span style={{ top: `${(page.index / page.pages) * 100}%`, height: `${100 / page.pages}%` }} />
        </div>
      ) : (
        <ol className="piano-score-pager__pips" aria-label={`Page ${page.index + 1} of ${page.pages}`}>
          {Array.from({ length: page.pages }, (_, index) => <li key={index} aria-current={index === page.index ? 'page' : undefined} />)}
        </ol>
      )}
      <button type="button" className="piano-score-pager__turn" aria-label="Next page" disabled={!page.hasNext} onClick={stop(onNext)}><Arrow /></button>
    </nav>
  );
}
