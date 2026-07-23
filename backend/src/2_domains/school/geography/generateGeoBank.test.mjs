import { describe, it, expect } from 'vitest';
import { generateGeoBank } from './generateGeoBank.mjs';
import { validateQuestionBank } from '../questionBankValidation.mjs';

const states = [
  { id: 'NV', name: 'Nevada', capital: 'Carson City', region_id: 'NV' },
  { id: 'CA', name: 'California', capital: 'Sacramento', region_id: 'CA' },
  { id: 'OR', name: 'Oregon', capital: 'Salem', region_id: 'OR' },
  { id: 'WA', name: 'Washington', capital: 'Olympia', region_id: 'WA' },
];
const world = [
  { id: 'FR', name: 'France', capital: 'Paris', iso: 'FR' },
  { id: 'DE', name: 'Germany', capital: 'Berlin', iso: 'DE' },
  { id: 'IT', name: 'Italy', capital: 'Rome', iso: 'IT' },
  { id: 'ES', name: 'Spain', capital: 'Madrid', iso: 'ES' },
];

it('region_click deck: one item per entity, stable ids, valid bank', () => {
  const recipe = { deckId: 'us-state-locations', title: 'Loc', itemType: 'region_click',
    asset: 'us-states', prompt: 'Click {name}', answerField: 'region_id', available: true };
  const bank = generateGeoBank({ recipe, entities: states });
  expect(bank.id).toBe('geo:us-state-locations');
  expect(bank.audience).toBe('generic');
  expect(bank.items).toHaveLength(4);
  expect(bank.items[0]).toMatchObject({ id: 'geo:us-state-locations:NV', type: 'region_click',
    prompt: 'Click Nevada', asset: 'us-states', answer: 'NV' });
  expect(validateQuestionBank(bank).ok).toBe(true);
});

it('multiple_choice deck: answer present in choices, distractors from pool', () => {
  const recipe = { deckId: 'us-state-capitals', title: 'Cap', itemType: 'multiple_choice',
    prompt: 'Capital of {name}?', answerField: 'capital', distractorField: 'capital',
    distractorCount: 3, available: true };
  const bank = generateGeoBank({ recipe, entities: states });
  const nv = bank.items.find((i) => i.id === 'geo:us-state-capitals:NV');
  expect(nv.choices).toContain('Carson City');
  expect(nv.answer).toBe('Carson City');
  expect(nv.choices).toHaveLength(4);
  expect(validateQuestionBank(bank).ok).toBe(true);
});

it('asset_choice deck: image prompt + labeled choices, valid', () => {
  const recipe = { deckId: 'world-flags', title: 'Flags', itemType: 'asset_choice',
    prompt: 'Whose flag?', promptImage: { kind: 'flag', isoField: 'iso' },
    answerField: 'id', choiceLabelField: 'name', distractorField: 'id',
    distractorCount: 3, available: true };
  const bank = generateGeoBank({ recipe, entities: world });
  const fr = bank.items.find((i) => i.id === 'geo:world-flags:FR');
  expect(fr.promptImage).toEqual({ kind: 'flag', iso: 'FR' });
  expect(fr.answer).toBe('FR');
  expect(fr.choices).toHaveLength(4);
  expect(fr.choices.find((c) => c.value === 'FR').label).toBe('France');
  expect(validateQuestionBank(bank).ok).toBe(true);
});

it('is deterministic across runs', () => {
  const recipe = { deckId: 'us-state-capitals', title: 'Cap', itemType: 'multiple_choice',
    prompt: 'Capital of {name}?', answerField: 'capital', distractorField: 'capital',
    distractorCount: 3, available: true };
  const a = generateGeoBank({ recipe, entities: states });
  const b = generateGeoBank({ recipe, entities: states });
  expect(a).toEqual(b);
});
