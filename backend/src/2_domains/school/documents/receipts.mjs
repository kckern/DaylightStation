/**
 * The three receipts the physical console prints (spec §6.2, §9). Pure: no I/O,
 * no clock, no renderer — every builder returns a DOCUMENT in the same typed-block
 * form as a curriculum worksheet (`./documentValidation.mjs`), and the receipt
 * renderer turns it into paper.
 *
 * They live in the domain because their content is policy, not presentation:
 * WHICH actions a child is offered, and the rule that a scan never ends without
 * a next move. Fonts, cut points and column widths are the renderer's business.
 *
 * The governing rule, from §6.2: **a scan never succeeds silently**. Every path
 * through the resolver — success, expiry, an unknown ticket, a printer that
 * refused the job — ends at one of these three builders, which is why
 * `noticeDocument` exists at all. An explanation slip is a feature.
 *
 * A `scan_action` block's `action` field carries the OPAQUE TOKEN VALUE
 * (`sch:…`); the renderer encodes it as the barcode/QR payload and prints
 * `label` beside it. Nothing else about the action is on the paper — that is the
 * whole point of the token model.
 */

import { SCHOOL_ACCESS_CODE_DIGITS } from '../sessions/accessCode.mjs';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Document ids must match `^[a-z0-9][a-z0-9-]*$`, and a learner id or unit id is
 * not obliged to. Slugging keeps a receipt's identity derived from its subject
 * (so the same agenda regenerates under the same id) without letting an id shape
 * from somewhere else fail document validation.
 */
export function slugify(value, fallback = 'x') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z0-9]/.test(slug) ? slug : fallback;
}

const text = (md) => ({ type: 'rich_text', md });

/**
 * Shared agenda/result lesson card: one QR, one hierarchy, no repeated token
 * text — and, as of Slice H, its own panel-code pairing baked in, so a
 * caller cannot push the QR and forget the second push (Learner-Three's receipt,
 * 2026-08-22: a `scan_action` with nothing typeable beneath it).
 *
 * Returns an ARRAY (the QR block, then whatever `codeAbsenceBlocks` decides
 * belongs beside it) so the only legal way to put one of these on paper is
 * `blocks.push(...lessonAction(...))` — there is no second call for a caller
 * to remember, and therefore no way to separate the two.
 */
function lessonAction({
  token, eyebrow, title, description = null, icon = null, meta = null, taxonomy = null,
  rail = null, progress = null, unit = null, accessCode,
} = {}) {
  const block = {
    type: 'scan_action', action: token, label: title,
    presentation: 'lesson', hideCode: true,
    // Omitted when empty, exactly like every other optional field below.
    // Spreading it unconditionally put a literal `eyebrow: null` on the block,
    // and the validator's guard is `!== undefined` — so "no eyebrow" read as
    // "present but not a string" and made EVERY lesson card on EVERY agenda
    // fail validateDocument(). Invisible for months because the three suites
    // that caught it are Jest targets full of vitest imports and never loaded.
    ...(isNonEmptyString(eyebrow) ? { eyebrow } : {}),
    ...(isNonEmptyString(rail) ? { rail } : {}),
    ...(isNonEmptyString(unit) ? { unit } : {}),
    ...(Array.isArray(progress) && progress.length ? { progress } : {}),
    ...(isNonEmptyString(description) ? { description } : {}),
    ...(isNonEmptyString(icon) ? { icon } : {}),
    ...(isNonEmptyString(meta) ? { meta } : {}),
    ...(taxonomy ? { taxonomy } : {}),
    ...panelCodeField(accessCode),
  };
  return [block, ...codeAbsenceBlocks(accessCode)];
}

/** Derived from the code itself, never restated — see `accessCode.mjs`. */
const PANEL_CODE = new RegExp(`^\\d{${SCHOOL_ACCESS_CODE_DIGITS}}$`);

