import { describe, it, expect } from 'vitest';
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';

describe('NotificationIntent', () => {
  it('constructs with required fields', () => {
    const intent = new NotificationIntent({
      title: 'Ceremony Due',
      body: 'Time for your daily capture',
      category: 'ceremony',
      urgency: 'normal',
    });
    expect(intent.title).toBe('Ceremony Due');
    expect(intent.body).toBe('Time for your daily capture');
    expect(intent.category).toBe('ceremony');
    expect(intent.urgency).toBe('normal');
  });

  it('accepts optional actions and metadata', () => {
    const intent = new NotificationIntent({
      title: 'Goal Alert',
      body: 'Marathon goal is behind pace',
      category: 'goal_update',
      urgency: 'high',
      actions: [
        { label: 'View Goal', url: '/life/plan/goals/run-marathon' },
        { label: 'Dismiss', action: 'dismiss' },
      ],
      metadata: { goalId: 'run-marathon' },
    });
    expect(intent.actions).toHaveLength(2);
    expect(intent.actions[0].label).toBe('View Goal');
    expect(intent.metadata.goalId).toBe('run-marathon');
  });

  it('throws on invalid category', () => {
    expect(() => new NotificationIntent({
      title: 'Test',
      body: 'Test',
      category: 'invalid_cat',
      urgency: 'normal',
    })).toThrow(/category/i);
  });

  it('throws on invalid urgency', () => {
    expect(() => new NotificationIntent({
      title: 'Test',
      body: 'Test',
      category: 'system',
      urgency: 'panic',
    })).toThrow(/urgency/i);
  });

  it('serializes to JSON', () => {
    const intent = new NotificationIntent({
      title: 'Test',
      body: 'Body',
      category: 'system',
      urgency: 'low',
    });
    const json = intent.toJSON();
    expect(json.title).toBe('Test');
    expect(json.category).toBe('system');
    expect(json.urgency).toBe('low');
  });

  it('defaults actions to empty array and metadata to empty object', () => {
    const intent = new NotificationIntent({
      title: 'Test',
      body: 'Body',
      category: 'system',
      urgency: 'normal',
    });
    expect(intent.actions).toEqual([]);
    expect(intent.metadata).toEqual({});
  });
});

describe('NotificationPreference', () => {
  const prefConfig = {
    ceremony: {
      normal: ['telegram'],
      high: ['telegram', 'app'],
    },
    drift_alert: {
      normal: ['app'],
      high: ['telegram', 'app'],
      critical: ['telegram', 'app', 'email'],
    },
    goal_update: {
      normal: ['app'],
    },
    system: {
      normal: ['app'],
      critical: ['telegram'],
    },
  };

  it('constructs from config object', () => {
    const pref = new NotificationPreference(prefConfig);
    expect(pref).toBeTruthy();
  });

  it('resolves channels for exact category+urgency match', () => {
    const pref = new NotificationPreference(prefConfig);
    expect(pref.getChannelsFor('ceremony', 'normal')).toEqual(['telegram']);
    expect(pref.getChannelsFor('drift_alert', 'critical')).toEqual(['telegram', 'app', 'email']);
  });

  it('falls back to normal urgency when specific urgency not configured', () => {
    const pref = new NotificationPreference(prefConfig);
    // goal_update only has 'normal' — asking for 'high' should fall back to 'normal'
    expect(pref.getChannelsFor('goal_update', 'high')).toEqual(['app']);
  });

  it('returns ["app"] as ultimate fallback for unknown category', () => {
    const pref = new NotificationPreference(prefConfig);
    expect(pref.getChannelsFor('unknown_category', 'normal')).toEqual(['app']);
  });

  it('returns ["app"] for empty config', () => {
    const pref = new NotificationPreference({});
    expect(pref.getChannelsFor('ceremony', 'high')).toEqual(['app']);
  });

  it('serializes to JSON round-trip', () => {
    const pref = new NotificationPreference(prefConfig);
    const json = pref.toJSON();
    const restored = new NotificationPreference(json);
    expect(restored.getChannelsFor('ceremony', 'normal')).toEqual(['telegram']);
  });
});
