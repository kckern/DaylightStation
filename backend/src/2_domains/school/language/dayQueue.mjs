import { chainFor, graduationEdges } from './ladder.mjs';

/**
 * Day-queue construction (design §3). Pure: no I/O, no Date.
 *
 * The queue is DERIVED from the attempt log on every read — it is never stored.
 * That is the deliberate fix for the 2017 failure that killed the original app:
 * the queue lived in a `user_queue` table, a server migration lost the writes,
 * and Elizabeth's progress silently stopped advancing ("it's still on the
 * dictation set I did twice"). A derived queue cannot desynchronise from its
 * own evidence, because it has none of its own to lose.
 *
 * A day's work is:
 *   1. up to `dailyLimit` brand-new sentences, entering at the first rung; plus
 *   2. every sentence that cleared rung k on an EARLIER day and has not yet
 *      cleared rung k+1.
 *
 * The "earlier day" test is what enforces one-rung-per-day. Without it a
 * sentence drilled at `repetition` this morning would immediately reappear as
 * `dictation` this afternoon, collapsing the whole ladder into a single
 * sitting and destroying the spacing that is the entire point.
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
  for (const event of log) {
    if (!event || event.seq == null || !event.rung) continue;
    const seq = Number(event.seq);
    if (!Number.isFinite(seq)) continue;
    const rawDay = Number(event.day);
    const day = Number.isFinite(rawDay) ? rawDay : UNDATED;
    everSeen.add(seq);
    if (!byRung.has(event.rung)) byRung.set(event.rung, new Map());
    const seqs = byRung.get(event.rung);
    const prior = seqs.get(seq);
    if (prior === undefined || day < prior) seqs.set(seq, day);
  }
  return { byRung, everSeen };
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
}) {
  const canDrill = (seq) => playable === null || playable.has(seq);
  const { byRung: cleared, everSeen } = clearedIndex(log);
  const chain = chainFor(capabilities, languages);
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
  for (let seq = 1; seq <= corpusSize && admitted < dailyLimit; seq += 1) {
    if (everSeen.has(seq)) continue;
    if (!canDrill(seq)) continue;
    queue.push({ seq, rung: entryRung, done: false });
    admitted += 1;
  }

  // --- 2. Graduates --------------------------------------------------------
  for (const { from, to } of graduationEdges(capabilities, languages)) {
    const fromCleared = cleared.get(from) ?? new Map();
    const toCleared = cleared.get(to) ?? new Map();
    const due = [];
    for (const [seq, clearedOn] of fromCleared) {
      if (clearedOn >= day) continue;            // cleared today — not yet due
      if (!canDrill(seq)) continue;              // no audio: history, not work
      const graduatedOn = toCleared.get(seq);
      if (graduatedOn === undefined) due.push({ seq, done: false });
      else if (graduatedOn === day) due.push({ seq, done: true });
      // graduatedOn < day → already climbed past this rung; not today's work
    }
    due.sort((a, b) => a.seq - b.seq);
    for (const item of due) queue.push({ seq: item.seq, rung: to, done: item.done });
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
