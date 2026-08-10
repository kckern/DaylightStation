import { bankContentRev } from '../bankRev.mjs';
import { adaptiveGraphicReason } from './adaptiveGraphic.mjs';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Deterministically curate one Adaptive Study session from authored bank order. */
export function curateAdaptiveStudy({ unit, bank } = {}) {
  const descriptor = unit?.schoolcalc;
  if (!isObject(unit) || descriptor?.mode !== 'adaptive_flashcards') {
    throw new Error('Adaptive Study requires a validated schoolcalc unit');
  }
  if (!isObject(bank) || bank.id !== unit.bank || !Array.isArray(bank.items)) {
    throw new Error(`Adaptive Study bank '${unit.bank ?? 'missing'}' is unavailable or mismatched`);
  }
  const { cardCount, maxExposuresPerCard } = descriptor.study;
  const { itemCount } = descriptor.quiz;
  if (!Number.isInteger(cardCount) || cardCount < 1 || cardCount > 12
      || !Number.isInteger(itemCount) || itemCount < 1 || itemCount > cardCount) {
    throw new Error('Adaptive Study policy exceeds the 48-byte TI-86 continuation budget');
  }
  if (bank.items.length < cardCount) {
    throw new Error(`Adaptive Study bank '${bank.id}' has ${bank.items.length} items; ${cardCount} required`);
  }
  const selected = bank.items.slice(0, cardCount);
  const ids = new Set();
  selected.forEach((item, index) => {
    const reason = incompatibleItemReason(item, ids);
    if (reason) throw new Error(`Adaptive Study bank '${bank.id}' item ${index}: ${reason}`);
    ids.add(item.id);
  });
  const revision = bankContentRev(bank);
  if (!revision) throw new Error(`Adaptive Study bank '${bank.id}' has no immutable revision`);
  return Object.freeze({
    schema: 'school.calc.adaptive-study-curation/v1',
    unitId: unit.unitId,
    subject: unit.subject,
    topicId: unit.unitId,
    bankId: bank.id,
    bankRevision: revision,
    cardIds: Object.freeze(selected.map(({ id }) => id)),
    quizIds: Object.freeze(selected.slice(0, itemCount).map(({ id }) => id)),
    policy: Object.freeze({
      cardCount,
      itemCount,
      maxExposuresPerCard,
      passingPercent: unit.passing?.percent ?? 80,
    }),
  });
}

function incompatibleItemReason(item, priorIds) {
  if (!isObject(item) || typeof item.id !== 'string' || !item.id) return 'id is required';
  if (priorIds.has(item.id)) return `duplicate id '${item.id}'`;
  if (item.type !== 'multiple_choice') return `type '${item.type ?? 'missing'}' is not multiple_choice`;
  if (typeof item.prompt !== 'string' || !item.prompt.trim()) return 'prompt is required';
  if (!Array.isArray(item.choices) || item.choices.length < 2 || item.choices.length > 5
      || item.choices.some((choice) => typeof choice !== 'string' || !choice.trim())) {
    return 'choices must contain 2..5 non-empty strings';
  }
  if (typeof item.answer !== 'string' || !item.choices.includes(item.answer)) {
    return 'answer must equal one authored choice';
  }
  const graphicReason = adaptiveGraphicReason(item.schoolcalc, { path: 'schoolcalc' });
  if (graphicReason) return graphicReason;
  return null;
}

export default curateAdaptiveStudy;
