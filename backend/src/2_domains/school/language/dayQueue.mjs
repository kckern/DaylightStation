import { chainFor } from './ladder.mjs';

/**
 * Day-queue construction (design §3). Pure: no I/O, no Date.
 *
 * The queue is DERIVED from the attempt log on every read — it is never stored.
 * That is the deliberate fix for the 2017 failure that killed the original app:
 * the queue lived in a `user_queue` table, a server migration lost the writes,
 * and parent-two's progress silently stopped advancing ("it's still on the
 * dictation set I did twice"). A derived queue cannot desynchronise from its
 * own evidence, because it has none of its own to lose.
 *
 * A day's work is `dailyLimit` steps at EVERY rung:
 *   1. at the first rung, up to `dailyLimit` brand-new sentences;
 *   2. at each rung above it, sentences that cleared the rung below on an
 *      EARLIER day and have not yet cleared this one — oldest first, at most
 *      `dailyLimit`; any beyond that stay owed for a later day; then
 *   3. PRACTICE, only while (2) cannot fill that rung — see below.
 *
 * The "earlier day" test is what enforces one-rung-per-day. Without it a
 * sentence drilled at `repetition` this morning would immediately reappear as
 * `dictation` this afternoon, collapsing the whole ladder into a single
 * sitting and destroying the spacing that is the entire point.
 *
 * ## The cold start
 *
 * On day one nothing has cleared anything, so (2) is empty and the day is a
 * quarter of its intended size; it only reaches full volume on day four. The
 * first sitting being the emptiest is the wrong way round for a habit that has
 * to survive its own beginning.
 *
 * So each rung graduates cannot fill is topped up with TODAY'S OWN new set as
 * practice (one sentence a day, four rungs):
 *
 *              CREDITED                   PRACTICE
 *   Day 1  s1@r1                      s1@r2 r3 r4
 *   Day 2  s2@r1 s1@r2                s2@r3 r4
 *   Day 3  s3@r1 s2@r2 s1@r3          s3@r4
 *   Day 4  s4@r1 s3@r2 s2@r3 s1@r4        --      <- steady
 *
 * It turns itself off: there is no warm-up flag, no day-number test and no
 * window to configure, because once credited work fills the day there is
 * nothing left to extend. A learner who skips a week and drains the pipeline
 * gets it back automatically, which is right rather than a bug.
 *
 * PRACTICE NEVER ADVANCES A SENTENCE. Its events are written with
 * `practice: true` and `clearedIndex` ignores them when deciding what cleared,
 * so a sentence still climbs exactly one rung per day for credit and the log
 * means the same thing on day one as on day four hundred. They ARE written,
 * though: this queue is derived from the log and re-fetched after every save,
 * so an attempt that recorded nothing would leave the queue unchanged and pin
 * the learner on one item forever.
 */

/**
 * Study days are 1-based, so 0 is "cleared before any day this system counted".
 *
 * The 2016 database was recovered, so imported evidence normally carries its
 * real day. This remains the floor for any event that does not: an import from
 * a source without day numbers records none rather than inventing one, because
 * a fabricated day is fiction in an append-only evidence log. Undated evidence
 * is still evidence — it predates day 1 by definition, and 0 orders correctly
 * against every real day.
 */
const UNDATED = 0;

/**
 * Index the log by rung → Map(seq → earliest day it was cleared on), plus the
 * set of every sequence that has been touched at all.
 *
 * Earliest wins: a rung re-done later (a retry, a reassignment) must not push
 * the sentence's graduation date forward and silently stall the ladder.
 */
