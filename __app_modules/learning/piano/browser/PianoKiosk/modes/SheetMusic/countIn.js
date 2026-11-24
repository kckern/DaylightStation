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

/**
 * THE ASK'S OWN PULSE, in quarter notes — the spacing every onset shares, or
 * `null` when the ask has no single spacing (one note, or an uneven rhythm,
 * where there is no one pulse to count).
 *
 * This is what a cued count-in must click at. Counting quarters at a scale
 * written in eighths tells a child the wrong grid and then grades them on the
 * other one; see `askPace` below for what that cost, twice.
 */
export function askPulseQuarters(onsetQuarters = []) {
  if (!Array.isArray(onsetQuarters) || onsetQuarters.length < 2) return null;
  const steps = [];
  for (let i = 1; i < onsetQuarters.length; i += 1) {
    const step = Number(onsetQuarters[i]) - Number(onsetQuarters[i - 1]);
    if (!Number.isFinite(step) || step <= 0) return null;
    steps.push(step);
  }
  const first = steps[0];
  return steps.every((step) => Math.abs(step - first) < 1e-6) ? first : null;
}

const WHOLE = 1e-6;
const isWhole = (value) => Math.abs(value - Math.round(value)) < WHOLE;

/**
 * WHERE THE FIRST NOTE SITS IN ITS BAR, in quarters from that bar's downbeat.
 *
 * A pickup bar is short and right-aligned: a one-beat pickup in 4/4 sits on
 * beat 4. On 2026-11-22 a child counted 1-2-3-4 into a piece that opens on a
 * one-beat pickup; the clicks treated the pickup as a downbeat, so bar 1 came a
 * beat late and he had to count to five. The full bar is the most common bar
 * length after the first; the first bar's real length is read from where the
 * second bar starts (cumulative timestamps), because a pickup's written length
 * may be reported as a whole bar.
 *
 * @param {{ measures?: Array<{onsetQuarter:number, durationQuarters:number}>, firstOnsetQuarter?: number }} p
 * @returns {number|null}
 */
export function entryOffsetQuarters({ measures, firstOnsetQuarter } = {}) {
  if (!Array.isArray(measures) || !measures.length || !Number.isFinite(firstOnsetQuarter)) return null;
  if (!measures.every((m) => Number.isFinite(m?.onsetQuarter) && Number.isFinite(m?.durationQuarters) && m.durationQuarters > 0)) return null;
  const counts = new Map();
  for (const m of measures.slice(1)) counts.set(m.durationQuarters, (counts.get(m.durationQuarters) ?? 0) + 1);
  const fullBar = counts.size ? [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0] : measures[0].durationQuarters;
  const firstBar = measures.length > 1 ? measures[1].onsetQuarter - measures[0].onsetQuarter : measures[0].durationQuarters;
  const home = [...measures].reverse().find((m) => m.onsetQuarter <= firstOnsetQuarter + WHOLE) ?? measures[0];
  // A short first bar is a pickup unless the score says it is a real bar (a
  // written 2/4 opening before 4/4): `implicit: false` from the engraver.
  if (home === measures[0] && measures[0].implicit !== false && firstBar > 0 && firstBar < fullBar - WHOLE) {
    return fullBar - firstBar + (firstOnsetQuarter - measures[0].onsetQuarter);
  }
  return Math.max(0, firstOnsetQuarter - home.onsetQuarter);
}

/**
 * Reshape a count-in so its last click is the beat before the first note.
 * A note on a downbeat keeps the count it had. Fewer than two clicks before the
 * note adds a bar (one click conveys no tempo). An entry that is not a whole
 * number of clicks (an eighth-note pickup, or a pulse coarser than the pickup)
 * keeps today's count rather than click off the beat, and says so.
 *
 * @returns {{ clicks:number, entry:'downbeat'|'aligned'|'unaligned' }}
 */
export function alignCountIn({ clicks, pulseQuarters, barQuarters, entryQuarters }) {
  if (!(entryQuarters > WHOLE)) return { clicks, entry: 'downbeat' };
  const before = entryQuarters / pulseQuarters;
  const perBar = barQuarters / pulseQuarters;
  if (!(pulseQuarters > 0) || !isWhole(before) || !isWhole(perBar)) return { clicks, entry: 'unaligned' };
  const whole = Math.round(before);
  return { clicks: whole >= 2 ? whole : whole + Math.round(perBar), entry: 'aligned' };
}