/**
 * The panel access code that goes with a lesson card (self-service), as a
 * FIELD ON THE BLOCK.
 *
 * UNDER THE QR, AND NOWHERE ELSE. This used to be two loose `rich_text`
 * blocks pushed after the card — "PANEL CODE 928521" and "Type it on the
 * school screen." — which put a bare number adrift BELOW the box instead of
 * beneath the QR it aliases. On a printed card that reads as a stray number
 * with no referent: a child cannot tell which offer it belongs to, and on a
 * multi-offer agenda they genuinely cannot. Carrying it on the block instead
 * lets the renderer draw it in the one place it means something — directly
 * under its own QR, inside the card (`DocumentReceiptRenderer`'s
 * `panelCode`/`codeLines`).
 *
 * One agenda can carry TWO six-digit codes for two different machines: the
 * SchoolCalc study code (`001 234`, "Enter on calculator.") and this one.
 * They stay distinguishable by POSITION now rather than by a label — this
 * one sits under a QR, which is the thing that identifies it.
 *
 * A malformed code prints nothing at all. Digits a child cannot type are worse
 * than no code (they ask a grown-up), and a receipt builder must not throw the
 * agenda away over a decoration.
 */
function panelCodeField(code) {
  if (typeof code !== 'string' || !PANEL_CODE.test(code)) return {};
  return { panelCode: code };
}

/**
 * The one thing that still needs its own block: saying a code is ABSENT.
 *
 * Called from exactly two places — `lessonAction` and `plainScanAction`,
 * below. A present code is now a field on the block (`panelCodeField`), drawn
 * under its QR; only the "there is no typable way in" case needs words, and
 * words need a block.
 *
 * `accessCode` is deliberately TRI-STATE:
 *   - `undefined` (the argument omitted): this action makes no claim about
 *     a code at all. Nothing is printed. This is every receipt built before
 *     self-service existed, byte-identical.
 *   - a six-digit string: the alias, carried on the block and drawn under
 *     its QR. Nothing is added beside the card.
 *   - `null` (or any non-empty value `panelCodeField` rejects as malformed):
 *     a code was EXPECTED — self-service is in play for this token, or the
 *     caller checked and none could be minted (a token class that can never
 *     carry one, a collision, self-service off) — and none exists. Printed
 *     as an explicit line rather than a silent gap, because a missing code
 *     has to be visible to be actionable.
 */
function codeAbsenceBlocks(accessCode) {
  if (accessCode === undefined) return [];
  if (Object.keys(panelCodeField(accessCode)).length) return [];
  return [text('Scanning is the only way in.')];
}

/**
 * The plain-QR counterpart to `lessonAction` — no lesson-card chrome
 * (eyebrow/description/meta), just the bare `scan_action` block a
 * non-lesson offer prints today, but wired through the SAME panel-code
 * contract.
 *
 * This closes the second half of the gap `lessonAction` closed for the
 * lesson presentation: `resultDocument`'s non-lesson branch and
 * `noticeDocument` used to push `{type:'scan_action', ...}` directly, with
 * no pairing call at all — structurally the same defect, one branch over
 * (a real receipt, 2026-08-23: a QR under "Scan to print the next
 * worksheet" with nothing typeable beneath it, on the branch Slice H didn't
 * touch). Every caller in this module that wants a bare scannable token now
 * goes through this function instead of constructing the block itself, so
 * the panel-code contract has exactly two callers and a third unpaired push
 * would have to bypass both of them on purpose.
 *
 * `accessCode` is the same tri-state as `lessonAction`'s: omit it and the
 * action makes no claim (byte-identical to every receipt printed before
 * this existed) — no caller passes one today, but the contract is generic
 * so one can start to without a third code path appearing.
 */
function plainScanAction(token, label, accessCode) {
  return [
    { type: 'scan_action', action: token, label, ...panelCodeField(accessCode) },
    ...codeAbsenceBlocks(accessCode),
  ];
}

