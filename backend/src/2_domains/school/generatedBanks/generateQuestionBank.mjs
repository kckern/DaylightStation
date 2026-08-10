import { sampleDistractors, seededShuffle } from './distractors.mjs';

const GENERATED_ITEM_TYPES = new Set(['multiple_choice', 'region_click', 'asset_choice']);
const METADATA_FIELDS = ['subject', 'unit', 'readalong'];
const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Pure, subject-neutral synthesis of a standard School question bank from an
 * explicit recipe and entity rows. Subject names and namespaces are data.
 */
export function generateQuestionBank({ recipe, entities }) {
  validateInputs(recipe, entities);
  const entityIdField = recipe.entityIdField ?? 'id';
  const items = entities.map((entity, index) => {
    const entityId = field(entity, entityIdField, `entities[${index}]`);
    const id = `${recipe.bankId}:${entityId}`;
    const prompt = fillTemplate(recipe.prompt, entity, `recipe '${recipe.bankId}'`);
    const answer = field(entity, recipe.answerField, `entities[${index}]`);

    if (recipe.itemType === 'region_click') {
      return { id, type: 'region_click', prompt, asset: recipe.asset, answer };
    }

    const distractorField = recipe.distractorField ?? recipe.answerField;
    const pool = entities.map((row, rowIndex) => field(row, distractorField, `entities[${rowIndex}]`));
    const distractors = sampleDistractors({
      pool,
      exclude: answer,
      count: recipe.distractorCount ?? 3,
      seed: id,
    });
    // Stable per-item shuffling prevents an answer-position pattern while
    // preserving byte-identical banks across builds and deployments.
    const values = seededShuffle([answer, ...distractors], `${id}:choices`);

    if (recipe.itemType === 'multiple_choice') {
      return { id, type: 'multiple_choice', prompt, choices: values, answer };
    }

    const byAnswer = new Map(entities.map((row, rowIndex) => [
      field(row, recipe.answerField, `entities[${rowIndex}]`), row,
    ]));
    const item = {
      id,
      type: 'asset_choice',
      prompt,
      choices: values.map((value) => ({
        value,
        label: recipe.choiceLabelField
          ? field(byAnswer.get(value), recipe.choiceLabelField, `choice '${value}'`)
          : value,
      })),
      answer,
    };
    if (recipe.promptImage) item.promptImage = projectImage(recipe.promptImage, entity);
    return item;
  });

  const bank = {
    id: recipe.bankId,
    title: recipe.title,
    audience: recipe.audience ?? 'assigned',
    topics: Array.isArray(recipe.topics) ? [...recipe.topics] : [],
    items,
  };
  METADATA_FIELDS.forEach((key) => {
    if (recipe[key] !== undefined) bank[key] = recipe[key];
  });
  return bank;
}

function validateInputs(recipe, entities) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new Error('generated bank recipe must be a mapping');
  for (const key of ['bankId', 'title', 'itemType', 'prompt', 'answerField']) {
    if (!nonEmptyString(recipe[key])) throw new Error(`generated bank recipe requires ${key}`);
  }
  if (!GENERATED_ITEM_TYPES.has(recipe.itemType)) throw new Error(`generated bank recipe has unknown itemType '${recipe.itemType}'`);
  if (!Array.isArray(entities) || entities.length === 0) throw new Error(`generated bank '${recipe.bankId}' requires entity rows`);
  if (recipe.itemType === 'region_click' && !nonEmptyString(recipe.asset)) {
    throw new Error(`generated bank '${recipe.bankId}' requires asset`);
  }
  if (recipe.distractorCount !== undefined && (!Number.isInteger(recipe.distractorCount) || recipe.distractorCount < 1)) {
    throw new Error(`generated bank '${recipe.bankId}' has invalid distractorCount`);
  }
}

function field(entity, key, context) {
  const value = entity?.[key];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${context} is missing field '${key}'`);
  }
  return String(value);
}

function fillTemplate(template, entity, context) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => field(entity, key, context));
}

function projectImage(spec, entity) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || !nonEmptyString(spec.kind)) {
    throw new Error('generated bank promptImage requires kind');
  }
  const image = { kind: spec.kind };
  for (const [outputField, entityField] of Object.entries(spec.fields ?? {})) {
    if (!nonEmptyString(outputField) || !nonEmptyString(entityField)) {
      throw new Error('generated bank promptImage fields must map names to entity fields');
    }
    image[outputField] = field(entity, entityField, 'promptImage');
  }
  return image;
}
