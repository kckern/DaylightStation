import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createMediaHouseFixture, HOUSE_FIXTURE_ROUTINE } from './media-house-fixture.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const liveness = { getLastSnapshot: () => null };
const make = () => createMediaHouseFixture({ deviceId: 'acceptance-media', name: 'Acceptance receiver', room: 'Virtual browser', deviceLiveness: liveness, logger: quiet });

describe('media house fixture', () => {
  it('serves only house paths, with the receiver as the one configured screen', async () => {
    const house = make();
    expect(house.handles('/api/v1/media/screens')).toBe(true);
    expect(house.handles('/api/v1/media/routines/history')).toBe(true);
    expect(house.handles('/api/v1/media/started-by')).toBe(true);
    expect(house.handles('/api/v1/media/config')).toBe(false);
    const res = await request(house.app).get('/screens').expect(200);
    expect(res.body.screens.map((s) => [s.id, s.name])).toEqual([['fleet:acceptance-media', 'Acceptance receiver']]);
  });

  it('uses the real registry rules: announce, taken names, and the routine warning', async () => {
    const house = make();
    await request(house.app).post('/screens/announce').send({ id: 'browser:a', name: 'Kitchen tablet' }).expect(200);
    const taken = await request(house.app).patch('/screens/fleet%3Aacceptance-media').send({ name: 'Kitchen tablet' }).expect(409);
    expect(taken.body.code).toBe('ROUTINES_TARGET');
    expect(taken.body.routines).toEqual([expect.objectContaining({ id: HOUSE_FIXTURE_ROUTINE.id })]);
    const collision = await request(house.app).patch('/screens/fleet%3Aacceptance-media').send({ name: 'Kitchen tablet', confirm: true }).expect(409);
    expect(collision.body).toMatchObject({ code: 'NAME_TAKEN', suggestion: expect.any(String) });
  });

  it('has a started and a failed routine run, the failure flagged ahead of time', async () => {
    const house = make();
    const history = await request(house.app).get('/routines/history').expect(200);
    expect(history.body.items.map((r) => r.outcome)).toEqual(['failed', 'started']);
    expect(history.body.items[0].reason).toMatch(/Acceptance receiver/);
    const flags = await request(house.app).get('/routines/flags').expect(200);
    expect(flags.body.items).toEqual([expect.objectContaining({ problem: 'last-start-failed', severity: 'warn' })]);
  });
});