/**
 * The printed time, as a person says it: `Mon 27 Jul, 9:05 am`.
 *
 * A raw ISO timestamp on a child's paper is machine notation, and the agenda
 * printed one. The pieces come from `Intl` (the only way to place an instant in
 * a named zone without a tz database of our own) but are ASSEMBLED here, in a
 * fixed order, from `hourCycle: 'h23'` — so the wording does not drift with the
 * host's ICU build the way a locale-formatted string would.
 *
 * Returns null rather than "Invalid Date" for anything unparseable or a zone
 * this platform does not know: an unreadable time is worth omitting, and it is
 * certainly not worth losing the rest of the agenda over.
 *
 * @param {string} iso        ISO-8601 instant (injected — nothing here reads a clock)
 * @param {string} [timeZone] IANA zone the household reads its paper in
 * @returns {string|null}
 */
export function formatPrintedAt(iso, timeZone = 'UTC') {
  if (!isNonEmptyString(iso)) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms));
  } catch {
    return null;
  }
  const part = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const hour24 = Number(part('hour'));
  if (!Number.isInteger(hour24)) return null;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = hour24 < 12 ? 'am' : 'pm';
  return `${part('weekday')} ${part('day')} ${part('month')}, ${hour12}:${part('minute')} ${period}`;
}

/**
 * Receipts are single-column, receipt-target, and carry no randomness at all, so
 * seed 0 is not a placeholder — regeneration is byte-identical by construction.
 *
 * `title`, when given, is the STANDARD HEADER: renderers print it as an
 * inverted banner (black band, light text) across the top of the tape. Agendas
 * and result slips use one; notices open with their own `# …` headline block.
 */
const receipt = (id, blocks, { title = null } = {}) => ({
  id, seed: 0, variant: 0, target: ['receipt'], blocks,
  ...(isNonEmptyString(title) ? { title } : {}),
});

/**
 * Resolved-review-item notes as printable lines: `Note: <note> (<ref>)`,
 * newest first, capped, each line truncated so a long grown-up sentence
 * cannot blow out the receipt's width (spec R7). Shared by CloseSessionOutcome
 * (this session's own notes) and BuildAgenda (a learner's recent notes) so
 * both receipts format a note identically.
 *
 * `<ref>` is the printed question number when the item carries one — a
 * child matches the note back to the sheet in their hand — and the bare
 * itemId otherwise.
 *
 * READS `item.note` ONLY (Slice H, 2026-08-22). A review item also carries
 * `internalNote` — the record-only twin, for a sign-off explanation or a
 * machine-generated audit rationale (Slice B's eraser-leniency rows,
 * `RecordCardScanOutcome.mjs`) — and this function has no parameter that
 * could reach it. That is deliberate: the boundary between "for the record"
 * and "for the reader" has to survive whatever gets written into
 * `internalNote` in the future without anyone here remembering to keep it
 * out. See `IReviewQueue.mjs`'s `ReviewItem` typedef for the full split.
 *
 * @param {Array<{note?: string|null, questionNumber?: number|null,
 *   itemId?: string, gradedAt?: string|null}>} items
 * @param {object} [opts]
 * @param {number} [opts.limit=3]
 * @param {number} [opts.maxChars=120]
 * @returns {string[]}
 */
export function reviewNoteLines(items, { limit = 3, maxChars = 120 } = {}) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.note === 'string' && item.note.trim())
    .slice()
    .sort((a, b) => String(b.gradedAt ?? '').localeCompare(String(a.gradedAt ?? '')))
    .slice(0, limit)
    .map((item) => {
      const ref = item.questionNumber ?? item.itemId ?? null;
      const line = ref === null ? `Note: ${item.note.trim()}` : `Note: ${item.note.trim()} (${ref})`;
      return line.length > maxChars ? line.slice(0, maxChars) : line;
    });
}

