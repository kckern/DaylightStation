/**
 * The relay staleness alert's channel routing. A dead hardware relay is only
 * worth detecting if the alert LEAVES the house — the kitchen board sat dark for
 * 12 days precisely because nothing told anyone, and an app-only card on a
 * dashboard nobody is looking at reproduces that failure exactly.
 *
 * Category 'system' at NORMAL urgency stays in-app (boot notices, routine
 * chatter). HIGH is the one that must reach a phone.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES } from '#composition/modules/notifications.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';

describe('system notification routing', () => {
  it("category 'system' at high urgency reaches telegram", () => {
    const prefs = new NotificationPreference(DEFAULT_PREFERENCES);
    expect(prefs.getChannelsFor('system', 'high')).toEqual(['telegram', 'app']);
  });

  it("category 'system' at normal urgency stays in-app", () => {
    const prefs = new NotificationPreference(DEFAULT_PREFERENCES);
    expect(prefs.getChannelsFor('system', 'normal')).toEqual(['app']);
  });
});
