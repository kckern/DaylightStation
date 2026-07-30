/**
 * countIn — pure plan for the metronome count-in before a graded/play-along run.
 * Given the piece's meter (beats per measure) and the run tempo, it returns the
 * click count and per-click period so the player can click the user in before the
 * transport starts. DOM-free, unit-testable.
 *
 * Three things have to be true at once for a count-in to do its job, and at fast
 * tempi they pull against each other:
 *   1. the clicks must be slow enough to count (see MAX_COUNTABLE_BPM),
 *   2. the pulse must agree with the meter, or it teaches the wrong downbeat,
 *   3. the whole thing must last long enough to get hands to the keys.
 * The plan below resolves them in that order.
 */

// Above this effective tempo a quarter-note count-in stops being countable and
// becomes a buzz — 216bpm x 1.25 gives four clicks in 0.89s (audit M2).
const MAX_COUNTABLE_BPM = 140;

// A count-in shorter than this is countable but useless: there is no time to get
// hands to the keys. 1.5s sits between the two data points the audit gives us —
// longer than the 1.1s at which a user cancelled a count-in, shorter than the 2.0s
// of the ordinary 4/4-at-120bpm count-in nobody complains about (audit M2).
const MIN_LEAD_MS = 1500;

// Bound the click count when the tempo data is garbage (a bogus 1000bpm would
// otherwise pad out to a dozen-plus clicks chasing MIN_LEAD_MS).
const MAX_LEAD_BARS = 8;

// Only 2- and 3-based groupings are pulses a player can feel. 5 and 7 are not, so
// an irregular meter has no usable coarser pulse and stays on the quarter note.
const isPulseGrouping = (n) => {
  let m = n;
  while (m % 2 === 0) m /= 2;
  while (m % 3 === 0) m /= 3;
  return m === 1;
};

// Coarser pulses available for a b-beat bar, finest first: the divisors of b that
// are themselves duple/triple groupings. Always starts with 1 (the quarter pulse).
// 4 -> [1,2,4]; 3 -> [1,3]; 6 -> [1,2,3,6]; 9 -> [1,3,9]; 5 -> [1]; 7 -> [1].
const pulseOptions = (b) => {
  const out = [];
  for (let s = 1; s <= b; s++) if (b % s === 0 && isPulseGrouping(s)) out.push(s);
  return out;
};

/**
 * @param {{ beats?: number, bpm?: number, tempoMult?: number }} p
 *   beats = numerator of the time signature (beats per measure); bpm = written
 *   opening tempo; tempoMult = the user's tempo multiplier.
 * @returns {{ beats: number, periodMs: number, totalMs: number, subdivision: number }}
 *   beats = how many CLICKS to play — NOT the meter's beat count, and not
 *   necessarily one bar's worth: above MAX_COUNTABLE_BPM the pulse coarsens, and
 *   below MIN_LEAD_MS the count-in runs for extra bars;
 *   periodMs = ms between clicks; totalMs = length of the whole count-in;
 *   subdivision = quarter-notes per click (1 = quarter pulse, 2 = half-note,
 *   3 = dotted-half / one click per bar in 3/4).
 */
export function countInPlan({ beats, bpm, tempoMult = 1 }) {
  const b = Number.isFinite(beats) && beats >= 2 && beats <= 12 ? beats : 4; // sane meter, else common time
  const effBpm = (bpm > 0 ? bpm : 90) * (tempoMult > 0 ? tempoMult : 1);

  // Coarsen the pulse rather than shorten the count-in: same musical length, fewer
  // clicks, actually countable. The candidates DIVIDE the bar, so the clicks always
  // land on real beats — two clicks a half-note apart in 3/4 would put click 2 on
  // beat 3 and teach a duple feel against a triple piece, which is worse than a buzz.
  // Escalating over that list (1 -> 2 -> 4 in 4/4, 1 -> 3 in 3/4) covers the whole
  // tempo range, not just one halving: the top of TEMPO_STEPS is 1.75x, so a fast
  // 216bpm piece reaches 378 effective bpm and needs one click per bar (~94/min).
  // Residual worst case: a SHORT bar of an irregular or 2-beat meter, where the
  // coarsest usable pulse still exceeds the countable rate (5/4 has no divisor at
  // all; 2/4 at 324bpm tops out at 162 clicks/min). Both are rare and both are
  // helped by the lead-in rule below, which buys the player more preparation time.
  const options = pulseOptions(b);
  let subdivision = options[options.length - 1]; // coarsest available, if none suffices
  for (const s of options) {
    if (effBpm / s <= MAX_COUNTABLE_BPM) { subdivision = s; break; }
  }

  const periodMs = (60000 / effBpm) * subdivision;
  const clicksPerBar = Math.max(1, Math.ceil(b / subdivision));
  const barMs = clicksPerBar * periodMs;
  // Count in for as many bars as it takes to clear MIN_LEAD_MS. At 270 effective bpm
  // one 4/4 bar is 889ms — the audit's chirp — so this runs two bars (1.78s).
  const bars = Math.min(MAX_LEAD_BARS, Math.max(1, Math.ceil(MIN_LEAD_MS / barMs)));
  // Floor of 2: a single click conveys no tempo at all, since one event gives the
  // player no interval to feel.
  const clicks = Math.max(2, clicksPerBar * bars);

  return { beats: clicks, periodMs, totalMs: clicks * periodMs, subdivision };
}

export default { countInPlan };