/** Appends the "Notes for you" section, informational only — no scan_action. */
function appendNoteLines(blocks, noteLines) {
  if (!noteLines.length) return;
  blocks.push(text('## NOTES FOR YOU'));
  noteLines.forEach((line) => blocks.push(text(line)));
}

/**
 * The agenda: what this learner can do right now, one subject section at a
 * time (spec §6.2 v2 — sectioned by subject rather than a flat list of unit
 * entries).
 *
 * A locked or unavailable section still prints. Hiding it would leave a child
 * wondering where the rest of the subject went; printing it WITH its remedy
 * (or the "not answering" line) is what turns a stall into an instruction —
 * `planDailyAgenda` guarantees a remedy exists whenever a section is locked.
 *
 * @param {object} args
 * @param {string} args.learnerId
 * @param {string} [args.learnerName]
 * @param {string} args.generatedAt   ISO time (injected — nothing here reads a clock)
 * @param {string} [args.timeZone]    IANA zone the printed time is stated in
 * @param {Array<{
 *   subject: string,
 *   servedToday?: boolean,
 *   next?: { title?: string, unitId?: string, token?: string, actionLabel?: string },
 *   lockedRemedy?: string,
 *   timingNotice?: string,
 *   focus?: {blockBudget?: number},
 *   suppressed?: {bySubject?: string},
 *   progressLabel?: string,
 *   gradePercent?: number,
 *   programUnavailable?: boolean,
 * }>} args.sections   `planDailyAgenda` sections, one per subject
 * @param {Record<string, string>} [args.tokensBySubject] subject -> opaque scan token, for that section's `next`
 * @param {Record<string, string>} [args.accessCodesByToken] TOKEN -> six-digit
 *   panel code aliasing that token (self-service). Keyed by token, not
 *   subject (Slice H, 2026-08-22) — a subject key could only ever alias ONE
 *   offer, so two tokened offers sharing a subject would silently fight over
 *   a single code. Absent, or missing an entry for a given token, that
 *   token's card carries no code claim at all and prints exactly as it did
 *   before the feature existed.
 * @param {string[]} [args.notes] pre-formatted "Notes for you" lines (spec R7,
 *   `reviewNoteLines`) — informational only, printed with no `scan_action`,
 *   so a grown-up's feedback reaches the child without pretending to be a
 *   thing to scan.
 * @param {string} [args.footer]
 * @returns {object} a document ready for `validateDocument`
 */
