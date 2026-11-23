import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { screenOrUserViewerFor, viewerFor } from './participantHttp.mjs';
import { screenIdentityResolver } from '../middleware/screenIdentityResolver.mjs';
import { createParticipantLaunchesRouter } from '../../../../__capabilities/content-catalog/server/api/participantLaunches.mjs';

describe('screens never sign in; only declared screens and signed-in people are viewers', () => {
  it('names a declared screen as itself, with the authority the network grants', () => {
    expect(screenOrUserViewerFor({ screen: { id: 'livingroom-tv' }, roles: ['sysadmin'] }, 'default'))
      .toEqual({ role: 'host', participant_id: 'screen:livingroom-tv', householdId: 'default' });
  });
  it('keeps a signed-in person as themselves', () => {
    expect(screenOrUserViewerFor({ user: { sub: 'kckern' }, roles: ['sysadmin'] }, 'default').participant_id).toBe('kckern');
  });
  it('refuses a caller that is neither, even with host roles from the network', () => {
    expect(() => screenOrUserViewerFor({ roles: ['sysadmin'] }, 'default')).toThrow('Authentication required');
  });
  it('refuses another household', () => {
    expect(() => screenOrUserViewerFor({ screen: { id: 'tv' }, householdId: 'other', roles: ['sysadmin'] }, 'default')).toThrow('Household scope mismatch');
  });
  it('a screen is never a sign-in: editing viewers still refuse it', () => {
    expect(() => viewerFor({ screen: { id: 'livingroom-tv' }, roles: ['sysadmin'] }, 'default', true)).toThrow('Authentication required');
  });
});

describe('screenIdentityResolver', () => {
  const run = (req, declared = () => true) => { screenIdentityResolver({ isDeclaredScreen: declared })(req, {}, () => {}); return req.screen; };
  const base = { isLocal: true, deviceIdSource: 'header', deviceId: 'fleet:livingroom-tv' };
  it('identifies a declared screen on the house network', () => expect(run({ ...base })).toEqual({ id: 'livingroom-tv' }));
  it('ignores an undeclared device', () => expect(run({ ...base }, () => false)).toBeUndefined());
  it('ignores a browser id', () => expect(run({ ...base, deviceId: 'browser:abc' })).toBeUndefined());
  it('ignores a device id guessed from the user agent', () => expect(run({ ...base, deviceIdSource: 'user-agent' })).toBeUndefined());
  it('ignores callers off the house network', () => expect(run({ ...base, isLocal: false })).toBeUndefined());
  it('does nothing for a signed-in person', () => expect(run({ ...base, user: { sub: 'kckern' } })).toBeUndefined());
  it('fails closed when the registry cannot be read', () => expect(run({ ...base }, () => { throw new Error('unreadable'); })).toBeUndefined());
});

describe('participant-launch routes', () => {
  const service = { inspect: async ({ viewer }) => ({ viewer }) };
  const app = (setup) => {
    const a = express(); a.use(express.json());
    a.use((req, _res, next) => { Object.assign(req, setup); next(); });
    a.use(createParticipantLaunchesRouter({ householdId: 'default', service, logger: null }));
    return a;
  };
  const body = { ref: { schema: 'participant-launch-ref/v1', provider: 'agenda', ref: 'x' }, action: 'open' };
  it('refuses a signed-out caller that is not a declared screen, even from a private address', async () => {
    const res = await request(app({ roles: ['sysadmin'], isLocal: true })).post('/inspect').send(body);
    expect([401, 404]).toContain(res.status);
  });
  it('accepts a declared screen without sign-in', async () => {
    const res = await request(app({ roles: ['sysadmin'], isLocal: true, screen: { id: 'livingroom-tv' } })).post('/inspect').send(body);
    expect(res.status).toBe(200);
    expect(res.body.viewer.participant_id).toBe('screen:livingroom-tv');
  });
});
