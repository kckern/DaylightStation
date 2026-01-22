import { describe, it, expect } from '@jest/globals';

/**
 * Tests the userGroupLabelMap indexing logic from FitnessContext.jsx
 * The map should be indexed by BOTH id/profileId AND display name
 * so lookups work regardless of which key is used.
 */
describe('userGroupLabelMap indexing logic', () => {
  // Extracted logic for testing - mirrors FitnessContext.jsx implementation
  function buildUserGroupLabelMap(usersConfig) {
    const map = new Map();
    const registerGroupLabels = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        if (!entry?.name) return;
        const id = entry.id || entry.profileId || entry.name;
        const label = entry.group_label ?? entry.groupLabel ?? null;

        // Index by ID/profileId
        if (id && label && !map.has(id)) {
          map.set(id, label);
        }

        // Also index by display name for lookups that use name instead of ID
        if (entry.name && label && entry.name !== id && !map.has(entry.name)) {
          map.set(entry.name, label);
        }
      });
    };
    registerGroupLabels(usersConfig?.primary);
    registerGroupLabels(usersConfig?.secondary);
    registerGroupLabels(usersConfig?.family);
    registerGroupLabels(usersConfig?.friends);
    registerGroupLabels(usersConfig?.guests);
    return map;
  }

  it('indexes by id when id differs from name', () => {
    const config = {
      primary: [
        { id: 'kckern', name: 'KC Kern', group_label: 'Dad' }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    expect(map.get('kckern')).toBe('Dad');
  });

  it('indexes by display name when it differs from id', () => {
    const config = {
      primary: [
        { id: 'kckern', name: 'KC Kern', group_label: 'Dad' }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    // This is the key fix - name-based lookup should also work
    expect(map.get('KC Kern')).toBe('Dad');
  });

  it('handles entries where id and name are the same', () => {
    const config = {
      primary: [
        { id: 'guest1', name: 'guest1', group_label: 'Guest' }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    expect(map.get('guest1')).toBe('Guest');
    // Should not duplicate entry
    expect(map.size).toBe(1);
  });

  it('handles multiple user categories', () => {
    const config = {
      primary: [
        { id: 'kckern', name: 'KC Kern', group_label: 'Dad' }
      ],
      family: [
        { id: 'spouse', name: 'Jane Kern', group_label: 'Mom' }
      ],
      guests: [
        { id: 'visitor', name: 'Bob', group_label: null }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    expect(map.get('kckern')).toBe('Dad');
    expect(map.get('KC Kern')).toBe('Dad');
    expect(map.get('spouse')).toBe('Mom');
    expect(map.get('Jane Kern')).toBe('Mom');
    // No label for visitor
    expect(map.has('visitor')).toBe(false);
  });

  it('prefers groupLabel camelCase when snake_case is missing', () => {
    const config = {
      primary: [
        { id: 'user1', name: 'User One', groupLabel: 'U1' }
      ]
    };
    const map = buildUserGroupLabelMap(config);

    expect(map.get('user1')).toBe('U1');
    expect(map.get('User One')).toBe('U1');
  });

  it('returns empty map for null/undefined config', () => {
    expect(buildUserGroupLabelMap(null).size).toBe(0);
    expect(buildUserGroupLabelMap(undefined).size).toBe(0);
    expect(buildUserGroupLabelMap({}).size).toBe(0);
  });
});
