/**
 * tests/applications/home-automation/CallHomeAssistantService.test.mjs
 *
 * Unit tests for the CallHomeAssistantService use case.
 *
 * The use case wraps `haGateway.callService(domain, service, data)` with
 * input validation and gateway-availability checks. The API router will
 * delegate to it instead of reaching into the adapter directly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CallHomeAssistantService } from '../../../backend/src/3_applications/home-automation/usecases/CallHomeAssistantService.mjs';
import { ValidationError } from '../../../backend/src/0_system/utils/errors/index.mjs';
import { ApplicationError } from '../../../backend/src/3_applications/common/errors/index.mjs';

/**
 * Minimal recording fake of the Home Assistant gateway.
 * Records every `callService` invocation; returns a configurable result
 * (default: `{ ok: true }`).
 */
function makeFakeGateway({ result = { ok: true }, throws = null } = {}) {
  const calls = [];
  return {
    calls,
    async callService(domain, service, data) {
      calls.push({ domain, service, data });
      if (throws) throw throws;
      return result;
    },
  };
}

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('CallHomeAssistantService', () => {
  let gateway;
  let useCase;

  beforeEach(() => {
    gateway = makeFakeGateway();
    useCase = new CallHomeAssistantService({ haGateway: gateway, logger: silentLogger });
  });

  describe('happy path', () => {
    it('calls haGateway.callService with the provided domain, service, and data', async () => {
      const result = await useCase.execute({
        domain: 'switch',
        service: 'turn_on',
        data: { entity_id: 'switch.kitchen_light' },
      });

      expect(gateway.calls).toHaveLength(1);
      expect(gateway.calls[0]).toEqual({
        domain: 'switch',
        service: 'turn_on',
        data: { entity_id: 'switch.kitchen_light' },
      });
      expect(result).toEqual({
        domain: 'switch',
        service: 'turn_on',
        data: { entity_id: 'switch.kitchen_light' },
        result: { ok: true },
      });
    });

    it('defaults data to {} when not provided', async () => {
      const result = await useCase.execute({ domain: 'script', service: 'turn_on' });

      expect(gateway.calls[0]).toEqual({
        domain: 'script',
        service: 'turn_on',
        data: {},
      });
      expect(result.data).toEqual({});
    });
  });

  describe('input validation', () => {
    it('throws ValidationError when domain is missing', async () => {
      await expect(
        useCase.execute({ service: 'turn_on', data: {} })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(gateway.calls).toHaveLength(0);
    });

    it('throws ValidationError with HA_CALL_MISSING_DOMAIN code when domain is missing', async () => {
      try {
        await useCase.execute({ service: 'turn_on' });
        throw new Error('expected ValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.code).toBe('HA_CALL_MISSING_DOMAIN');
      }
    });

    it('throws ValidationError when service is missing', async () => {
      await expect(
        useCase.execute({ domain: 'switch', data: {} })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(gateway.calls).toHaveLength(0);
    });

    it('throws ValidationError with HA_CALL_MISSING_SERVICE code when service is missing', async () => {
      try {
        await useCase.execute({ domain: 'switch' });
        throw new Error('expected ValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.code).toBe('HA_CALL_MISSING_SERVICE');
      }
    });

    it('throws ValidationError when domain is empty string', async () => {
      await expect(
        useCase.execute({ domain: '', service: 'turn_on' })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws ValidationError when service is empty string', async () => {
      await expect(
        useCase.execute({ domain: 'switch', service: '' })
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('gateway not configured', () => {
    it('throws ApplicationError with HA_NOT_CONFIGURED when haGateway is null', async () => {
      const offlineUseCase = new CallHomeAssistantService({ haGateway: null, logger: silentLogger });
      try {
        await offlineUseCase.execute({ domain: 'switch', service: 'turn_on' });
        throw new Error('expected ApplicationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApplicationError);
        expect(err.code).toBe('HA_NOT_CONFIGURED');
      }
    });

    it('throws ApplicationError when haGateway is undefined', async () => {
      const offlineUseCase = new CallHomeAssistantService({ logger: silentLogger });
      await expect(
        offlineUseCase.execute({ domain: 'switch', service: 'turn_on' })
      ).rejects.toBeInstanceOf(ApplicationError);
    });
  });

  describe('gateway errors', () => {
    it('propagates gateway errors without catching them', async () => {
      const failingGateway = makeFakeGateway({ throws: new Error('HA timeout') });
      const failingUseCase = new CallHomeAssistantService({
        haGateway: failingGateway,
        logger: silentLogger,
      });
      await expect(
        failingUseCase.execute({ domain: 'switch', service: 'turn_on' })
      ).rejects.toThrow('HA timeout');
    });
  });

  describe('constructor', () => {
    it('does not require a logger (defaults gracefully)', async () => {
      const noLoggerUseCase = new CallHomeAssistantService({ haGateway: gateway });
      // should not throw
      const result = await noLoggerUseCase.execute({ domain: 'switch', service: 'turn_on' });
      expect(result.result).toEqual({ ok: true });
    });
  });
});
