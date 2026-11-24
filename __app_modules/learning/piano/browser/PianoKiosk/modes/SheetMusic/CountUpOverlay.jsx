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
const NOTEHEADS = Object.freeze({ note: '\u2669', x: '\u2715' });
const REST = '\u{1D13D}';

/**
 * THE COUNT IN BARS (2026-11-24): `slots` from `exerciseCountInPlan` lay the count out beat by beat, in
 * bar groups, with the step's entry drawn as a note box in its own beat from the first click ("play on
 * this beat", not "after the count") and a rest box where a later hand waits out the pickup. The box
 * under the click is lit; `count` is its 1-based position in `slots`.
 */
function SlotBand({ slots, count, last, notehead, notice }) {
  const groups = [];
  slots.forEach((slot, index) => {
    const group = groups.at(-1);
    if (group && group.bar === slot.bar) group.items.push([slot, index]);
    else groups.push({ bar: slot.bar, items: [[slot, index]] });
  });
  const cue = notice ? notice : last ? 'next click: play' : `Play on the ${NOTEHEADS[notehead] ?? NOTEHEADS.note}`;
  return (
    <div className="piano-learn-countin" data-slots="true" aria-live="polite" aria-atomic="true"
      aria-label={notice ?? `Count ${count} of ${slots.length}. ${cue}`} data-count={count > 0 ? count : undefined}>
      <div className="piano-learn-countin__bars" aria-hidden="true">
        {groups.map((group, g) => (
          <ol key={g} className="piano-learn-countin__bar">
            {group.items.map(([slot, index]) => {
              const classes = ['piano-learn-countin__pip'];
              if (slot.beat === 1 && slot.kind === 'count') classes.push('is-accent');
              if (slot.kind === 'note') classes.push('is-note');
              if (slot.kind === 'rest') classes.push('is-rest');
              if (slot.half) classes.push('is-half');
              if (count > 0 && index + 1 < count && slot.kind === 'count') classes.push('is-lit');
              if (index + 1 === count) classes.push('is-current');
              const face = slot.kind === 'note' ? (NOTEHEADS[notehead] ?? NOTEHEADS.note) : slot.kind === 'rest' ? REST : String(slot.beat);
              return <li key={index} className={classes.join(' ')}>{face}</li>;
            })}
          </ol>
        ))}
      </div>
      <span className="piano-learn-countin__cue" aria-hidden="true">{cue}</span>
    </div>
  );
}

export default function CountUpOverlay({ active, clicks, count, last, loop = false, notice = null, slots = null, notehead = 'note' }) {
  if (!active || !(clicks > 0)) return null;
  if (!loop && Array.isArray(slots) && slots.length) return <SlotBand slots={slots} count={count} last={last} notehead={notehead} notice={notice} />;
  const armed = !(count > 0);
  // `loop`: the beat loop of "Settle into a beat". The marker steps round the bar for as long as the click
  // runs, and nothing is waiting for the child: they come in whenever they have the pulse.
  // `notice` replaces the cue with a sentence for the child (a missed cue sent the take back to the count).
  const cue = notice ? notice : loop ? 'Play when you feel the beat' : armed ? 'Listen for the clicks' : last ? 'next click: play' : '';
  const announcement = notice ? notice : loop ? `Beat ${count > 0 ? count : 1} of ${clicks}. Play when you feel the beat`
    : armed ? 'Get ready. Listen for the clicks' : `Count ${count} of ${clicks}${last ? ', next click: play' : ''}`;
  return (
    <div className="piano-learn-countin" aria-live="polite" aria-atomic="true" aria-label={announcement}
      data-armed={armed ? 'true' : undefined} data-count={armed ? undefined : count} data-loop={loop ? 'true' : undefined}>
      <ol className="piano-learn-countin__pips" aria-hidden="true">
        {Array.from({ length: clicks }, (_, index) => {
          const number = index + 1;
          const classes = ['piano-learn-countin__pip'];
          if (number === 1) classes.push('is-accent');
          if (!armed && (loop ? number === count : number <= count)) classes.push('is-lit');
          if (number === count) classes.push('is-current');
          return <li key={number} className={classes.join(' ')}>{number}</li>;
        })}
      </ol>
      <span className="piano-learn-countin__cue" aria-hidden="true">{cue}</span>
    </div>
  );
}
