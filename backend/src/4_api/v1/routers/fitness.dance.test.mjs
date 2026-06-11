// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFitnessRouter } from './fitness.mjs';

const silentLogger = { info(){}, warn(){}, error(){}, debug(){} };

function appWith(danceLightingController) {
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({ danceLightingController, logger: silentLogger }));
  return app;
}

describe('fitness router — dance endpoints', () => {
  it('POST /dance/start delegates to the controller', async () => {
    const ctrl = { start: vi.fn().mockResolvedValue({ ok: true, started: true }), accent: vi.fn(), stop: vi.fn() };
    const res = await request(appWith(ctrl)).post('/dance/start').send({});
    expect(res.status).toBe(200);
    expect(ctrl.start).toHaveBeenCalled();
    expect(res.body).toMatchObject({ ok: true });
  });

  it('POST /dance/accent and /dance/stop delegate', async () => {
    const ctrl = { start: vi.fn(), accent: vi.fn().mockResolvedValue({ ok: true }), stop: vi.fn().mockResolvedValue({ ok: true }) };
    await request(appWith(ctrl)).post('/dance/accent').send({});
    await request(appWith(ctrl)).post('/dance/stop').send({});
    expect(ctrl.accent).toHaveBeenCalled();
    expect(ctrl.stop).toHaveBeenCalled();
  });

  it('returns a graceful skip when no controller is wired', async () => {
    const res = await request(appWith(undefined)).post('/dance/start').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, skipped: true });
  });

  it('POST /dance/bpm delegates to setBpm with the posted value', async () => {
    const ctrl = { setBpm: vi.fn().mockResolvedValue({ ok: true, bpm: 128 }) };
    const res = await request(appWith(ctrl)).post('/dance/bpm').send({ bpm: 128 });
    expect(res.status).toBe(200);
    expect(ctrl.setBpm).toHaveBeenCalledWith(undefined, 128);
    expect(res.body).toMatchObject({ ok: true, bpm: 128 });
  });

  it('POST /dance/bpm skips gracefully without a controller', async () => {
    const res = await request(appWith(undefined)).post('/dance/bpm').send({ bpm: 128 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, skipped: true });
  });
});

describe('DanceLightingController.setBpm (real controller, fake gateway)', () => {
  const lightingConfig = {
    dance_party: {
      lighting: {
        color_strips: ['light.strip'],
        bpm_entity: 'input_number.party_bpm',
        bpm_min_interval_ms: 2000
      }
    }
  };

  async function makeController(config = lightingConfig) {
    const { DanceLightingController } = await import('../../../1_adapters/fitness/DanceLightingController.mjs');
    const gateway = { callService: vi.fn().mockResolvedValue({}) };
    const ctrl = new DanceLightingController({
      gateway,
      loadFitnessConfig: () => config,
      logger: silentLogger
    });
    return { ctrl, gateway };
  }

  it('sets the input_number, rounding the value', async () => {
    const { ctrl, gateway } = await makeController();
    const res = await ctrl.setBpm('hh', 127.7, 1000);
    expect(res).toMatchObject({ ok: true, bpm: 128 });
    expect(gateway.callService).toHaveBeenCalledWith('input_number', 'set_value',
      { entity_id: 'input_number.party_bpm', value: 128 });
  });

  it('clamps to the 10–200 input range', async () => {
    const { ctrl, gateway } = await makeController();
    await ctrl.setBpm('hh', 5, 1000);
    expect(gateway.callService).toHaveBeenCalledWith('input_number', 'set_value',
      expect.objectContaining({ value: 10 }));
    await ctrl.setBpm('hh', 999, 10000);
    expect(gateway.callService).toHaveBeenCalledWith('input_number', 'set_value',
      expect.objectContaining({ value: 200 }));
  });

  it('drops unchanged values and rate-caps rapid changes (no API storm)', async () => {
    const { ctrl, gateway } = await makeController();
    await ctrl.setBpm('hh', 120, 1000);
    expect(await ctrl.setBpm('hh', 120, 10000)).toMatchObject({ skipped: true, reason: 'unchanged' });
    expect(await ctrl.setBpm('hh', 125, 1500)).toMatchObject({ skipped: true, reason: 'rate_limited' });
    expect(gateway.callService).toHaveBeenCalledTimes(1);
    expect(await ctrl.setBpm('hh', 125, 4000)).toMatchObject({ ok: true, bpm: 125 });
    expect(gateway.callService).toHaveBeenCalledTimes(2);
  });

  it('rejects junk and no-ops without a configured entity', async () => {
    const { ctrl } = await makeController();
    expect(await ctrl.setBpm('hh', 'fast', 1000)).toMatchObject({ ok: false, error: 'invalid_bpm' });
    const { ctrl: bare, gateway } = await makeController({ dance_party: { lighting: {} } });
    expect(await bare.setBpm('hh', 120, 1000)).toMatchObject({ skipped: true, reason: 'bpm_entity_not_configured' });
    expect(gateway.callService).not.toHaveBeenCalled();
  });

  it('allows resending the same value after a gateway failure', async () => {
    const { ctrl, gateway } = await makeController();
    gateway.callService.mockRejectedValueOnce(new Error('ha down'));
    expect(await ctrl.setBpm('hh', 120, 1000)).toMatchObject({ ok: false });
    expect(await ctrl.setBpm('hh', 120, 5000)).toMatchObject({ ok: true, bpm: 120 });
  });
});
