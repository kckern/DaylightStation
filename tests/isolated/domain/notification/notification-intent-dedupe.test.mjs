import { describe, it, expect } from 'vitest';
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';

describe('NotificationIntent.dedupeKey', () => {
  it('stores and serializes an explicit dedupeKey', () => {
    const i = new NotificationIntent({ title: 'x', body: 'y', category: 'ceremony', urgency: 'normal', dedupeKey: 'ceremony:unit_intention:2026-07-17' });
    expect(i.dedupeKey).toBe('ceremony:unit_intention:2026-07-17');
    expect(i.toJSON().dedupeKey).toBe('ceremony:unit_intention:2026-07-17');
  });
  it('is undefined when not provided (back-compatible)', () => {
    const i = new NotificationIntent({ title: 'x', body: 'y', category: 'system', urgency: 'normal' });
    expect(i.dedupeKey).toBeUndefined();
  });
});