function clearedIndex(log) {
  const byRung = new Map();
  const everSeen = new Set();
  const practiced = new Set();
  for (const event of log) {
    if (!event || event.seq == null || !event.rung) continue;
    const seq = Number(event.seq);
    if (!Number.isFinite(seq)) continue;
    const rawDay = Number(event.day);
    const day = Number.isFinite(rawDay) ? rawDay : UNDATED;
    // A practice pass is still evidence the sentence was touched — it must
    // never be re-admitted as brand-new material — but it clears nothing, so
    // it stays out of the rung index that drives graduation.
    everSeen.add(seq);
    if (event.practice === true) {
      practiced.add(`${event.rung}:${seq}:${day}`);
      continue;
    }
    if (!byRung.has(event.rung)) byRung.set(event.rung, new Map());
    const seqs = byRung.get(event.rung);
    const prior = seqs.get(seq);
    if (prior === undefined || day < prior) seqs.set(seq, day);
  }
  return { byRung, everSeen, practiced };
}

/**
 * Build the queue for `day`.
 *
 * Entries already satisfied TODAY stay in the queue marked `done: true` rather
 * than being dropped. The UI needs the denominator — a progress bar that
 * shrinks its own total as you work reads as making no progress at all, and
 * rollover needs to distinguish "nothing left to do" from "nothing to do".
 *
 * @param {object}   args
 * @param {Array}    args.log          all attempt events for this user, any day
 * @param {number}   args.day          the study day being built
 * @param {number}   args.dailyLimit   new sentences admitted per day
 * @param {number}   args.corpusSize   highest sequence number available
 * @param {number[]|null} [args.admission] ordered candidate sequence numbers
 *        for new material; omitted/null means 1..corpusSize. A malformed value
 *        is an empty scope, never an unrestricted corpus.
 * @param {string[]} [args.rungChain] enrollment-owned credit chain; device
 *        capabilities still remove rungs it cannot serve
 * @param {object}   [args.capabilities] {microphone, textInput[]} — filters the ladder
 * @param {{source: string, target: string}} args.languages - the corpus role binding
 * @param {Set<number>} [args.playable] - sequences that have audio; omit for "all".
 *        A rung's prompt is audio, so a sentence without it cannot be drilled —
 *        but it may still appear in the log as genuine past study, so it is
 *        excluded from the QUEUE without being forgotten as HISTORY.
 * @returns {Array<{seq: number, rung: string, done: boolean}>}
 */