export function agendaDocument({
  learnerId, learnerName = null, generatedAt = null, timeZone = 'UTC',
  sections = [], tokensBySubject = {}, accessCodesByToken = {}, footer = null, notes = [],
} = {}) {
  // The learner's name is the document TITLE, not a text block: the renderers
  // give a title the standard-header treatment (inverted banner), which a
  // markdown heading in the block stream cannot ask for.
  // A raw id in the masthead is an accidental insult ("NOBODY", design
  // audit): no resolvable display name means we GREET, we don't echo.
  const title = learnerName || 'Hello!';
  const blocks = [];
  // The printed time goes at the FOOT of the sheet (centred), not the head.
  // It answers "is this still today's?" — a question asked when picking a
  // stray receipt up later, not when reading the top of a fresh one. At the
  // top it was the first thing between the child's name and their work.
  const printedAt = formatPrintedAt(generatedAt, timeZone);

  const noteLines = (Array.isArray(notes) ? notes : []).filter(isNonEmptyString);
  const offered = (Array.isArray(sections) ? sections : []).filter((s) => s && typeof s === 'object');
  if (!offered.length) {
    blocks.push(text('Nothing is assigned right now. Ask a grown-up what to do next.'));
    appendNoteLines(blocks, noteLines);
    // The footer belongs here too. This early return used to skip it, so the
    // ONE sheet whose date matters most — a "nothing assigned" slip found
    // loose on a table — was the one that never said when it was printed.
    // Same placement as the offered path below.
    if (printedAt) blocks.push({ ...text(printedAt), align: 'center' });
    return receipt(`agenda-${slugify(learnerId, 'learner')}`, blocks, { title });
  }

  // FINISHED SUBJECTS ARE A TALLY, NOT HEADLINES.
  //
  // Each one used to print as its own section heading — `## CIVILIZATION —
  // done today` — at the same weight as the work still to do, and above it,
  // because sections print in subject order. A child looking for their next
  // move read two dead lines first, each one an all-caps subject welded to a
  // lowercase phrase by an em dash, and the phrase repeated verbatim on every
  // one of them. Collected here instead and emitted as a single strip at the
  // foot of the sheet, where a tally belongs.
  const doneSubjects = [];
  offered.forEach((section) => {
    // A focus day deliberately removes flexible work from the CHILD'S paper;
    // the parent preview retains the suppression reason.
    if (section.suppressed) return;
    const suffix = section.focus
      ? ` — Focus today · up to ${section.focus.blockBudget} lessons`
      : (isNonEmptyString(section.progressLabel) ? ` — ${section.progressLabel}` : '');
    // Already served today: nothing more to offer for this subject.
    if (section.servedToday) {
      const subject = String(section.subject || '').trim() || 'work';
      const done = (Array.isArray(section.servedWork) ? section.servedWork : [])
        .map((work) => (isNonEmptyString(work?.title) ? work.title.trim() : null))
        .filter(Boolean);
      doneSubjects.push({
        subject,
        // The subject id doubles as its shelf-icon id everywhere else on the
        // sheet; the renderer degrades to no icon for one with no file.
        icon: subject,
        titles: done,
        ...(Number.isFinite(section.gradePercent) ? { percent: Math.round(section.gradePercent) } : {}),
      });
      return;
    }

    if (section.programUnavailable) {
      blocks.push(text(`## ${String(section.subject || '').toUpperCase()}${suffix}`));
      blocks.push(text('Not answering right now — try it on the Portal.'));
      return;
    }

    if (isNonEmptyString(section.lockedRemedy)) {
      blocks.push(text(`## ${String(section.subject || '').toUpperCase()}${suffix}`));
      blocks.push(text(section.lockedRemedy));
      return;
    }

    if (isNonEmptyString(section.timingNotice)) {
      blocks.push(text(`## ${String(section.subject || '').toUpperCase()}${suffix}`));
      blocks.push(text(section.timingNotice));
      return;
    }

    const next = section.next;
    if (!next || typeof next !== 'object') return;
    const nextTitle = next.title || next.unitId;
    const label = isNonEmptyString(next.actionLabel) ? `${nextTitle} — ${next.actionLabel}` : nextTitle;
    if (next.schoolcalcHandoff?.eligible) {
      blocks.push(text(`## ${String(section.subject || '').toUpperCase()}${suffix}`));
      blocks.push(text(nextTitle));
      if (isNonEmptyString(next.schoolcalcHandoff.displayCode)) {
        blocks.push(text(next.schoolcalcHandoff.displayCode));
        blocks.push(text('Enter on calculator.'));
      } else {
        blocks.push(text('Calculator eligible — code issued when printed.'));
      }
      return;
    }
    const token = tokensBySubject?.[section.subject];
    if (isNonEmptyString(token)) {
      blocks.push(...lessonAction({
        token,
        // NO EYEBROW. It used to read `Today · <subject>`, which the renderer
        // truncates at the first `·` — so it printed the single word "TODAY" on
        // every card. Every card on this page is today's (the page IS the day),
        // so that line restated the masthead and nothing else.
        //
        // Replacing it with the bare subject was no better: the taxonomy
        // breadcrumb directly beneath already reads "Arts › Hoffman Academy
        // Piano › Unit 3", with the subject's own SVG in the gutter. That
        // breadcrumb is the meaningful line — it says where in the curriculum
        // this lesson sits — and an eyebrow above it repeating the first word
        // is duplication that costs a row and pushes the title down.
        eyebrow: null,
        // Catch-up work is offered exactly like today's; only this says which
        // is which. See `agenda.mjs`'s `catchUp`.
        rail: section.catchUp ? 'Catch-up' : null,
        // The unit is pulled OUT of the breadcrumb and set directly above the
        // lesson title, where it reads as that lesson's parent rather than as
        // the tail of a course path. The breadcrumb keeps subject > course and
        // fits one line; the renderer marks this line with its own glyph.
        unit: next.taxonomy?.unit ?? null,
        title: nextTitle,
        description: next.description,
        icon: section.subject,
        // The footer instruction names what THIS card actually asks for.
        // `actionLabel` is the one place that decides that wording
        // (`offerSession.nextMove`) and it is composition-aware: a media unit
        // plays a video, a bank unit is answered on the screen, a stalled one
        // starts over, a program unit names WHERE it lives ("on the Portal").
        // Hardcoding "SCAN TO PRINT" told a child to print a film. It is
        // printed as-is rather than under a "SCAN TO …" stem because a
        // location hint does not read as a verb phrase; the scan-corner glyph
        // beside it is what says "scan" (print-documents.md, "Agenda and
        // result-receipt language").
        // The action label ALONE. The progress label used to ride here too, and
        // for a program course that is `34/366 · next: <title>` — a raw tally
        // the child does not act on, ending in a verbatim repeat of the card's
        // own title two rows above. Progress now goes to `progress` below as a
        // bar, which is what the result receipt already does with the same data.
        // A grade percentage is likewise not a thing to do; it belongs to the
        // result receipt, which is where a child sees it.
        meta: isNonEmptyString(next.actionLabel)
          ? next.actionLabel.toUpperCase()
          : 'SCAN TO PRINT',
        progress: section.progressRows,
        taxonomy: next.taxonomy,
        // Keyed by TOKEN (Slice H): whatever this specific card's own code
        // is, if any. Absent from the map (self-service off, or nothing
        // minted for this token) means the argument stays `undefined` —
        // `lessonAction` prints exactly what it always has.
        accessCode: accessCodesByToken?.[token],
      }));
    } else {
      blocks.push(text(`## ${String(section.subject || '').toUpperCase()}${suffix}`));
      blocks.push(text(label));
    }
  });

  if (doneSubjects.length) {
    // Whether anything is still open decides the wording: with work left this
    // is a footnote to the page above it; with nothing left it is the whole
    // answer, and saying so plainly beats a bare list under a small heading.
    const nothingLeft = blocks.length === 0;
    blocks.push({
      type: 'done_summary',
      label: nothingLeft ? 'All done today' : 'Done today',
      entries: doneSubjects,
    });
  }
  appendNoteLines(blocks, noteLines);
  const hasCalculator = offered.some((section) => section.next?.schoolcalcHandoff?.eligible);
  if (footer || hasCalculator) blocks.push(text(footer || 'Enter the calculator code to start.'));
  // The printed time is not part of the day's work — it answers "is this still
  // today's?", asked when a stray sheet turns up later. A rule above it says
  // so: everything over the line is the child's day, the line under it is the
  // sheet's own metadata.
  if (printedAt) blocks.push({ ...text(printedAt), align: 'center', rule: 'above' });
  return receipt(`agenda-${slugify(learnerId, 'learner')}`, blocks, { title });
}

