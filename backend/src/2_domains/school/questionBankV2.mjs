import { bankContentRev } from './bankRev.mjs';
import { CODE_LETTERS, COMPANION_GATE_ITEM_ID, formatCode } from './companionCode.mjs';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value.toString(36);
}

function seeded(seed) {
  let state = 0;
  for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 2654435761) >>> 0;
  return () => ((state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0) / 0x100000000);
}

function shuffled(values, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/** Convert compact v2 authoring into the stable internal shape consumers use. */
export function normalizeQuestionBankV2(raw) {
  const revision = bankContentRev(raw);
  const items = (raw.items ?? []).map((item) => {
    const correct = item.type === 'multi_select' ? item.answers : [item.answer];
    const pool = [...correct.map((label) => ({ label, correct: true })), ...item.decoys.map((label) => ({ label, correct: false }))];
    return {
      ...item,
      choices: pool.map((choice, index) => ({
        id: `${revision}:${item.id}:${hash(`${index}:${choice.label}`)}`, ...choice,
      })),
    };
  });
  return { ...raw, revision, items };
}

function profileSpec(profile) {
  if (profile === 'lower') return { count: 6, visible: [3, 4], multiMin: 0, multiMax: 0 };
  if (profile === 'upper') return { count: 10, visible: [5], multiMin: 1, multiMax: 2 };
  if (profile === 'lower-3') return { count: 3, visible: [3, 4], multiMin: 0, multiMax: 0 };
  if (profile === 'upper-5') return { count: 5, visible: [5], multiMin: 0, multiMax: 0 };
  throw new Error(`unknown worksheet profile: ${profile}`);
}

/**
 * An item is one assessable fact.  Its profile wording is presentation
 * scaffolding, not a second item: answers, decoys, source evidence, and the
 * item id remain shared.  Authors may fully replace a profile prompt, or add
 * a prefix/suffix clue around the shared prompt.  The final string, not the
 * authoring recipe, is frozen into the issued snapshot.
 */
function promptForProfile(item, profile) {
  const baseProfile = profile.startsWith('lower') ? 'lower' : profile.startsWith('upper') ? 'upper' : profile;
  const forProfile = (field) => item[field]?.[profile] ?? item[field]?.[baseProfile];
  const prefix = forProfile('prompt_prefix_by_profile');
  const body = forProfile('prompt_by_profile') ?? item.prompt;
  const suffix = forProfile('prompt_suffix_by_profile');
  return [prefix, body, suffix].filter(Boolean).join(' ');
}

/** Issue a fully self-contained worksheet. No later bank lookup is needed to grade it. */
/**
 * Worksheets are typeset, not code: they must never show a straight quote or
 * apostrophe. Authoring discipline is not enough — a bank edited by hand, or
 * generated, will eventually carry `'` — so every prompt and every option
 * label is curled HERE, once, on the way into a worksheet. Everything
 * downstream (the printed sheet, the CLI preview, the answer key) inherits it.
 *
 * A quote opens after start-of-string, whitespace, or an opening bracket, and
 * closes otherwise; that rule makes `don't` an apostrophe (closing form, the
 * correct glyph) without needing to know it is a contraction.
 */
export function curlyQuotes(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/"([^"]*)"/g, '\u201c$1\u201d')
    .replace(/(^|[\s([{<\u2014\u2013-])'/g, '$1\u2018')
    .replace(/'/g, '\u2019')
    .replace(/(^|[\s([{<\u2014\u2013-])"/g, '$1\u201c')
    .replace(/"/g, '\u201d');
}

export function issueWorksheet({ bank, learnerId, enrollmentId, lessonId, profile, seed, itemIds = null }) {
  const normalized = bank.revision ? bank : normalizeQuestionBankV2(bank);
  const spec = profileSpec(profile);
  const random = seeded(seed ?? `${normalized.revision}:${learnerId}:${enrollmentId}:${lessonId}`);
  const baseProfile = profile.startsWith('lower') ? 'lower' : profile.startsWith('upper') ? 'upper' : profile;
  let eligible = normalized.items.filter((item) => !item.levels || item.levels.includes(profile) || item.levels.includes(baseProfile));
  if (itemIds) {
    const wanted = new Set(itemIds);
    eligible = eligible.filter((item) => wanted.has(item.id));
    if (eligible.length !== wanted.size) throw new Error('one or more requested remediation item ids are ineligible or missing');
  }
  let selected;
  if (itemIds) selected = shuffled(eligible, random);
  else if (profile === 'upper') {
    const multi = shuffled(eligible.filter((item) => item.type === 'multi_select'), random);
    const singles = shuffled(eligible.filter((item) => item.type === 'multiple_choice'), random);
    const multiCount = Math.min(spec.multiMax, Math.max(spec.multiMin, Math.floor(random() * 2) + 1));
    selected = shuffled([...multi.slice(0, multiCount), ...singles.slice(0, spec.count - multiCount)], random);
  } else selected = shuffled(eligible.filter((item) => item.type === 'multiple_choice'), random).slice(0, spec.count);
  if (!itemIds && selected.length !== spec.count) throw new Error(`profile ${profile} has insufficient eligible items`);

  const items = selected.map((item) => {
    const correct = item.choices.filter((choice) => choice.correct);
    const visibleCount = spec.visible[Math.floor(random() * spec.visible.length)];
    if (correct.length > visibleCount) throw new Error(`${item.id}: correct choices exceed visible option count`);
    const distractors = shuffled(item.choices.filter((choice) => !choice.correct), random)
      .slice(0, visibleCount - correct.length);
    const visible = shuffled([...correct, ...distractors], random);
    return {
      itemId: item.id, type: item.type, prompt: curlyQuotes(promptForProfile(item, profile)),
      source: item.source ? { ...item.source } : null,
      ...(item.reviewReference ? { reviewReference: {
        ...item.reviewReference, pages: [...item.reviewReference.pages],
      } } : {}),
      ...(item.stimulus ? { stimulus: { type: 'asset', ref: item.stimulus.ref, alt: curlyQuotes(item.stimulus.alt) } } : {}),
      options: visible.map((choice, index) => ({
        id: choice.id, label: curlyQuotes(choice.label), letter: LETTERS[index], correct: choice.correct,
      })),
    };
  });
  return deepFreeze({
    schema: 'school.issued-worksheet/v1', bankId: normalized.id, bankRevision: normalized.revision,
    learnerId, enrollmentId, lessonId, profile, seed: String(seed ?? ''),
    itemIds: items.map((item) => item.itemId), items,
  });
}

// `gradeIssuedWorksheet` and `remediationReceipt` lived here until 2026-08-15.
// Both were prototypes that production never called — only their own unit test
// did — and both had been superseded by shipped code: grading runs through
// `GradeSubmission` / `ResolveCardScan` (against the frozen worksheet-instance
// roster, see `worksheetInstanceRoster` below), and the remediation receipt's
// `locator_only` disclosure is what `CloseSessionOutcome` already prints as its
// `hints` lines. Two live implementations of one rule is one too many.

/**
 * The immutable, learner-specific realization of one lesson. This is the
 * authority an OMR scan grades; the authored bank is only an input used once
 * while the instance is created.
 */
export function createWorksheetInstance({
  id, sessionId, bank, learnerId, enrollmentId, lessonId, profile, seed,
  issuedAt, itemIds = null,
} = {}) {
  if (![id, sessionId, learnerId, enrollmentId, lessonId, issuedAt].every((v) => typeof v === 'string' && v)) {
    throw new Error('worksheet instance requires id, sessionId, learnerId, enrollmentId, lessonId and issuedAt');
  }
  const worksheet = issueWorksheet({ bank, learnerId, enrollmentId, lessonId, profile, seed, itemIds });
  return deepFreeze({
    schema: 'school.worksheet-instance/v1', id, sessionId, issuedAt,
    learnerId, enrollmentId, lessonId, profile,
    bankId: worksheet.bankId, bankRevision: worksheet.bankRevision,
    seed: worksheet.seed, itemIds: worksheet.itemIds, questions: worksheet.items,
  });
}

/**
 * The questions an instance actually asked, in printed order — the ONE roster
 * anything marking that sheet may use.
 *
 * The bank an instance was drawn from keeps growing; the sheet in the child's
 * hand does not. Reading the live bank back at grading time divides a perfect
 * ten-question paper by however many items the bank holds today, and files the
 * questions that were never printed as work a grown-up still owes — questions
 * nobody can ever mark, because nobody ever asked them.
 *
 * `itemIds` is the authority: `createWorksheetInstance` derives it from the
 * selected items themselves (`items.map((item) => item.itemId)`), so it and
 * `questions[].itemId` are the same list in the same order by construction.
 * `questions` is read only when `itemIds` is absent, which no minted instance
 * is — it is there so a hand-repaired file still grades against its own sheet
 * rather than silently reverting to the bank.
 *
 * @param {object|null|undefined} instance
 * @returns {string[]|null} the frozen roster, or `null` when there is no
 *   instance to read one from — the caller keeps whatever roster it used
 *   before instances existed.
 */
export function worksheetInstanceRoster(instance) {
  const ids = [instance?.itemIds, (instance?.questions ?? []).map((question) => question?.itemId)]
    .find((candidate) => Array.isArray(candidate)
      && candidate.length
      && candidate.every((id) => typeof id === 'string' && id));
  return ids ? [...new Set(ids)] : null;
}

/**
 * "673, 674, 675, 680" reads as four separate pages and "673–674–675–680"
 * reads as one range; neither is what a child scanning the header needs.
 * Collapse consecutive runs into ranges and comma-separate the groups, so a
 * reading lands as `673–675, 680`. A run of two stays a range (`82–83`),
 * which is what this line already printed for the common two-page case.
 */
export function formatPageSpans(pages) {
  const numeric = [];
  const literal = [];
  (pages ?? []).forEach((value) => {
    if (Number.isFinite(Number(value))) {
      numeric.push(Number(value));
      return;
    }
    const text = String(value ?? '').trim();
    const range = /^(\d+)\s*[-–]\s*(\d+)$/u.exec(text);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) numeric.push(page);
    } else if (text) literal.push(text);
  });
  const sorted = [...new Set(numeric)].sort((a, b) => a - b);
  const groups = [];
  for (const page of sorted) {
    const last = groups[groups.length - 1];
    if (last && page === last[last.length - 1] + 1) last.push(page);
    else groups.push([page]);
  }
  return [...groups.map((g) => (g.length === 1 ? `${g[0]}` : `${g[0]}\u2013${g[g.length - 1]}`)), ...[...new Set(literal)]].join(', ');
}

/**
 * The gate row (Task 8): the first printed row of a required companion's
 * worksheet, five positions labelled A–E, where the child fills in the finish
 * code the read-along released.
 *
 * TWO CODES, NEVER THE SAME FIELD. `companionCode` (the option below, and the
 * lesson card's Read Along panel) is the SIX-DIGIT ACCESS CODE that OPENS the
 * companion. `finishCode` is the A–E set that finishing it RELEASES. This
 * block is about the second one only.
 *
 * WHY THE CODE ITSELF RIDES ON THE BLOCK. `publishDocument` mints a derived
 * bank item for a question carrying `answer`/`answers`; this block carries
 * neither, so it mints nothing and passes through to the published document
 * unchanged — which is the point. The gate is not a bank item (it is never
 * `questionBankValidation`-checked, whose `multi_select` two-answer minimum
 * would make the one-letter code `['A']` illegal), so the ONE place its
 * expected answer can live and still reach the row planner and the scan-back
 * resolver is the printed document itself. `validateDocumentV2`'s answer-free
 * postcondition bans `answer`/`answers`, not `code`, and a published document
 * is served to a browser nowhere — the only route that reads one renders a
 * PDF. `RenderPrintDocument#prepareV2Document` synthesizes the
 * `companion_code` bank item from this block; `formatAnswer` prints it on the
 * teacher key.
 *
 * `points: 0` because the gate is a VETO, not a question: it decides whether a
 * sheet passes, and it is worth nothing toward the score it gates.
 */
function companionGateBlock(finishCode) {
  return {
    type: 'question',
    itemId: COMPANION_GATE_ITEM_ID,
    number: 1,
    omr: true,
    points: 0,
    companionGate: true,
    code: [...finishCode],
    choices: [...CODE_LETTERS],
    blocks: [
      { type: 'rich_text', md: 'Read-along finish code. Fill in every letter you were given.' },
      { type: 'omr_response', itemId: COMPANION_GATE_ITEM_ID, choices: CODE_LETTERS.length },
    ],
  };
}

/**
 * Convert an instance into a self-contained publishable OMR document source.
 *
 * @param {string[]|null} [options.finishCode] - the A–E finish code a REQUIRED
 *   companion minted for this lesson (`IssueDocument#prepareCompanion`). When
 *   present, the document grows a gate row ahead of its first question; absent
 *   or null — an optional companion, or no companion at all — the blocks are
 *   byte-identical to before the gate existed.
 */
export function worksheetInstanceDocument(instance, {
  title = instance.lessonId, description = null,
  sourceTitle = null, printedPages = [], subjectIcon = 'school', subjectName = null, breadcrumb = null,
  reading = null, passPercent = null, progress = null, companionCode = null, finishCode = null,
} = {}) {
  // Null is "no gate" — an optional companion, or none at all. Anything else
  // that `formatCode` cannot read is a CALLER BUG and is refused loudly rather
  // than silently dropping the gate: a required companion's sheet that quietly
  // prints no gate row is exactly the ungated worksheet this feature exists to
  // prevent, and it would look identical to a correct optional one.
  if (finishCode != null && !formatCode(finishCode)) {
    throw new Error(`worksheetInstanceDocument: unusable companion finishCode ${JSON.stringify(finishCode)}`);
  }
  const gate = finishCode != null ? companionGateBlock(finishCode) : null;
  const numericSeed = [...String(instance.seed || instance.id)]
    .reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return {
    schema: 'school.document-source/v1',
    id: instance.id,
    seed: numericSeed,
    variant: 0,
    target: ['letter'],
    archetype: 'worksheet',
    // No explicit `fit` here (deliberately, since the prior code DID pin one
    // — see git blame): `fill`'s "never shrink, always grow the last page"
    // behavior never even TRIES compact density, so a worksheet spilling onto
    // a second page always did so at the loosest possible spacing, even when
    // a denser layout would have fit more of it on page one. Omitting `fit`
    // lets `validateDocumentV2`'s per-archetype preset
    // (`FIT_POLICY_PRESETS.worksheet`) apply instead, which as of this change
    // is `prefer-one-page` — the policy built to satisfy the household rule
    // this function exists to serve ("we can only use two pages if we have an
    // exceptionally long number of questions ... within each page there
    // should be right sizing"). This does NOT guarantee every worksheet lands
    // on one page — a genuinely long question set (e.g. the atlas course's
    // "upper" profile: 10 five-choice multiple-choice questions) can still
    // spill even at compact density, and correctly should: that is the
    // "exceptionally long" half of the household rule, not a bug. What
    // changes is that the spill now happens at the RIGHT-SIZED density
    // instead of the loose default, and is reported (a warning) instead of
    // silent. A future worksheet that legitimately needs different fit
    // behavior can still pass `fit` explicitly through
    // `worksheetInstanceDocument`'s options; nothing here forecloses that, it
    // just stops HARD-CODING a policy that never even tried to right-size.
    title,
    header: {
      // The header owns identity/card geometry only. Lesson presentation
      // belongs to the semantic card immediately below it; generic framed
      // title/subtitle/reading headers are not a valid issued-paper design.
      name: true, date: true, title: false, scoreBox: false, metaFirst: true, rule: false, frame: 'none',
    },
    blocks: [
      {
        type: 'inset', layout: 'lesson_card', keepWithNext: true,
        subjectIcon,
        subjectName: subjectName ?? subjectIcon,
        breadcrumb: breadcrumb ?? instance.lessonId,
        lessonTitle: title,
        ...(reading ? { reading } : sourceTitle && printedPages.length ? {
          reading: `Read: ${sourceTitle}, ${printedPages.length === 1 ? 'page' : 'pages'} ${formatPageSpans(printedPages)}.`,
        } : {}),
        citation: description,
        questionCount: instance.questions.length,
        passPercent,
        ...(Array.isArray(progress) && progress.length ? { progress } : {}),
        ...(companionCode ? { companionCode: String(companionCode) } : {}),
        // Required by the generic inset schema; the lesson-card renderer
        // consumes the semantic fields above instead.
        blocks: [{ type: 'rich_text', md: title }],
      },
      // The gate comes FIRST: it is the sheet's precondition, so it reads as
      // one before the questions rather than as an afterthought below them,
      // and it takes the first card row of the allocated range.
      ...(gate ? [gate] : []),
      ...instance.questions.map((question, index) => ({
        type: 'question', itemId: question.itemId, number: (gate ? 2 : 1) + index, omr: true, fillAfter: true,
        blocks: [
          { type: 'rich_text', md: question.prompt },
          ...(question.stimulus ? [{ type: 'asset', ref: question.stimulus.ref, alt: question.stimulus.alt,
            caption: false, maxHeightPt: 110, maxWidthPt: 300 }] : []),
          {
            type: 'omr_response', itemId: question.itemId,
            choices: question.options.length, layout: 'compact',
          },
        ],
        choices: question.options.map((option) => option.label),
        ...(question.type === 'multi_select'
          ? { answers: question.options.filter((option) => option.correct).map((option) => option.label) }
          : { answer: question.options.find((option) => option.correct)?.label }),
      })),
    ],
  };
}

/**
 * Compose several immutable lesson instances into one publishable worksheet.
 *
 * The instances remain the grading authority.  This only creates a print-time
 * document, with every derived-bank item namespaced by its section so two
 * courses may safely reuse an authored item id.  `sections` is returned as
 * durable row-attribution input for the allocation layer.
 */
export function composedWorksheetDocument({
  id, seed = 0, title = 'Worksheet', subtitle = null, sections = [],
} = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('composed worksheet requires an id');
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('composed worksheet requires one or more sections');

  let number = 1;
  const blocks = [];
  const attribution = [];
  sections.forEach((section, index) => {
    const instance = section?.instance;
    if (!instance || !Array.isArray(instance.questions) || instance.questions.length === 0) {
      throw new Error(`composed worksheet section ${index + 1} requires an issued worksheet instance`);
    }
    const sectionId = section.id ?? `section-${index + 1}`;
    const sectionItems = [];
    const printedPages = formatPageSpans(section.printedPages ?? []);
    // This is a section-level study card, not part of question 1. The
    // renderer honours `keepWithNext` so it moves with the first question
    // rather than becoming a widow at a page boundary.
    blocks.push({
      type: 'inset', layout: 'lesson_card', keepWithNext: true,
      subjectIcon: section.subjectId ?? section.subject ?? 'school',
      subjectName: section.subject ?? section.subjectId ?? 'School',
      breadcrumb: section.breadcrumb ?? [section.course, section.discipline, section.topic]
        .filter(Boolean).join(' › '),
      lessonTitle: section.title ?? instance.lessonId,
      // A card may omit this line when the lesson title/course already tell
      // the learner what to open. Never substitute a vague fake instruction.
      ...(section.reading ? { reading: section.reading }
        : section.sourceTitle && printedPages
          ? { reading: `Read: ${section.sourceTitle}, ${String(printedPages).includes(',') || String(printedPages).includes('–') ? 'pages' : 'page'} ${printedPages}.` }
          : printedPages ? { reading: `Read: pages ${printedPages}` } : {}),
      citation: section.citation ?? section.description ?? null,
      questionCount: instance.questions.length,
      passPercent: section.passPercent ?? null,
      ...(Array.isArray(section.progress) && section.progress.length ? { progress: section.progress } : {}),
      // The source schema requires nested blocks for an inset. The specialised
      // lesson-card renderer consumes the semantic fields above instead.
      blocks: [{ type: 'rich_text', md: section.title ?? instance.lessonId }],
    });
    instance.questions.forEach((question) => {
      const itemId = `${sectionId}--${question.itemId}`;
      sectionItems.push(itemId);
      blocks.push({
        type: 'question', itemId, number: number++, omr: true, fillAfter: true,
        blocks: [
          { type: 'rich_text', md: question.prompt },
          ...(question.stimulus ? [{ type: 'asset', ref: question.stimulus.ref, alt: question.stimulus.alt,
            caption: false, maxHeightPt: 110, maxWidthPt: 300 }] : []),
          { type: 'omr_response', itemId, choices: question.options.length, layout: 'compact' },
        ],
        choices: question.options.map((option) => option.label),
        ...(question.type === 'multi_select'
          ? { answers: question.options.filter((option) => option.correct).map((option) => option.label) }
          : { answer: question.options.find((option) => option.correct)?.label }),
      });
    });
    attribution.push({
      id: sectionId,
      worksheetInstanceId: instance.id,
      sessionId: instance.sessionId,
      lessonId: instance.lessonId,
      ...(section.subjectId ?? section.subject ? { subjectId: section.subjectId ?? section.subject } : {}),
      ...(section.courseId ?? section.course ? { courseId: section.courseId ?? section.course } : {}),
      itemIds: sectionItems,
    });
    // Headings provide the section boundary. Do not emit a standalone
    // `divider` here: the worksheet renderer's compact theme intentionally
    // accepts the core question-bank block set, while divider support belongs
    // to the richer document-authoring surface. Keeping composition on the
    // core set lets the CLI preview and production issuer share this source.
  });

  const numericSeed = [...String(seed)]
    .reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return {
    source: {
      schema: 'school.document-source/v1', id, seed: numericSeed, variant: 0,
      target: ['letter'], archetype: 'worksheet',
      fit: { policy: 'prefer-one-page' },
      title,
      header: {
        name: true, date: true, title: false, scoreBox: false, metaFirst: true, rule: false, frame: 'none',
        ...(subtitle ? { subtitle } : {}),
      },
      blocks,
    },
    sections: attribution,
  };
}
