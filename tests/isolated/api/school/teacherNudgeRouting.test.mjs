/**
 * The teacher-backlog nudge's channel routing (M6 gate 1): category
 * 'school' MUST reach telegram — app-only routing defeats the nudge's
 * entire premise (a parent who is not looking at a screen).
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES } from '#composition/modules/notifications.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';

describe('school notification routing', () => {
  it("category 'school' routes to telegram + app at both urgencies", () => {
    const prefs = new NotificationPreference(DEFAULT_PREFERENCES);
    expect(prefs.getChannelsFor('school', 'normal')).toEqual(['telegram', 'app']);
    expect(prefs.getChannelsFor('school', 'high')).toEqual(['telegram', 'app']);
  });

  it('an unknown category still falls back to app-only (the trap gate 1 fixed)', () => {
    const prefs = new NotificationPreference(DEFAULT_PREFERENCES);
    expect(prefs.getChannelsFor('mystery', 'normal')).toEqual(['app']);
  });
});
