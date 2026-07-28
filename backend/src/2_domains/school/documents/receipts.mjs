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
 * Receipts are single-column, receipt-target, and carry no randomness at all, so
 * seed 0 is not a placeholder — regeneration is byte-identical by construction.
 */
const receipt = (id, blocks, seed = 0, variant = 0) => ({
  id, seed, variant, target: ['receipt'], blocks,
});

/**
 * The agenda: what this learner can do right now, one scannable action per
 * offered choice.
 *
 * A locked entry still prints. Hiding it would leave a child wondering where
 * the rest of the course went; printing it WITH its remedy is what turns a lock
 * into an instruction (`../planner.mjs` guarantees the remedy exists).
 *
 * @param {object} args
 * @param {string} args.learnerId
 * @param {string} [args.learnerName]
 * @param {string} args.generatedAt   ISO time (injected — nothing here reads a clock)
 * @param {Array}  args.entries       planner entries, each optionally carrying `{ token, actionLabel }`
 * @param {string} [args.footer]
 * @returns {object} a document ready for `validateDocument`
 */
export function agendaDocument({ learnerId, learnerName = null, generatedAt = null, entries = [], footer = null } = {}) {
  const blocks = [text(`# ${learnerName || learnerId || 'School'}`)];
  if (isNonEmptyString(generatedAt)) blocks.push(text(`Printed ${generatedAt}`));

  const offered = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === 'object');
  if (!offered.length) {
    blocks.push(text('Nothing is assigned right now. Ask a grown-up what to do next.'));
    return receipt(`agenda-${slugify(learnerId, 'learner')}`, blocks);
  }

  offered.forEach((entry) => {
    const title = entry.title || entry.unitId;
    if (isNonEmptyString(entry.token)) {
      blocks.push({ type: 'scan_action', action: entry.token, label: entry.actionLabel || title });
      return;
    }
    if (entry.status === 'locked') {
      blocks.push(text(`${title} — ${entry.lockReason || 'not open yet'}`));
      return;
    }
    // No token and not locked: the move belongs to a grown-up (hand the work
    // in, wait for a mark). Say so rather than printing a bare title.
    blocks.push(text(`${title} — ${entry.actionLabel || 'waiting on a grown-up'}`));
  });

  blocks.push(text(footer || 'Scan a line above to start. Scan your card any time for a new list.'));
  return receipt(`agenda-${slugify(learnerId, 'learner')}`, blocks);
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
 * @returns {object}
 */
export function resultDocument({
  sessionId, unitTitle, result, percent = null, objectives = [],
  actions = [], reward = null, unlockedTitle = null,
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
