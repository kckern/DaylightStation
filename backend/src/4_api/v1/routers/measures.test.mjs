import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMeasuresRouter } from './measures.mjs';
import { MeasureRegistry } from '#apps/measures/MeasureRegistry.mjs';
import { createFitnessRingsProvider } from '#apps/measures/fitnessRingsProvider.mjs';

const TZ = 'America/Los_Angeles';
// Wednesday 2026-08-26, 12:00 local.
const NOW = new Date('2026-08-26T19:00:00Z');

function app({ sessions = [], roster = [{ id: 'milo' }, { id: 'felix' }] } = {}) {
  const registry = new MeasureRegistry().register(createFitnessRingsProvider({
    timezone: TZ,
    sessions: { listSessions: async () => sessions },
  }));
  const a = express();
  a.use('/measures', createMeasuresRouter({
    registry, learners: async () => roster, timezone: TZ, clock: () => NOW,
  }));
  return a;
}

const session = (isoStart, participants) => ({
  startTime: Date.parse(isoStart), date: isoStart.slice(0, 10), participants,
});

describe('GET /measures/weekly', () => {
  it('returns the Sunday→Saturday window containing today', async () => {
    const res = await request(app()).get('/measures/weekly');
    expect(res.status).toBe(200);
    expect(res.body.window).toEqual({ from: '2026-08-23', to: '2026-08-29' });
  });

  it('honours an explicit week, given any day inside it', async () => {
    const res = await request(app()).get('/measures/weekly?week=2026-08-31');
    expect(res.body.window).toEqual({ from: '2026-08-30', to: '2026-09-05' });
  });

  it('returns one row per rostered learner, INCLUDING one with no rings', async () => {
    // A missing card would read as "that child does not exist"; a zero reads
    // as "that child has not moved". Only the second is true.
    const res = await request(app({
      sessions: [session('2026-08-24T16:00:00Z', { milo: { rings: 40 } })],
    })).get('/measures/weekly');

    expect(res.body.learners.map((l) => l.learnerId)).toEqual(['milo', 'felix']);
    const ringOf = (id) => res.body.learners
      .find((l) => l.learnerId === id).measures.find((m) => m.id === 'fitness.rings');
    expect(ringOf('milo').value).toBe(40);
    expect(ringOf('felix').value).toBe(0);
  });

  it('labels the measure for a board that has no idea what fitness.rings is', async () => {
    const res = await request(app()).get('/measures/weekly');
    const m = res.body.learners[0].measures[0];
    expect(m).toMatchObject({ id: 'fitness.rings', label: 'Rings', unit: 'rings' });
  });

  it('reports untargeted while no quota is configured', async () => {
    const res = await request(app()).get('/measures/weekly');
    expect(res.body.learners[0].measures[0].state).toBe('untargeted');
  });

  it('is never cached — a wall panel must not show yesterday’s number', async () => {
    const res = await request(app()).get('/measures/weekly');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('ignores a fitness participant who is not a school learner', async () => {
    const res = await request(app({
      sessions: [session('2026-08-24T16:00:00Z', { kckern: { rings: 999 }, milo: { rings: 5 } })],
    })).get('/measures/weekly');
    expect(res.body.learners.map((l) => l.learnerId)).toEqual(['milo', 'felix']);
    expect(res.body.learners[0].measures[0].value).toBe(5);
  });
});
