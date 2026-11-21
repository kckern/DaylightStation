/**
 * The Learn passage count-in: one pip per count-in click, numbered 1..N and lit
 * as each click sounds (the first accented), with "next click: play" on the last
 * click. Before the first click (armed, or the pre-roll) every pip is unlit and
 * the cue says to listen, so a key that armed the run is visibly heard.
 *
 * A band across the top of the stage, not a numeral over the music: on a Learn
 * passage the first notes stay readable during the count-in. Presentation only;
 * the owning run supplies `count` and `last` from `countUpPresentation`.
 */
export default function CountUpOverlay({ active, clicks, count, last }) {
  if (!active || !(clicks > 0)) return null;
  const armed = !(count > 0);
  const cue = armed ? 'Listen for the clicks' : last ? 'next click: play' : '';
  const announcement = armed ? 'Get ready. Listen for the clicks' : `Count ${count} of ${clicks}${last ? ', next click: play' : ''}`;
  return (
    <div className="piano-learn-countin" aria-live="polite" aria-atomic="true" aria-label={announcement}
      data-armed={armed ? 'true' : undefined} data-count={armed ? undefined : count}>
      <ol className="piano-learn-countin__pips" aria-hidden="true">
        {Array.from({ length: clicks }, (_, index) => {
          const number = index + 1;
          const classes = ['piano-learn-countin__pip'];
          if (number === 1) classes.push('is-accent');
          if (!armed && number <= count) classes.push('is-lit');
          if (number === count) classes.push('is-current');
          return <li key={number} className={classes.join(' ')}>{number}</li>;
        })}
      </ol>
      <span className="piano-learn-countin__cue" aria-hidden="true">{cue}</span>
    </div>
  );
}
