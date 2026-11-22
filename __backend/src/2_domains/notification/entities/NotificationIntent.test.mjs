import { describe, it, expect } from 'vitest';
import { NotificationIntent } from './NotificationIntent.mjs';
import { NotificationAction } from '../value-objects/NotificationAction.mjs';
import { NotificationPresentation } from '../value-objects/NotificationPresentation.mjs';

const base = { title: 'T', body: 'B', category: 'approval', urgency: 'high' };

describe('NotificationIntent rich fields', () => {
  it('normalizes plain actions to NotificationAction', () => {
    const i = new NotificationIntent({ ...base, actions: [{ id: 'A', label: 'Go' }] });
    expect(i.actions[0]).toBeInstanceOf(NotificationAction);
  });
  it('normalizes a plain presentation', () => {
    const i = new NotificationIntent({ ...base, presentation: { tag: 't' } });
    expect(i.presentation).toBeInstanceOf(NotificationPresentation);
    expect(i.presentation.tag).toBe('t');
  });
  it('derives presentation from legacy metadata.pushData when none is given', () => {
    const i = new NotificationIntent({ ...base, metadata: { pushData: { tag: 'x', alert_once: true } } });
    expect(i.presentation).toMatchObject({ tag: 'x', alertOnce: true });
  });
  it('carries id and recipient, recipient defaulting from metadata.username', () => {
    const i = new NotificationIntent({ ...base, id: 'n1', metadata: { username: 'u1' } });
    expect(i.id).toBe('n1');
    expect(i.recipient).toEqual({ username: 'u1' });
  });
  it('accepts the household_alert category', () => {
    expect(() => new NotificationIntent({ ...base, category: 'household_alert' })).not.toThrow();
  });
});

describe('NotificationIntent legacy in-app actions', () => {
  it('keeps an action without an id as given', () => {
    const legacy = { label: 'Open the console', action: 'open', data: { url: '/school/teacher' } };
    const i = new NotificationIntent({ ...base, actions: [legacy, { id: 'A', label: 'Go' }] });
    expect(i.actions[0]).toBe(legacy);
    expect(i.actions[1]).toBeInstanceOf(NotificationAction);
  });
});