const MIN_POLISH_LEAD_MS = 1500;

/**
 * THE POLISH COUNT-IN. A run from the top of a piece that opens on a pickup
 * counts the beats before the pickup, so it lands on its own beat (one-beat
 * pickup in 4/4: 1, 2, 3, play on 4), and still lasts at least 1.5 s, adding
 * whole bars. Any other start keeps `countInPlan`'s count. A plan without a
 * usable click period is returned unchanged rather than counted against.
 *
 * @param {{beats:number, periodMs:number, totalMs:number, subdivision:number}} plan from `countInPlan`
 * @param {{ fromTop:boolean, measures?:Array, firstOnsetQuarter?:number, timeSig?:{beats?:number, beatType?:number} }} p
 */
export function polishCountIn(plan, { fromTop, measures, firstOnsetQuarter, timeSig } = {}) {
  if (!fromTop) return { ...plan, entry: 'downbeat' };
  if (!Number.isFinite(plan?.periodMs) || plan.periodMs <= 0) return { ...plan, entry: 'unaligned' };
  const entryQuarters = entryOffsetQuarters({ measures, firstOnsetQuarter: firstOnsetQuarter ?? 0 });
  const beats = Number(timeSig?.beats) > 0 ? Number(timeSig.beats) : 4;
  const beatType = Number(timeSig?.beatType) > 0 ? Number(timeSig.beatType) : 4;
  const barQuarters = beats * 4 / beatType;
  const aligned = alignCountIn({ clicks: plan.beats, pulseQuarters: plan.subdivision, barQuarters, entryQuarters });
  let clicks = aligned.clicks;
  const perBar = Math.max(1, Math.round(barQuarters / plan.subdivision));
  if (aligned.entry === 'aligned') while (clicks * plan.periodMs < MIN_POLISH_LEAD_MS) clicks += perBar;
  return { ...plan, beats: clicks, totalMs: clicks * plan.periodMs, entry: aligned.entry };
}

/**
 * THE PICKUP COUNT IS COUNTED IN BARS (2026-11-24). Cutting the count to end on the beat before a
 * pickup ("1, 2, 3" and play on the unsaid 4) gave a child no target and too little time, and a hand
 * that enters on the downbeat counted four, so the count changed between steps of one passage. Now:
 *  - the count ends with the LANDING BAR, the bar holding the passage's first note (both hands);
 *  - a READY BAR comes first unless the landing bar alone gives READY_BAR_MS and two audible clicks
 *    after the press (the press is beat one and is not sounded), or the take is a missed-cue restart;
 *  - the count belongs to the passage: a hand that enters later rests where the pickup is;
 *  - `slots` lay the count out beat by beat, the step's entry drawn as a `note` slot in its beat.
 * A passage that opens on a downbeat keeps exactly today's count (at most four clicks, a bar before).
 */
const READY_BAR_MS = 2500;
const MIN_AUDIBLE_CLICKS = 2;

function countSlots({ entryPosition, perBar, restPosition = null }) {
  const slots = [];
  const last = Math.ceil(entryPosition - WHOLE);
  for (let k = 0; k <= last; k += 1) {
    if (k === last && !isWhole(entryPosition)) {
      slots.push({ bar: Math.floor(k / perBar) + 1, beat: (k % perBar) + 1, kind: 'count' });
      slots.push({ bar: Math.floor(k / perBar) + 1, beat: (k % perBar) + 1, kind: 'note', half: true });
      return slots;
    }
    const kind = k === last ? 'note' : restPosition != null && k === restPosition ? 'rest' : 'count';
    slots.push({ bar: Math.floor(k / perBar) + 1, beat: (k % perBar) + 1, kind });
  }
  return slots;
}

/**
 * @param {{ beatsPerMeasure:number, gradedBpm:number, onsetQuarters:number[], measures?:Array,
 *   passageFirstOnsetQuarter?:number, forceReadyBar?:boolean }} p
 * @returns {{ clicks:number, periodMs:number, leadInMs:number, pulseBpm:number,
 *   entry:'downbeat'|'aligned'|'offbeat'|'unaligned', bars:number, readyBar:boolean,
 *   slots:Array<{bar:number, beat:number, kind:'count'|'rest'|'note', half?:boolean}>}|null}
 *   `leadInMs` is the time from the count's start (the press) to the step's first note.
 */
