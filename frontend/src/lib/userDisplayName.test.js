import { describe, it, expect } from 'vitest';
import {
  resolveUserDisplayName,
  hasFamilyContext,
  shouldPreferGroupLabels,
} from './userDisplayName.js';

const dad = { id: 'kckern', name: 'KC Kern', group_label: 'Dad' };
const mom = { id: 'elizabeth', name: 'Elizabeth', group_label: 'Mom' };
const kid = { id: 'felix', name: 'Felix' };

describe('resolveUserDisplayName — abstract family context', () => {
  it('uses the relational label when the family/kids context is present', () => {
    expect(resolveUserDisplayName(dad, { familyContext: true }).displayName).toBe('Dad');
  });
  it('uses the full name when there is no family context', () => {
    expect(resolveUserDisplayName(dad, { familyContext: false }).displayName).toBe('KC Kern');
  });
  it('a child (no relational label) always resolves to their name', () => {
    expect(resolveUserDisplayName(kid, { familyContext: true }).displayName).toBe('Felix');
  });
  it('stays backward-compatible with the legacy preferGroupLabels flag', () => {
    expect(resolveUserDisplayName(dad, { preferGroupLabels: true }).displayName).toBe('Dad');
  });
  it('defaults to the full name with no context', () => {
    expect(resolveUserDisplayName(dad).displayName).toBe('KC Kern');
  });
});

describe('hasFamilyContext — are the kids in the scene?', () => {
  it('true when labeled adults and children are present together', () => {
    expect(hasFamilyContext([dad, mom, kid])).toBe(true);
  });
  it('false for adults alone (no kids → full names read better)', () => {
    expect(hasFamilyContext([dad, mom])).toBe(false);
  });
  it('false for an empty or non-array input', () => {
    expect(hasFamilyContext([])).toBe(false);
    expect(hasFamilyContext(null)).toBe(false);
  });
});

describe('moved device-centric helpers still work (back-compat re-export)', () => {
  it('shouldPreferGroupLabels counts 2+ present HR devices', () => {
    expect(shouldPreferGroupLabels([
      { type: 'heart_rate' }, { type: 'heart_rate' },
    ])).toBe(true);
    expect(shouldPreferGroupLabels([{ type: 'heart_rate' }])).toBe(false);
  });
});
