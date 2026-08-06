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
 * inverted banner (black band, light text) across the top of the tape. Only
 * the agenda carries one today — the result/notice slips open with their own
 * `# …` headline blocks instead.
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
      const ref = item.questionNumber ?? item.itemId ?? '?';
      const line = `Note: ${item.note.trim()} (${ref})`;
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
 *   progressLabel?: string,
 *   gradePercent?: number,
 *   programUnavailable?: boolean,
 * }>} args.sections   `planDailyAgenda` sections, one per subject
 * @param {Record<string, string>} [args.tokensBySubject] subject -> opaque scan token, for that section's `next`
 * @param {string[]} [args.notes] pre-formatted "Notes for you" lines (spec R7,
 *   `reviewNoteLines`) — informational only, printed with no `scan_action`,
 *   so a grown-up's feedback reaches the child without pretending to be a
 *   thing to scan.
 * @param {string} [args.footer]
 * @returns {object} a document ready for `validateDocument`
 */
export function agendaDocument({
  learnerId, learnerName = null, generatedAt = null, timeZone = 'UTC',
  sections = [], tokensBySubject = {}, footer = null, notes = [],
} = {}) {
  // The learner's name is the document TITLE, not a text block: the renderers
  // give a title the standard-header treatment (inverted banner), which a
  // markdown heading in the block stream cannot ask for.
  const title = learnerName || learnerId || 'School';
  const blocks = [];
  const printedAt = formatPrintedAt(generatedAt, timeZone);
  if (printedAt) blocks.push(text(`Printed ${printedAt}`));

  const noteLines = (Array.isArray(notes) ? notes : []).filter(isNonEmptyString);
  const offered = (Array.isArray(sections) ? sections : []).filter((s) => s && typeof s === 'object');
  if (!offered.length) {
    blocks.push(text('Nothing is assigned right now. Ask a grown-up what to do next.'));
    appendNoteLines(blocks, noteLines);
    return receipt(`agenda-${slugify(learnerId, 'learner')}`, blocks, { title });
  }

  offered.forEach((section) => {
    const served = !!section.servedToday;
    const suffix = served
      ? ' — done today'
      : (isNonEmptyString(section.progressLabel) ? ` — ${section.progressLabel}` : '');
    blocks.push(text(`## ${String(section.subject || '').toUpperCase()}${suffix}`));

    if (typeof section.gradePercent === 'number' && Number.isFinite(section.gradePercent)) {
      blocks.push(text(`Grade so far: ${Math.round(section.gradePercent)}%`));
    }

    // Already served today: nothing more to offer for this subject.
    if (served) return;

    if (section.programUnavailable) {
      blocks.push(text('Not answering right now — try it on the Portal.'));
      return;
    }

    if (isNonEmptyString(section.lockedRemedy)) {
      blocks.push(text(section.lockedRemedy));
      return;
    }

    const next = section.next;
    if (!next || typeof next !== 'object') return;
    const nextTitle = next.title || next.unitId;
    const label = isNonEmptyString(next.actionLabel) ? `${nextTitle} — ${next.actionLabel}` : nextTitle;
    const token = tokensBySubject?.[section.subject];
    if (isNonEmptyString(token)) {
      // `icon` names the subject's shelf icon (the nine School-home SVGs);
      // raster renderers draw it beside the label, text renderers ignore it.
      blocks.push({ type: 'scan_action', action: token, label, icon: section.subject });
    } else {
      blocks.push(text(label));
    }
  });

  appendNoteLines(blocks, noteLines);
  blocks.push(text(footer || 'Scan a line above to start. Scan your card any time for a new list.'));
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
 * @param {Array<{token?: string, label: string}>} [args.actions]
 * @param {{amount: number}|null} [args.reward] coins actually awarded
 * @param {string|null} [args.unlockedTitle] the unit this pass opened up
 * @param {string[]} [args.notes] pre-formatted "Notes for you" lines (spec R7,
 *   `reviewNoteLines`) — a grown-up's written feedback on this session's
 *   review items, reaching the child on the SAME receipt as the score.
 * @returns {object}
 */
export function resultDocument({
  sessionId, unitTitle, result, percent = null, objectives = [],
  actions = [], reward = null, unlockedTitle = null, notes = [],
} = {}) {
  const passed = result === 'passed';
  const blocks = [
    text(passed ? '# Nice work!' : '# Almost there'),
    text(unitTitle || 'Your work'),
  ];
  if (typeof percent === 'number' && Number.isFinite(percent)) {
    blocks.push(text(`Score: ${Math.round(percent)}%`));
  }
  if (!passed && Array.isArray(objectives) && objectives.length) {
    blocks.push(text('Worth another look:'));
    objectives.filter(isNonEmptyString).forEach((o) => blocks.push(text(`- ${o}`)));
  }
  appendNoteLines(blocks, (Array.isArray(notes) ? notes : []).filter(isNonEmptyString));
  if (passed && reward && Number.isFinite(reward.amount) && reward.amount > 0) {
    blocks.push(text(`You earned ${reward.amount} ${reward.amount === 1 ? 'coin' : 'coins'}.`));
  }
  if (passed && isNonEmptyString(unlockedTitle)) {
    blocks.push(text(`Next up: ${unlockedTitle}`));
  }

  (Array.isArray(actions) ? actions : []).forEach((action) => {
    if (!action || !isNonEmptyString(action.label)) return;
    if (isNonEmptyString(action.token)) blocks.push({ type: 'scan_action', action: action.token, label: action.label });
    else blocks.push(text(action.label));
  });

  // The invariant §9 exists to protect: nobody is left holding paper with
  // nothing to do next.
  if (!blocks.some((b) => b.type === 'scan_action')) {
    blocks.push(text('Scan your card to see what is next.'));
  }
  return receipt(`result-${slugify(sessionId, 'session')}`, blocks);
}

/**
 * The explanation slip: an unknown ticket, an expired one, a printer that would
 * not take the job. It is the reason a scan can never dead-end.
 *
 * @param {object} args
 * @param {string} args.id       distinguishes one slip from another; slugged
 * @param {string} args.headline
 * @param {string[]} [args.lines]
 * @param {Array<{token?: string, label: string}>} [args.actions]
 * @returns {object}
 */
export function noticeDocument({ id = 'notice', headline = 'Hmm', lines = [], actions = [] } = {}) {
  const blocks = [text(`# ${headline}`)];
  (Array.isArray(lines) ? lines : []).filter(isNonEmptyString).forEach((line) => blocks.push(text(line)));
  (Array.isArray(actions) ? actions : []).forEach((action) => {
    if (!action || !isNonEmptyString(action.label)) return;
    if (isNonEmptyString(action.token)) blocks.push({ type: 'scan_action', action: action.token, label: action.label });
    else blocks.push(text(action.label));
  });
  if (blocks.length === 1) blocks.push(text('Scan your card to see what is next.'));
  return receipt(`notice-${slugify(id, 'slip')}`, blocks);
}
