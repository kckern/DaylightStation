/**
 * tests/api/v1/routers/homeAutomation.test.mjs
 *
 * Focused tests for the HA-call endpoints (`POST /ha/call`,
 * `GET|POST /ha/script/:scriptId`) after they were retrofitted to delegate
 * to the `CallHomeAssistantService` use case (Phase 5 of the playback-hub
 * admin plan).
 *
 * The intent is to assert layering, not exhaustive HA behaviour:
 *   - The router must NOT touch `haGateway.callService` directly.
 *   - Both endpoints invoke `callHomeAssistantService.execute(...)` with the
 *     correct args.
 *   - The use case's return value is reflected back in the response shape.
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createHomeAutomationRouter } from '../../../../backend/src/4_api/v1/routers/homeAutomation.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Build a minimal Express app mounting the router with only the deps the
 * HA-call endpoints need. Other adapters left undefined; non-HA endpoints
 * just return 503 in that case (which is fine — we don't exercise them).
 */
function buildApp({ callHomeAssistantService, haGateway } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/home', createHomeAutomationRouter({
    haGateway: haGateway ?? { callService: vi.fn() }, // present so the !haGateway 503 branch doesn't short-circuit
    callHomeAssistantService,
    logger: silentLogger,
  }));
  return app;
}

describe('POST /api/v1/home/ha/call (delegates to CallHomeAssistantService)', () => {
  it('invokes use case with {domain, service, data} from request body', async () => {
    const execute = vi.fn().mockResolvedValue({
      domain: 'switch',
      service: 'turn_on',
      data: { entity_id: 'switch.kitchen' },
      result: { ok: true },
    });
    const app = buildApp({ callHomeAssistantService: { execute } });

    const res = await request(app)
      .post('/api/v1/home/ha/call')
      .send({ domain: 'switch', service: 'turn_on', data: { entity_id: 'switch.kitchen' } });

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      domain: 'switch',
      service: 'turn_on',
      data: { entity_id: 'switch.kitchen' },
    });
    // Response shape preserves the prior contract: ok + the use case fields.
    expect(res.body.ok).toBe(true);
    expect(res.body.domain).toBe('switch');
    expect(res.body.service).toBe('turn_on');
    expect(res.body.data).toEqual({ entity_id: 'switch.kitchen' });
    expect(res.body.result).toEqual({ ok: true });
  });

  it('does NOT touch haGateway.callService directly (layering check)', async () => {
    const execute = vi.fn().mockResolvedValue({
      domain: 'switch', service: 'turn_on', data: {}, result: { ok: true }
    });
    const gatewayCallService = vi.fn();
    const app = buildApp({
      callHomeAssistantService: { execute },
      haGateway: { callService: gatewayCallService },
    });

    await request(app)
      .post('/api/v1/home/ha/call')
      .send({ domain: 'switch', service: 'turn_on' });

    expect(gatewayCallService).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe('POST /api/v1/home/ha/script/:scriptId (delegates to CallHomeAssistantService)', () => {
  it('invokes use case with domain=script, service=turn_on, entity_id prefixed', async () => {
    const execute = vi.fn().mockResolvedValue({
      domain: 'script',
      service: 'turn_on',
      data: { entity_id: 'script.notify_dinner' },
      result: { ok: true },
    });
    const app = buildApp({ callHomeAssistantService: { execute } });

    const res = await request(app)
      .post('/api/v1/home/ha/script/notify_dinner');

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({
      domain: 'script',
      service: 'turn_on',
      data: { entity_id: 'script.notify_dinner' },
    });
    // Preserves the prior response shape: { ok, entityId, result }.
    expect(res.body.ok).toBe(true);
    expect(res.body.entityId).toBe('script.notify_dinner');
    expect(res.body.result).toEqual({ ok: true });
  });

  it('does not double-prefix when scriptId already starts with "script."', async () => {
    const execute = vi.fn().mockResolvedValue({
      domain: 'script',
      service: 'turn_on',
      data: { entity_id: 'script.notify_dinner' },
      result: { ok: true },
    });
    const app = buildApp({ callHomeAssistantService: { execute } });

    await request(app).post('/api/v1/home/ha/script/script.notify_dinner');

    expect(execute).toHaveBeenCalledWith({
      domain: 'script',
      service: 'turn_on',
      data: { entity_id: 'script.notify_dinner' },
    });
  });
});
