import { describe, expect, it } from 'vitest';
import { auditWireSchema, decodeAudit, normalizeAuditRepairs } from './NutritionAuditor.mjs';
import { assertSchema } from '#adapters/agents/standardSchema.mjs';

const result = changes => ({ summary: 'Verified panel', repairs: [{
  mode: 'verified', confidence: null, reason: 'Panel', evidenceIds: ['panel'],
  logUuid: null, expectedLogVersion: null, createGroups: [],
  updates: [{ id: 'food', expectedVersion: 1, changes }],
}], questions: [] });

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
