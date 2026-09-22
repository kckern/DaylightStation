/**
 * The thermal slip a scan prints when it does NOT end in a graded receipt.
 *
 * On 2026-09-15 a learner fed a card carrying three sheets. Two graded and
 * each printed a receipt; the third came back five of six with one row blank,
 * and for that sheet nothing came out of the printer — the only messenger was
 * a short-lived panel toast, and the next feed's toast ("No new result
 * recorded") read as the opposite of the first ("Not finished yet"). He spent
 * the morning "done" with a sheet the grader had never accepted.
 *
 * The rule this module encodes: EVERY feed puts paper in the child's hand.
 * A graded sheet already has its receipt (`resultDocument`), so `scan-graded`
 * yields no slip here; every other outcome the scan consumer announces to
 * the panel yields one, saying the same thing the panel says, on paper that
 * does not disappear. The copy names the sheet by its title, the rows as they
 * are printed on the sheet (questions are numbered by card row), and one
 * action sentence.
 *
 * Pure: an announcement in, a `school.receipt` document (or null) out.
 */
import { noticeDocument } from './receipts.mjs';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** "Row 33" / "Rows 31, 32 and 33" — the panel's own phrasing, kept identical. */
export function rowList(rows) {
  const clean = (Array.isArray(rows) ? rows : []).filter(isNumber).sort((a, b) => a - b);
  if (!clean.length) return null;
  if (clean.length === 1) return `Row ${clean[0]}`;
  return `Rows ${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

const upper = (value) => String(value ?? '').trim().toUpperCase();

/** Headline for a sheet-specific slip: "SOUTH DAKOTA — NOT FINISHED YET", or just the verdict. */
const headlineFor = (title, verdict) => (title ? `${upper(title)} — ${verdict}` : verdict);

/** The sentences for one unfinished sheet: what is answered, what is missing, what to do. */
function unfinishedLines({ answered, total, blankRows, ambiguousRows }) {
  const lines = [];
  if (isNumber(answered) && isNumber(total)) lines.push(`${answered} of ${total} answered.`);
  const blanks = rowList(blankRows);
  const doubles = rowList(ambiguousRows);
  if (blanks) lines.push(`${blanks} ${blanks.startsWith('Rows') ? 'are' : 'is'} still empty.`);
  if (doubles) lines.push(`${doubles} ${doubles.startsWith('Rows') ? 'have' : 'has'} more than one answer marked — erase the extra.`);
  return lines;
}

const FEED_AGAIN = 'Then feed the card again.';

/**
 * @param {object} announcement - exactly what the scan consumer broadcasts to
 *   the panel: `{kind, ...payload}` (the `event` name travels as `kind` on
 *   the wire; `event` is accepted too).
 * @returns {object|null} a `school.receipt` document, or null when no slip is
 *   owed (`scan-graded`, whose receipt is printed elsewhere; an unknown kind).
 */
export function scanNoticeDocument(announcement = {}) {
  const kind = announcement.kind ?? announcement.event ?? null;
  const id = `scan-${kind ?? 'unknown'}-${announcement.testId ?? 'card'}`;
  switch (kind) {
    case 'scan-graded':
      return null;
    case 'scan-rows-incomplete': {
      const lines = unfinishedLines(announcement);
      lines.push(`Fill it in on your answer card. ${FEED_AGAIN}`);
      return noticeDocument({ id, headline: headlineFor(announcement.title, 'NOT FINISHED YET'), lines });
    }
    case 'scan-not-recorded': {
      const unfinished = (Array.isArray(announcement.unfinished) ? announcement.unfinished : [])
        .filter((sheet) => sheet && (rowList(sheet.blankRows) || rowList(sheet.ambiguousRows)));
      if (unfinished.length) {
        // The duplicate feed of a still-unfinished card: say the SAME thing the
        // first feed said, never "nothing new" — that sentence is what a child
        // repeats as "it says I'm done".
        const lines = [];
        for (const sheet of unfinished) {
          if (sheet.title) lines.push(`**${sheet.title}**`);
          lines.push(...unfinishedLines(sheet));
        }
        lines.push(`Fill in the empty rows on your answer card. ${FEED_AGAIN}`);
        return noticeDocument({ id, headline: 'STILL NOT FINISHED', lines });
      }
      return noticeDocument({
        id,
        headline: 'NOTHING NEW TO MARK',
        lines: [
          'I read this card, but everything on it was already marked.',
          'If a sheet is missing its result, ask a grown-up.',
        ],
      });
    }
    case 'scan-rows-unmarked': {
      const ranges = Array.isArray(announcement.rowRanges) && announcement.rowRanges.length
        ? announcement.rowRanges : (announcement.rowRange ? [announcement.rowRange] : []);
      const spans = ranges
        .filter((range) => isNumber(range?.start) && isNumber(range?.end))
        .map((range) => (range.start === range.end ? `row ${range.start}` : `rows ${range.start}–${range.end}`));
      const where = spans.length ? `Your new questions are ${spans.join(' and ')}. ` : '';
      return noticeDocument({
        id, headline: 'NOTHING FILLED IN YET', lines: [`${where}Fill them in, ${FEED_AGAIN.charAt(0).toLowerCase()}${FEED_AGAIN.slice(1)}`],
      });
    }
    case 'scan-review': {
      // Key-alignment is its own reason, not a double-marked bubble — the
      // stock "two answers filled in" copy would lie about why the sheet is
      // held. Only reached for the sole-reason case: Task 2's row-shift
      // check refuses to fire on a sheet with any blank/ambiguous row, so a
      // sheet that also carries `ambiguous`/`free_response` alongside it
      // falls through to the generic copy below, which is at least never
      // wrong about the fact that a grown-up is needed.
      const reasons = Array.isArray(announcement.reasons) ? announcement.reasons : [];
      if (reasons.length === 1 && reasons[0] === 'key-alignment-suspected') {
        return noticeDocument({
          id,
          headline: headlineFor(announcement.title, 'NEEDS A GROWN-UP'),
          lines: ['A grown-up is double-checking one of your answers.', 'Ask them to take a look.'],
        });
      }
      const count = isNumber(announcement.pendingReview) ? announcement.pendingReview : null;
      const what = count === null ? 'Some questions' : count === 1 ? '1 question' : `${count} questions`;
      return noticeDocument({
        id,
        headline: headlineFor(announcement.title, 'NEEDS A GROWN-UP'),
        lines: [`${what} had two answers filled in.`, 'Ask a grown-up to check it.'],
      });
    }
    case 'scan-unresolved':
      return noticeDocument({
        id, headline: "COULDN'T READ THAT CARD",
        lines: ["The student number didn't come through.", 'Feed the card again, slowly.'],
      });
    case 'scan-refused':
      return noticeDocument({
        id, headline: headlineFor(announcement.title, "THAT SHEET DOESN'T MATCH"),
        lines: ["This paper doesn't line up with what's on file.", 'Ask a grown-up.'],
      });
    case 'scan-stale-sheet':
      return noticeDocument({
        id, headline: 'THAT SHEET IS OUT OF DATE',
        lines: ['Scan your agenda card to print a fresh one, then try again.'],
      });
    case 'scan-answer-sheet-held':
      return noticeDocument({
        id, headline: 'TWO ANSWER SHEETS ARE ACTIVE',
        lines: [announcement.message || 'Ask a grown-up to check this scan.'],
      });
    default:
      return null;
  }
}

export default scanNoticeDocument;
