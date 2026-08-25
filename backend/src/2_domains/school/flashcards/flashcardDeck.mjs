const ID = /^[a-z0-9][a-z0-9:._/-]{0,127}$/;
const CARD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BLOCK_TYPES = new Set(['text', 'image', 'audio', 'video', 'tts']);
const DIRECTIONS = new Set(['front_to_back', 'back_to_front']);

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

/** Validate authored rich-card content without coupling it to a media provider. */
export function validateFlashcardDeck(raw, { path = 'deck' } = {}) {
  const errors = [];
  const at = (suffix, message) => errors.push(`${path}${suffix}: ${message}`);
  if (!object(raw)) return { errors: [`${path}: must be a mapping`] };
  if (raw.schema !== 'school.flashcard-deck/v1') at('.schema', 'must be school.flashcard-deck/v1');
  if (!ID.test(raw.id || '')) at('.id', 'must be a lowercase content reference');
  if (!text(raw.title)) at('.title', 'is required');
  const assessment = validateAssessment(raw, errors, path);
  if (!Array.isArray(raw.cards) || raw.cards.length === 0) at('.cards', 'must contain at least one card');
  const ids = new Set();
  (raw.cards || []).forEach((card, index) => {
    const prefix = `.cards[${index}]`;
    if (!object(card)) { at(prefix, 'must be a mapping'); return; }
    if (!CARD_ID.test(card.cardId || '')) at(`${prefix}.cardId`, 'must be a lowercase identifier');
    else if (ids.has(card.cardId)) at(`${prefix}.cardId`, `duplicates '${card.cardId}'`);
    else ids.add(card.cardId);
    ['front', 'back'].forEach((face) => {
      if (!object(card[face]) || !Array.isArray(card[face].blocks) || card[face].blocks.length === 0) {
        at(`${prefix}.${face}`, 'requires a non-empty blocks array'); return;
      }
      card[face].blocks.forEach((block, blockIndex) => validateBlock(block, `${prefix}.${face}.blocks[${blockIndex}]`, errors));
    });
    if (card.explanation !== undefined && !text(card.explanation)) at(`${prefix}.explanation`, 'must be non-empty when present');
    if (card.concepts !== undefined && (!Array.isArray(card.concepts) || card.concepts.some((id) => !CARD_ID.test(id)) || new Set(card.concepts).size !== card.concepts.length)) at(`${prefix}.concepts`, 'must be unique lowercase identifiers when present');
    if (card.directions !== undefined && (!Array.isArray(card.directions) || card.directions.length === 0 || card.directions.some((direction) => !DIRECTIONS.has(direction)))) at(`${prefix}.directions`, 'must contain front_to_back and/or back_to_front');
    validateLearn(card.learn, `${prefix}.learn`, errors);
  });
  if (errors.length) return { errors, deck: null };
  // `bankId` was the first draft's top-level test relationship. Preserve old
  // content on read, but hand every consumer one unambiguous deck-owned field.
  const { bankId: _legacyBankId, ...withoutLegacy } = raw;
  return { errors, deck: { ...withoutLegacy, ...(assessment ? { assessment } : {}) } };
}

function validateAssessment(raw, errors, path) {
  const legacy = raw.bankId;
  if (legacy !== undefined && !ID.test(legacy || '')) errors.push(`${path}.bankId: must be a lowercase content reference`);
  if (raw.assessment === undefined) return legacy ? { bankId: legacy } : null;
  if (!object(raw.assessment)) { errors.push(`${path}.assessment: must be a mapping`); return null; }
  if (!ID.test(raw.assessment.bankId || '')) errors.push(`${path}.assessment.bankId: must be a lowercase content reference`);
  if (legacy && legacy !== raw.assessment.bankId) errors.push(`${path}: bankId and assessment.bankId disagree`);
  return { bankId: raw.assessment.bankId };
}

function validateLearn(learn, path, errors) {
  if (learn === undefined) return;
  if (!object(learn)) { errors.push(`${path}: must be a mapping`); return; }
  Object.entries(learn).forEach(([direction, config]) => {
    if (!DIRECTIONS.has(direction)) { errors.push(`${path}.${direction}: must be front_to_back or back_to_front`); return; }
    if (!object(config) || !Array.isArray(config.acceptedAnswers) || config.acceptedAnswers.length === 0
      || config.acceptedAnswers.some((answer) => !text(answer))) {
      errors.push(`${path}.${direction}.acceptedAnswers: must be a non-empty text array`);
    }
  });
}

function validateBlock(block, path, errors) {
  const add = (message) => errors.push(`${path}: ${message}`);
  if (!object(block)) { add('must be a mapping'); return; }
  if (!BLOCK_TYPES.has(block.type)) { add('type must be text|image|audio|video|tts'); return; }
  if (block.type === 'text' || block.type === 'tts') {
    if (!text(block.text)) add('text is required');
    if (block.type === 'tts' && !text(block.lang)) add('tts requires lang');
    return;
  }
  if (!text(block.assetId)) add('assetId is required');
  if (block.type === 'image' && !text(block.alt)) add('image requires non-empty alt text');
  if ((block.type === 'audio' || block.type === 'video') && !text(block.transcript)) add(`${block.type} requires a transcript`);
  if (block.type === 'video' && !text(block.posterAssetId)) add('video requires posterAssetId');
}

/** Compatibility projection for the existing text-only question-bank runner. */
export function projectBankAsFlashcardDeck(bank) {
  const cards = (bank?.items || []).map((item) => ({
    cardId: item.id,
    concepts: item.concepts,
    front: { blocks: [{ type: 'text', text: item.prompt }] },
    back: { blocks: [{ type: 'text', text: answerText(item) }] },
  }));
  return {
    schema: 'school.flashcard-deck/v1', id: `bank:${bank?.id || 'unknown'}`,
    title: bank?.title || 'Flashcards', ...(bank?.id ? { assessment: { bankId: bank.id } } : {}), cards,
  };
}

function answerText(item) {
  if (item?.type === 'matching') return (item.pairs || []).map(({ left, right }) => `${left} → ${right}`).join('\n');
  if (Array.isArray(item?.answers)) return item.answers.join('\n');
  return item?.answer || '';
}

export const FLASHCARD_BLOCK_TYPES = Object.freeze([...BLOCK_TYPES]);
export const FLASHCARD_DIRECTIONS = Object.freeze([...DIRECTIONS]);
