import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDITOR_SETTINGS, blockedKinds, describeDisabled, effectiveSettings, permissionKindsOf, validateSettingsChange } from './auditorPolicy.mjs';

const update = changes => ({ id: 'a', expectedVersion: 1, changes });
const kinds = proposal => [...permissionKindsOf({ mode: 'verified', updates: [], ...proposal })].sort();

describe('effectiveSettings', () => {
  it('keeps every default not overridden', () => {
    const settings = effectiveSettings({ enabled: true });
    expect(settings).toEqual({ ...DEFAULT_AUDITOR_SETTINGS, enabled: true });
    expect(settings.permissions).not.toBe(DEFAULT_AUDITOR_SETTINGS.permissions);
  });
  it('merges triggers and permissions per key', () => {
    const settings = effectiveSettings({ permissions: { nutrients: false }, triggers: { artwork: false } });
    expect(settings.permissions).toEqual({ ...DEFAULT_AUDITOR_SETTINGS.permissions, nutrients: false });
    expect(settings.triggers).toEqual({ ...DEFAULT_AUDITOR_SETTINGS.triggers, artwork: false });
  });
  it('drops unknown keys at every level', () => {
    const settings = effectiveSettings({ bogus: 1, permissions: { fly: false }, triggers: { moon: false } });
    expect(settings).toEqual(DEFAULT_AUDITOR_SETTINGS);
  });
  it('falls back to the default for an invalid stored value', () => {
    expect(effectiveSettings({ model: 'gpt-9', minGapMinutes: 7, dailyCapUsd: null })).toEqual({ ...DEFAULT_AUDITOR_SETTINGS, dailyCapUsd: null });
  });
  it('handles missing stored settings', () => {
    expect(effectiveSettings()).toEqual(DEFAULT_AUDITOR_SETTINGS);
  });
});

describe('validateSettingsChange', () => {
  it.each([
    [{ model: 'gpt-9' }], [{ minGapMinutes: 7 }], [{ permissions: { fly: true } }], [{ dailyCapUsd: -1 }],
    [{ dailyCapUsd: 51 }], [{ dailyCapUsd: Infinity }], [{ enabled: 'yes' }], [{ bogus: 1 }],
    [{ triggers: { artwork: 'no' } }], [{ triggers: [] }], [{ permissions: null }],
  ])('rejects %j with status 400', changes => {
    let error;
    try { validateSettingsChange(changes); } catch (caught) { error = caught; }
    expect(error?.status).toBe(400);
  });
  it('accepts a valid change, including no cap', () => {
    expect(() => validateSettingsChange({ dailyCapUsd: null })).not.toThrow();
    expect(() => validateSettingsChange({ model: 'gpt-4.1', minGapMinutes: 60, dryRun: false,
      triggers: { scaleReconcile: false }, permissions: { nutrients: false } })).not.toThrow();
  });
});

describe('permissionKindsOf', () => {
  it('classifies changed fields', () => {
    expect(kinds({ updates: [update({ icon: 'apple' })] })).toEqual(['artwork']);
    expect(kinds({ updates: [update({ calories: 90 })] })).toEqual(['nutrients']);
    expect(kinds({ updates: [update({ amount: 2, grams: 80 })] })).toEqual(['portion']);
    expect(kinds({ updates: [update({ name: 'Apple' }), update({ date: '2026-09-05' })] })).toEqual(['mealPlacement', 'naming']);
  });
  it('classifies modes and new groups', () => {
    expect(kinds({ mode: 'complete' })).toEqual(['completeCaptures']);
    expect(kinds({ mode: 'estimate', updates: [update({ protein: 3 })] })).toEqual(['estimates', 'nutrients']);
    expect(kinds({ createGroups: [{ children: [{ id: 'a', expectedVersion: 1 }] }] })).toEqual(['grouping']);
  });
  it('reads the list-shaped wire format too', () => {
    expect(kinds({ updates: [update([{ field: 'icon', value: 'apple' }])] })).toEqual(['artwork']);
  });
});

describe('blockedKinds / describeDisabled', () => {
  it('lists only the disabled kinds a proposal touches', () => {
    const proposal = { mode: 'verified', updates: [update({ calories: 90, icon: 'apple' })] };
    expect(blockedKinds(proposal, { nutrients: false, portion: false })).toEqual(['nutrients']);
    expect(blockedKinds(proposal, DEFAULT_AUDITOR_SETTINGS.permissions)).toEqual([]);
    expect(blockedKinds(proposal, undefined)).toEqual([]);
  });
  it('is empty when nothing is disabled', () => {
    expect(describeDisabled(DEFAULT_AUDITOR_SETTINGS.permissions)).toBe('');
    expect(describeDisabled(undefined)).toBe('');
  });
  it('names disabled kinds in one sentence', () => {
    const text = describeDisabled({ ...DEFAULT_AUDITOR_SETTINGS.permissions, nutrients: false, portion: false });
    expect(text).toBe('You are not permitted to change: portions, nutrient values. Do not propose these; leave them as they are.');
  });
  it('forbids questions', () => {
    expect(describeDisabled({ questions: false })).toBe('Do not ask questions.');
    expect(describeDisabled({ artwork: false, questions: false })).toMatch(/^You are not permitted to change: icons and photos\. .* Do not ask questions\.$/);
  });
});