export function exerciseCountInPlan({ beatsPerMeasure, gradedBpm, onsetQuarters, measures, passageFirstOnsetQuarter, forceReadyBar = false }) {
  if (!Number.isFinite(gradedBpm) || gradedBpm <= 0) return null;
  const stepFirst = Number(onsetQuarters?.[0]);
  const passageFirst = Number.isFinite(passageFirstOnsetQuarter) ? passageFirstOnsetQuarter : stepFirst;
  const entryQuarters = entryOffsetQuarters({ measures, firstOnsetQuarter: passageFirst });
  // The hand's own pulse, unless the passage's pickup does not land on it (a LH of whole notes under
  // a one-beat pickup): then quarters, so both hands of the passage hear the same count.
  let pulse = askPulseQuarters(onsetQuarters) ?? 1;
  if (entryQuarters > WHOLE && !isWhole(entryQuarters / pulse) && isWhole(entryQuarters)) pulse = 1;
  const plan = countInPlan({ beats: beatsPerMeasure, bpm: gradedBpm / pulse });
  const pulseQuarters = plan.periodMs * gradedBpm / 60000;
  const bars = Array.isArray(measures) ? measures.slice(1).map((m) => m.durationQuarters).filter((d) => d > 0) : [];
  const barQuarters = bars.length ? Math.max(...bars) : (Number.isFinite(beatsPerMeasure) ? beatsPerMeasure : 4);
  const perBarExact = barQuarters / pulseQuarters;
  const perBar = Math.max(1, Math.round(perBarExact));
  // How far (in clicks) the step's own first note sits after the passage's.
  const lag = Number.isFinite(stepFirst) && Number.isFinite(passageFirst) ? Math.max(0, (stepFirst - passageFirst) / pulseQuarters) : 0;
  const result = (clicks, entryPosition, entry, readyBar, restPosition = null) => ({
    clicks,
    periodMs: plan.periodMs,
    leadInMs: entryPosition * plan.periodMs,
    pulseBpm: 60000 / plan.periodMs,
    entry,
    bars: Math.max(1, Math.ceil((entryPosition + WHOLE) / perBar)),
    readyBar,
    slots: countSlots({ entryPosition, perBar, restPosition }),
  });
  if (!(entryQuarters > WHOLE)) {
    const clicks = Math.min(4, plan.beats);
    return result(clicks + lag, clicks + lag, 'downbeat', false, lag > WHOLE ? clicks : null);
  }
  const before = entryQuarters / pulseQuarters;
  if (!(pulseQuarters > 0) || !isWhole(perBarExact)) {
    const clicks = Math.min(4, plan.beats);
    return result(clicks, clicks, 'unaligned', false);
  }
  const whole = isWhole(before);
  const audibleInLandingBar = Math.ceil(before - WHOLE) - 1;
  const readyBar = forceReadyBar || before * plan.periodMs < READY_BAR_MS - WHOLE || audibleInLandingBar < MIN_AUDIBLE_CLICKS;
  const passagePosition = (readyBar ? perBar : 0) + before;
  const entryPosition = passagePosition + lag;
  const clicks = Math.ceil(entryPosition - WHOLE);
  return result(clicks, entryPosition, whole ? 'aligned' : 'offbeat', readyBar, lag > WHOLE && isWhole(passagePosition) ? passagePosition : null);
}

/** Remaining pulses and a draining bar, projected from the run's elapsed time. */
export function countdownPresentation({ clicks, elapsedMs, leadInMs }) {
  if (!(clicks > 0) || !(leadInMs > 0)) return { remaining: 0, progress: 0, play: true };
  const elapsed = Math.min(leadInMs, Math.max(0, elapsedMs));
  const play = elapsed >= leadInMs;
  return {
    remaining: play ? 0 : clicks - Math.floor(elapsed / (leadInMs / clicks)),
    progress: 1 - elapsed / leadInMs,
    play,
  };
}

/**
 * THE LEARN PASSAGE COUNT: up, with the clicks, and the cue BEFORE the beat.
 *
 * The countdown above counts 4-3-2-1 while the music counts 1-2-3-4, and its
 * PLAY lands exactly when the first note is due — a beginner who reads PLAY and
 * then plays is a beat late every time (2026-11-20: a steady take one beat late
 * scored 0/4). On Learn passages the numerals follow the clicks, and the last
 * click carries "next click: play" so the instruction arrives before the beat.
 *
 * @returns {{count:number, clicks:number, last:boolean}|null} count 0 = armed or
 *   pre-roll (no click has sounded yet); 1..clicks = the click now sounding;
 *   null once the first beat arrives (nothing to show, no PLAY).
 */