/**
 * The result receipt: score, what to revisit, and every action that closes the
 * session out.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.unitTitle
 * @param {'passed'|'needs_remediation'} args.result
 * @param {number} [args.percent]
 * @param {string[]} [args.objectives] objectives to revisit (printed only on a fail)
 * @param {Array<{token?: string, label: string, presentation?: 'lesson',
 *   accessCode?: string|null}>} [args.actions] every tokened action's
 *   `accessCode` is threaded through the panel-code contract — via `lessonAction`
 *   when `presentation: 'lesson'`, via `plainScanAction` otherwise (2026-08-23:
 *   the plain branch used to push a bare `scan_action` with no pairing at
 *   all, the same defect Slice H closed for the lesson branch). A six-digit
 *   string prints the panel code beside the QR, `null` prints an explicit
 *   "Scanning is the only way in." rather than a silent gap, and omitting
 *   the field entirely makes no claim either way. The caller that mints the
 *   token (`CloseSessionOutcome`) is the one place that knows which of the
 *   three applies.
 * @param {{amount: number}|null} [args.reward] coins actually awarded
 * @param {string|null} [args.unlockedTitle] the unit this pass opened up
 * @param {string[]} [args.notes] pre-formatted "Notes for you" lines (spec R7,
 *   `reviewNoteLines`) — a grown-up's written feedback on this session's
 *   review items, reaching the child on the SAME receipt as the score.
 * @param {boolean[]} [args.marks] per-question correctness, ONE entry per
 *   question in printed order (`questionStart`-relative). When present and
 *   `marks.length === totalCount`, the renderer marks box N from
 *   `marks[N - questionStart]` instead of filling boxes left-to-right by
 *   `correctCount` — the positional fill claims "the LAST wrong questions
 *   were wrong", which is only true when the misses happen to be at the end
 *   (regression: a child's paper missed question 7 of 12; the receipt's
 *   numbered boxes blamed 11 and 12). Omitted when the caller has no
 *   per-question evidence — the renderer falls back to the positional fill
 *   rather than mis-index a partial array.
 * @returns {object}
 */