export function buildDayQueue({
  log = [], day, dailyLimit, corpusSize, capabilities = {}, languages, playable = null,
  admission = null,
  rungChain = null,
}) {
  const canDrill = (seq) => playable === null || playable.has(seq);
  const { byRung: cleared, everSeen, practiced } = clearedIndex(log);
  const availableChain = chainFor(capabilities, languages);
  const chain = Array.isArray(rungChain)
    ? rungChain.filter((rung) => availableChain.includes(rung))
    : availableChain;
  if (chain.length === 0) return [];

  const entryRung = chain[0];
  const entryCleared = cleared.get(entryRung) ?? new Map();
  const queue = [];

  // --- 1. New material -----------------------------------------------------
  // Sentences that entered the ladder TODAY are already part of today's work,
  // so they occupy their slots against the limit; the remainder is filled with
  // sentences never seen at all.
  const enteredToday = [];
  for (const [seq, clearedOn] of entryCleared) {
    if (clearedOn === day) enteredToday.push(seq);
  }
  enteredToday.sort((a, b) => a - b);
  for (const seq of enteredToday) queue.push({ seq, rung: entryRung, done: true });

  // Scan in sequence order and take the first UNTOUCHED sentences. Scanning
  // (rather than the original's `max(seq) + 1`) means a gap left by a skipped
  // or reassigned sentence gets picked up later instead of being stranded
  // behind the high-water mark forever.
  //
  // Untouched means no event at ANY rung, not merely none at the entry rung.
  // Imported 2016 evidence is a `recording` with no `repetition` behind it —
  // that sentence climbed three rungs years ago, and admitting it as new
  // material would both duplicate it (it is already due at the next rung) and
  // throw away the progress the import exists to restore.
  let admitted = enteredToday.length;
  const candidates = admission === null || admission === undefined
    ? Array.from({ length: corpusSize }, (_, i) => i + 1)
    : (Array.isArray(admission) ? admission : []);
  const admittedSeqs = new Set();
  for (const rawSeq of candidates) {
    if (typeof rawSeq !== 'number' && typeof rawSeq !== 'string') continue;
    const seq = Number(rawSeq);
    if (!Number.isInteger(seq) || seq < 1 || seq > corpusSize) continue;
    if (admitted >= dailyLimit) break;
    if (admittedSeqs.has(seq)) continue;
    if (everSeen.has(seq)) continue;
    if (!canDrill(seq)) continue;
    queue.push({ seq, rung: entryRung, done: false });
    admittedSeqs.add(seq);
    admitted += 1;
  }

  // --- 2 + 3. Every other rung: graduates, then the fill --------------------
  // EVERY RUNG HOLDS THE SAME DAY: `dailyLimit` steps at each, the number the
  // entry rung admits — which is what the enrollment's lessonSize already
  // means. The fill used to top up the day's TOTAL instead, walking rungs in
  // order, and a pipeline that did not match the limit came out lopsided: a
  // learner whose first day ran at five a day and whose enrollment now says
  // three got 3 repetitions, 8 dictations, 1 recording and no interpretation
  // (2026-09-12). Now each rung is filled on its own, so the shape is the same
  // on every rung whatever the log holds.
  //
  // A rung takes its graduates oldest first. Any beyond the limit are not
  // dropped — they stay owed, graduating on a later day — so a pace change
  // delays a sentence rather than losing it. One finished today stays on the
  // rung, so finishing a step never pulls a new one in behind it.
  const todaysSet = [...enteredToday, ...admittedSeqs].sort((a, b) => a - b);
  const oldestFirst = (a, b) => a.clearedOn - b.clearedOn || a.seq - b.seq;
  for (let i = 1; i < chain.length; i += 1) {
    const to = chain[i];
    const fromCleared = cleared.get(chain[i - 1]) ?? new Map();
    const toCleared = cleared.get(to) ?? new Map();
    const finished = [];
    const owed = [];
    for (const [seq, clearedOn] of fromCleared) {
      if (clearedOn >= day) continue;            // cleared today — not yet due
      if (!canDrill(seq)) continue;              // no audio: history, not work
      const graduatedOn = toCleared.get(seq);
      if (graduatedOn === undefined) owed.push({ seq, clearedOn });
      else if (graduatedOn === day) finished.push({ seq, clearedOn });
      // graduatedOn < day → already climbed past this rung; not today's work
    }
    finished.sort(oldestFirst);
    owed.sort(oldestFirst);

    const rung = [
      ...finished.map(({ seq }) => ({ seq, rung: to, done: true })),
      ...owed.slice(0, Math.max(0, dailyLimit - finished.length))
        .map(({ seq }) => ({ seq, rung: to, done: false })),
    ];

    // Short of the limit — the cold start, or a pipeline drained by a break —
    // today's own new set climbs this rung as practice. It turns itself off
    // once graduates fill the rung, with no flag or day-number test.
    const held = new Set(rung.map((entry) => entry.seq));
    for (const seq of todaysSet) {
      if (rung.length >= dailyLimit) break;
      if (held.has(seq)) continue;
      held.add(seq);
      rung.push({ seq, rung: to, done: practiced.has(`${to}:${seq}:${day}`), practice: true });
    }
    queue.push(...rung);
  }

  return queue;
}

/**
 * Fold a queue into per-rung and overall counts for the progress display.
 *
 * @param {Array<{rung: string, done: boolean}>} queue
 * @returns {{total: number, done: number, byRung: Object<string,{total:number,done:number}>}}
 */
export function summarizeQueue(queue = []) {
  const byRung = {};
  let total = 0;
  let done = 0;
  for (const entry of queue) {
    if (!byRung[entry.rung]) byRung[entry.rung] = { total: 0, done: 0 };
    byRung[entry.rung].total += 1;
    total += 1;
    if (entry.done) {
      byRung[entry.rung].done += 1;
      done += 1;
    }
  }
  return { total, done, byRung };
}
