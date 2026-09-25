import { describe, expect, it } from 'vitest';
import { auditWireSchema, decodeAudit, normalizeAuditRepairs } from './NutritionAuditor.mjs';
import { assertSchema } from '#adapters/agents/standardSchema.mjs';

const result = changes => ({ summary: 'Verified panel', repairs: [{
  mode: 'verified', confidence: null, reason: 'Panel', evidenceIds: ['panel'],
  logUuid: null, expectedLogVersion: null, createGroups: [],
  updates: [{ id: 'food', expectedVersion: 1, changes }],
}], questions: [] });

describe('Auditor questions worth asking', () => {
  const choice = (label, updates = [], createGroups = []) => ({ label, repair: {
    mode: updates.length || createGroups.length ? 'verified' : 'complete', confidence: null, reason: 'r', evidenceIds: ['e'],
    logUuid: null, expectedLogVersion: null, createGroups, updates } });
  const q = (question, choices) => ({ question, entryIds: ['food'], choices });
  const icons = { has: () => true, resolve: () => true };

  it('drops a question whose answers change nothing (the auditor decides, it does not ask)', () => {
    const audit = normalizeAuditRepairs({ summary: '', repairs: [], questions: [
      q('Which icon fits the Poke Bowl group picture best?', [choice('🐟'), choice('🥗')]),
      q('Is the White Rice 1 cup or ¾ cup?', [
        choice('1 cup (186 g)', [{ id: 'food', expectedVersion: 1, changes: { grams: 186 } }]),
        choice('¾ cup (140 g)', [{ id: 'food', expectedVersion: 1, changes: { grams: 140 } }]),
      ]),
    ] }, icons);
    expect(audit.questions.map(x => x.question)).toEqual(['Is the White Rice 1 cup or ¾ cup?']);
  });

  it("drops an artwork-only question: icons are the auditor's call", () => {
    const audit = normalizeAuditRepairs({ summary: '', repairs: [], questions: [
      q('Which icon?', [
        choice('Rice bowl', [{ id: 'food', expectedVersion: 1, changes: { icon: 'rice-bowl' } }]),
        choice('Lantern', [{ id: 'food', expectedVersion: 1, changes: { icon: 'lantern' } }]),
      ]),
    ] }, icons);
    expect(audit.questions).toEqual([]);
  });

  it('the wire schema holds questions short, with 2–3 concrete choices', () => {
    const qs = auditWireSchema.properties.questions.items.properties;
    expect(qs.question.maxLength).toBeLessThanOrEqual(140);
    expect(qs.choices.minItems).toBe(2);
    expect(qs.choices.items.properties.label.maxLength).toBeLessThanOrEqual(40);
  });
});

describe('Auditor strict structured output', () => {
  it('keeps supported nutrients when a separate cosmetic suggestion is unavailable', () => {
    const audit = decodeAudit(result([{ field: 'sugar', value: 4 }]));
    audit.repairs[0].updates.push({ id: 'food', expectedVersion: 1, changes: { icon: '🍽️', sodium: 60 } });
    expect(normalizeAuditRepairs(audit, { has: () => false }).repairs[0].updates).toEqual([
      { id: 'food', expectedVersion: 1, changes: { sugar: 4, sodium: 60 } },
    ]);
    audit.repairs[0].updates.push({ id: 'food', expectedVersion: 1, changes: { sugar: 8 } });
    expect(() => normalizeAuditRepairs(audit, { has: () => false })).toThrow('Conflicting');
  });
  it('hands refused artwork to the remediation queue instead of dropping it', () => {
    const audit = decodeAudit(result([{ field: 'icon', value: 'not-a-slug' }, { field: 'sugar', value: 4 }]));
    const dropped = [];
    const kept = normalizeAuditRepairs(audit, { has: () => false }, {}, drop => dropped.push(drop));
    expect(kept.repairs[0].updates[0].changes).toEqual({ sugar: 4 });
    expect(dropped).toEqual([{ entryId: 'food', icon: 'not-a-slug' }]);
  });
  it('requires every object key without unsupported sparse-object constraints', () => {
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      expect(value).not.toHaveProperty('minProperties');
      if (value.type === 'object') {
        expect(value.additionalProperties).toBe(false);
        expect([...value.required].sort()).toEqual(Object.keys(value.properties).sort());
      }
      Object.values(value).forEach(walk);
    };
    walk(auditWireSchema);
  });
  it('preserves explicit null without inventing changes to omitted fields', () => {
    const wire = result([{ field: 'grams', value: 170 }, { field: 'sugar', value: null }]);
    assertSchema(wire, auditWireSchema);
    expect(decodeAudit(wire).repairs[0].updates[0].changes).toEqual({ grams: 170, sugar: null });
  });
  it('rejects duplicate fields, empty patches, and mismatched value types', () => {
    expect(() => decodeAudit(result([{ field: 'grams', value: 170 }, { field: 'grams', value: 14 }]))).toThrow('repeated');
    expect(() => assertSchema(result([]), auditWireSchema)).toThrow();
    expect(() => assertSchema(result([{ field: 'grams', value: 'unknown' }]), auditWireSchema)).toThrow();
  });
});