export function resultDocument({
  sessionId, unitTitle, result, percent = null, passingPercent = null, objectives = [],
  correctCount = null, totalCount = null, questionStart = null, progress = null,
  marks = null,
  subjectIcon = null,
  taxonomy = null,
  learnerName = null, date = null, time = null, studentNo = null, hints = [],
  actions = [], reward = null, rewardSkipReason = null, unlockedTitle = null, notes = [],
} = {}) {
  const passed = result === 'passed';
  const blocks = [{
    type: 'result_summary',
    headline: passed ? 'PASSED' : 'TRY AGAIN',
    title: unitTitle || 'Your work',
    ...(typeof percent === 'number' && Number.isFinite(percent) ? { percent } : {}),
    ...(typeof passingPercent === 'number' && Number.isFinite(passingPercent) ? { passingPercent } : {}),
    ...(Number.isInteger(correctCount) ? { correctCount } : {}),
    ...(Number.isInteger(totalCount) ? { totalCount } : {}),
    ...(Number.isInteger(questionStart) ? { questionStart } : {}),
    ...(Array.isArray(marks) && marks.length ? { marks } : {}),
    ...(progress ? { progress } : {}),
    ...(isNonEmptyString(subjectIcon) ? { icon: subjectIcon } : {}),
    ...(isNonEmptyString(learnerName) ? { learnerName } : {}),
    ...(isNonEmptyString(date) ? { date } : {}),
    ...(isNonEmptyString(time) ? { time } : {}),
    ...(isNonEmptyString(studentNo) ? { studentNo } : {}),
    ...(taxonomy ? { taxonomy } : {}),
    // HINTS FOLLOW THE MISSES, NOT THE VERDICT. These used to be gated on
    // `!passed`, so a child who got 9 of 10 was shown a box marking question
    // 15 wrong and then told nothing whatsoever about it — the sheet named
    // the miss and withheld the only line that said what to go read. Passing
    // is not a reason to withhold that; it only changes the urgency, which is
    // what the heading carries.
    ...(Array.isArray(hints) && hints.some(isNonEmptyString)
      ? {
        reviewHints: hints.filter(isNonEmptyString),
        // A pass is not a retry. "Before you retry" would be a false
        // instruction on a sheet whose next action is the NEXT lesson.
        reviewHeading: passed ? 'WORTH A SECOND LOOK' : 'REVIEW BEFORE YOU RETRY',
      }
      : {}),
  }];
  if (!passed && !(Array.isArray(hints) && hints.some(isNonEmptyString))
      && Array.isArray(objectives) && objectives.length) {
    blocks.push(text('## REVIEW BEFORE YOU RETRY'));
    objectives.filter(isNonEmptyString).forEach((o) => blocks.push(text(`- ${o}`)));
  }
  appendNoteLines(blocks, (Array.isArray(notes) ? notes : []).filter(isNonEmptyString));
  if (passed && reward && Number.isFinite(reward.amount) && reward.amount > 0) {
    blocks.push(text(`You earned ${reward.amount} ${reward.amount === 1 ? 'coin' : 'coins'}.`));
  }
  // Held coins are NAMED, never silent (student-advocacy A5): a pass whose
  // payout waits on a grown-up says so where the coins line would be.
  if (passed && rewardSkipReason === 'awaiting_signoff') {
    blocks.push(text('Coins: waiting for a grown-up\'s OK.'));
  }
  (Array.isArray(actions) ? actions : []).forEach((action) => {
    if (!action || !isNonEmptyString(action.label)) return;
    if (isNonEmptyString(action.token) && action.presentation === 'lesson') {
      blocks.push(...lessonAction({
        token: action.token, eyebrow: action.eyebrow ?? 'Next up',
        title: action.title ?? unlockedTitle ?? action.label, description: action.description,
        icon: action.icon,
        meta: action.meta ?? (passed ? 'Scan to print the next worksheet' : 'Scan to print your retry'),
        taxonomy: action.taxonomy,
        accessCode: action.accessCode,
      }));
    } else if (isNonEmptyString(action.token)) {
      blocks.push(...plainScanAction(action.token, action.label, action.accessCode));
    } else blocks.push(text(action.label));
  });

  // The invariant §9 exists to protect: nobody is left holding paper with
  // nothing to do next.
  if (!blocks.some((b) => b.type === 'scan_action')) {
    blocks.push(text('Scan your card to see what is next.'));
  }
  // Keep the session-derived id for persistence and diagnostics, but never
  // expose it as the renderer's fallback heading on a child's receipt.
  const learner = isNonEmptyString(learnerName) ? learnerName.trim() : null;
  return receipt(`result-${slugify(sessionId, 'session')}`, blocks, {
    title: learner ? `${learner}’s Result` : 'Worksheet Result',
  });
}

