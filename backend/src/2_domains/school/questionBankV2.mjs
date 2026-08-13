import { bankContentRev } from './bankRev.mjs';

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
  throw new Error(`unknown worksheet profile: ${profile}`);
}

/** Issue a fully self-contained worksheet. No later bank lookup is needed to grade it. */
export function issueWorksheet({ bank, learnerId, enrollmentId, lessonId, profile, seed, itemIds = null }) {
  const normalized = bank.revision ? bank : normalizeQuestionBankV2(bank);
  const spec = profileSpec(profile);
  const random = seeded(seed ?? `${normalized.revision}:${learnerId}:${enrollmentId}:${lessonId}`);
  let eligible = normalized.items.filter((item) => !item.levels || item.levels.includes(profile));
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
      itemId: item.id, type: item.type, prompt: item.prompt,
      source: item.source ? { ...item.source } : null,
      options: visible.map((choice, index) => ({
        id: choice.id, label: choice.label, letter: LETTERS[index], correct: choice.correct,
      })),
    };
  });
  return deepFreeze({
    schema: 'school.issued-worksheet/v1', bankId: normalized.id, bankRevision: normalized.revision,
    learnerId, enrollmentId, lessonId, profile, seed: String(seed ?? ''),
    itemIds: items.map((item) => item.itemId), items,
  });
}

export function gradeIssuedWorksheet(snapshot, answers = {}) {
  const results = snapshot.items.map((item) => {
    const expected = item.options.filter((option) => option.correct).map((option) => option.id).sort();
    const raw = answers[item.itemId];
    const given = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).sort();
    const correct = expected.length === given.length && expected.every((id, index) => id === given[index]);
    return { itemId: item.itemId, correct, expected, given };
  });
  return { results, missedItemIds: results.filter((result) => !result.correct).map((result) => result.itemId) };
}

export function remediationReceipt(snapshot, grade, policy = 'locator_only') {
  if (!['locator_only', 'show_answer', 'teacher_only'].includes(policy)) throw new Error(`unknown receipt policy: ${policy}`);
  if (policy === 'teacher_only') return { policy, items: [] };
  return {
    policy,
    items: snapshot.items.filter((item) => grade.missedItemIds.includes(item.itemId)).map((item) => ({
      itemId: item.itemId, source: item.source,
      ...(policy === 'show_answer' ? { answers: item.options.filter((option) => option.correct).map((option) => option.label) } : {}),
    })),
  };
}

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

/** Convert an instance into a self-contained publishable OMR document source. */
export function worksheetInstanceDocument(instance, {
  title = instance.lessonId, description = null,
  sourceTitle = null, printedPages = [],
} = {}) {
  const numericSeed = [...String(instance.seed || instance.id)]
    .reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return {
    schema: 'school.document-source/v1',
    id: instance.id,
    seed: numericSeed,
    variant: 0,
    target: ['letter'],
    archetype: 'worksheet',
    fit: { policy: 'fill', typeScale: 'standard' },
    title,
    header: {
      name: true, date: true, scoreBox: false, metaFirst: true, rule: false, frame: 'double',
      ...(description ? { subtitle: description } : {}),
      ...(sourceTitle ? {
        reading: `Read: ${sourceTitle}, ${printedPages.length === 1 ? 'page' : 'pages'} ${printedPages.join('–')}.`,
      } : {}),
    },
    blocks: [
      ...instance.questions.map((question, index) => ({
        type: 'question', itemId: question.itemId, number: index + 1, omr: true, fillAfter: true,
        blocks: [
          { type: 'rich_text', md: question.prompt },
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
