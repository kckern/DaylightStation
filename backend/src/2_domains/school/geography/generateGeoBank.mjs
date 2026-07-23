/**
 * Pure synthesis of a question bank from a deck recipe + an entity list.
 * One item per entity; stable ids `geo:{deckId}:{entityId}`; distractors
 * sampled deterministically (see distractors.mjs). No I/O.
 */
import { sampleDistractors } from './distractors.mjs';

const fill = (template, entity) => template.replace(/\{(\w+)\}/g, (_, k) => entity[k]);

export function generateGeoBank({ recipe, entities }) {
  const items = entities.map((e) => {
    const id = `geo:${recipe.deckId}:${e.id}`;
    const prompt = fill(recipe.prompt, e);
    const answer = String(e[recipe.answerField]);

    if (recipe.itemType === 'region_click') {
      return { id, type: 'region_click', prompt, asset: recipe.asset, answer };
    }

    const count = recipe.distractorCount ?? 3;
    const pool = entities.map((x) => String(x[recipe.distractorField]));
    const distractors = sampleDistractors({ pool, exclude: answer, count, seed: id });
    const values = [answer, ...distractors];

    if (recipe.itemType === 'multiple_choice') {
      return { id, type: 'multiple_choice', prompt, choices: values, answer };
    }
    if (recipe.itemType === 'asset_choice') {
      const labelOf = (val) => {
        const ent = entities.find((x) => String(x[recipe.answerField]) === val);
        return recipe.choiceLabelField ? String(ent[recipe.choiceLabelField]) : val;
      };
      const item = { id, type: 'asset_choice', prompt,
        choices: values.map((v) => ({ value: v, label: labelOf(v) })), answer };
      if (recipe.promptImage) {
        item.promptImage = { kind: recipe.promptImage.kind, iso: String(e[recipe.promptImage.isoField]) };
      }
      return item;
    }
    throw new Error(`generateGeoBank: unknown itemType "${recipe.itemType}"`);
  });

  return { id: `geo:${recipe.deckId}`, title: recipe.title, audience: 'generic', items };
}