/**
 * The explanation slip: an unknown ticket, an expired one, a printer that would
 * not take the job. It is the reason a scan can never dead-end.
 *
 * @param {object} args
 * @param {string} args.id       distinguishes one slip from another; slugged
 * @param {string} args.headline
 * @param {string[]} [args.lines]
 * @param {Array<{token?: string, label: string, accessCode?: string|null}>}
 *   [args.actions] a tokened action goes through `plainScanAction`, so
 *   `accessCode` follows the same tri-state as `resultDocument`'s: omitted
 *   makes no claim (every notice printed today — no caller here mints one
 *   yet), a six-digit string pairs the panel code, `null` prints "Scanning
 *   is the only way in." instead of a silent gap.
 * @returns {object}
 */
export function noticeDocument({ id = 'notice', headline = 'Hmm', lines = [], actions = [] } = {}) {
  const blocks = [text(`# ${headline}`)];
  (Array.isArray(lines) ? lines : []).filter(isNonEmptyString).forEach((line) => blocks.push(text(line)));
  (Array.isArray(actions) ? actions : []).forEach((action) => {
    if (!action || !isNonEmptyString(action.label)) return;
    if (isNonEmptyString(action.token)) {
      blocks.push(...plainScanAction(action.token, action.label, action.accessCode));
    } else blocks.push(text(action.label));
  });
  if (blocks.length === 1) blocks.push(text('Scan your card to see what is next.'));
  return receipt(`notice-${slugify(id, 'slip')}`, blocks);
}
