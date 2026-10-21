import { describe, it, expect } from 'vitest';
import { resolveSupervisorIds, classifySupervision, isGovernedChildId } from './supervision.mjs';

const profiles = new Map([
  ['parent-a', { type: 'owner', household_id: 'default' }],
  ['parent-b', { type: 'owner' }],
  ['sitter', { type: 'family_member', roles: ['guardian'] }],
  ['child-a', { type: 'family_member' }],
  ['other-house', { type: 'owner', household_id: 'cabin' }],
]);

describe('resolveSupervisorIds', () => {
  it('owners and guardians of the household supervise; children and other households do not', () => {
    expect(resolveSupervisorIds(profiles, 'default', 'default')).toEqual(['parent-a', 'parent-b', 'sitter']);
  });
  it('feeds classifySupervision', () => {
    const supervisorIds = resolveSupervisorIds(profiles, 'default', 'default');
    expect(classifySupervision({ participantIds: ['child-a', 'parent-b'], supervisorIds }).supervised).toBe(true);
    expect(classifySupervision({ participantIds: ['child-a'], supervisorIds }).supervised).toBe(false);
  });
});

describe('isGovernedChildId', () => {
  const lists = { supervisorIds: ['Parent'], exemptIds: [' Rider '] };
  it('is false for supervisors and exempt ids, normalized', () => {
    expect(isGovernedChildId('parent', lists)).toBe(false);
    expect(isGovernedChildId('RIDER', lists)).toBe(false);
  });
  it('is true for anyone else and false for empty ids', () => {
    expect(isGovernedChildId('child', lists)).toBe(true);
    expect(isGovernedChildId('', lists)).toBe(false);
    expect(isGovernedChildId(null, lists)).toBe(false);
    expect(isGovernedChildId('child')).toBe(true);
  });
});
