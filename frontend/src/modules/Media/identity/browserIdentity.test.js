import { describe, expect, it } from 'vitest';
import {
  createBrowserIdentity,
  renameBrowserIdentity,
} from './browserIdentity.js';

describe('browser identity', () => {
  it('persists one stable routable identity shape across reloads', () => {
    const storage = new Map();
    const store = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    };
    const first = createBrowserIdentity({
      storage: store,
      randomUuid: () => '11111111-2222-4333-8444-555555555555',
      now: () => new Date('2026-09-22T12:00:00.000Z'),
    });
    const reloaded = createBrowserIdentity({
      storage: store,
      randomUuid: () => 'different',
      now: () => new Date('2026-09-22T12:01:00.000Z'),
    });

    expect(first).toEqual({
      clientId: '11111111-2222-4333-8444-555555555555',
      deviceId: 'browser:11111111-2222-4333-8444-555555555555',
      name: 'Browser 11111111',
      connectedAt: '2026-09-22T12:00:00.000Z',
    });
    expect(reloaded).toEqual(first);
  });

  it('keeps rename routing on the stable id and makes a colliding name unique', () => {
    const identity = {
      clientId: '11111111-2222-4333-8444-555555555555',
      deviceId: 'browser:11111111-2222-4333-8444-555555555555',
      name: 'Browser 11111111',
      connectedAt: '2026-09-22T12:00:00.000Z',
    };
    const renamed = renameBrowserIdentity(identity, {
      name: 'Kitchen tablet',
      room: 'Kitchen',
      existingNames: ['Kitchen tablet'],
    });

    expect(renamed).toMatchObject({
      clientId: identity.clientId,
      deviceId: identity.deviceId,
      name: 'Kitchen tablet (11111111)',
      room: 'Kitchen',
      connectedAt: identity.connectedAt,
    });
  });

  it('repairs a stored deviceId that does not belong to the persisted clientId', () => {
    const values = new Map([['media-app.browser-identity', JSON.stringify({
      clientId: 'stable-client', deviceId: 'living-room-tv', name: 'Kitchen tablet',
      connectedAt: '2026-09-22T12:00:00.000Z',
    })]]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    expect(createBrowserIdentity({ storage })).toMatchObject({
      clientId: 'stable-client', deviceId: 'browser:stable-client', name: 'Kitchen tablet',
    });
  });

  it('keeps suffixing until the selected name is unique among known browsers', () => {
    const identity = {
      clientId: '12345678-aaaa', deviceId: 'browser:12345678-aaaa', name: 'Old',
      connectedAt: '2026-09-22T00:00:00.000Z',
    };
    expect(renameBrowserIdentity(identity, {
      name: 'Kitchen', existingNames: ['Kitchen', 'Kitchen (12345678)'],
    }).name).toBe('Kitchen (12345678-2)');
  });
});