export function countUpPresentation({ clicks, elapsedMs, leadInMs, periodMs = null, slots = null }) {
  if (!(clicks > 0) || !(leadInMs > 0)) return null;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return { count: 0, clicks, last: false };
  if (elapsedMs >= leadInMs) return null;
  if (Array.isArray(slots) && slots.length && periodMs > 0) {
    // Slot-shaped (bar) counts: the slot under the click; the cue on the click before the note.
    const index = Math.min(clicks - 1, Math.floor(elapsedMs / periodMs));
    const next = slots[index + 1];
    return { count: index + 1, clicks, last: next?.kind === 'note' && !slots[index + 2] && !(next.half && slots[index]?.kind === 'count' && index + 1 < clicks), slot: slots[index] };
  }
  const count = Math.min(clicks, Math.floor(elapsedMs / (leadInMs / clicks)) + 1);
  return { count, clicks, last: count === clicks };
}

/**
 * HOW FAST THE ASK ACTUALLY IS, relative to the clicks the child is about to
 * hear — because "play at that speed" is not always true and, when it is not,
 * it is the only instruction they get.
 *
 * A cued run counts in on the QUARTER pulse (`countInPlan` coarsens above
 * ~140bpm and never subdivides below it, which is right for a piece). A scale
 * out of the bank is written in EIGHTHS. So the gate's tier-3 rung clicked four
 * times at 60bpm, said "play at that speed", and then graded eight notes 500ms
 * apart. On 2026-09-13 a nine-year-old played C D E F G, in order, evenly, at
 * the tempo he had just been given — and every single note was scored `wrong`
 * with a `miss` beside it, three attempts running, because the grader's grid
 * was twice the speed of the grid he was counted in on. He did nothing wrong
 * and the screen had told him nothing that was true.
 *
 * @param {number[]} onsetQuarters where the ask's events fall, in quarter notes
 * @param {number} clickQuarters quarter notes between count-in clicks
 * @returns {{notesPerClick:number, even:boolean}|null} null when the ask has no
 *   steady pulse to describe (one note, or an uneven rhythm — where any single
 *   sentence about "the speed" would be a new lie rather than a fixed one).
 */
export function askPace(onsetQuarters = [], clickQuarters = 1) {
  if (!Array.isArray(onsetQuarters) || onsetQuarters.length < 2) return null;
  if (!(clickQuarters > 0)) return null;
  const steps = [];
  for (let i = 1; i < onsetQuarters.length; i += 1) {
    const step = Number(onsetQuarters[i]) - Number(onsetQuarters[i - 1]);
    if (!Number.isFinite(step) || step <= 0) return null;
    steps.push(step);
  }
  // An ask has one speed to describe only if it HAS one speed. A dotted rhythm
  // is a real ask and a true sentence about it is longer than this surface has
  // room for; it keeps the generic line.
  const first = steps[0];
  const even = steps.every((step) => Math.abs(step - first) < 1e-6);
  if (!even) return { notesPerClick: clickQuarters / first, even: false };
  return { notesPerClick: clickQuarters / first, even: true };
}

/** The count-in promise, in words a child can act on. */
export function countInSentence(clicks, pace) {
  const lead = `Press any key to start. You'll hear ${clicks} click${clicks === 1 ? '' : 's'}`;
  if (!pace?.even) return `${lead}, then play at that speed.`;
  const { notesPerClick } = pace;
  if (Math.abs(notesPerClick - 1) < 1e-6) return `${lead}, then play one note on every click.`;
  if (Math.abs(notesPerClick - 2) < 1e-6) return `${lead}, then play two notes on every click.`;
  if (Math.abs(notesPerClick - 3) < 1e-6) return `${lead}, then play three notes on every click.`;
  if (Math.abs(notesPerClick - 4) < 1e-6) return `${lead}, then play four notes on every click.`;
  if (Math.abs(notesPerClick - 0.5) < 1e-6) return `${lead}, then play one note every two clicks.`;
  return `${lead}, then play at that speed.`;
}

export default { countInPlan, exerciseCountInPlan, entryOffsetQuarters, alignCountIn, polishCountIn, countdownPresentation, countUpPresentation, askPulseQuarters, askPace, countInSentence };
