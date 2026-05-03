import { describe, it, expect } from 'vitest';
import {
  isHomeAutomationGateway,
  createNoOpGateway,
} from '#apps/home-automation/ports/IHomeAutomationGateway.mjs';

describe('IHomeAutomationGateway contract', () => {
  it('recognises a gateway with getStates, getHistory, and listAllStates', () => {
    const obj = {
      getState:       async () => null,
      callService:    async () => ({ ok: true }),
      activateScene:  async () => ({ ok: true }),
      getStates:      async () => new Map(),
      getHistory:     async () => new Map(),
      listAllStates:  async () => [],
    };
    expect(isHomeAutomationGateway(obj)).toBe(true);
  });

  it('rejects a gateway missing getStates', () => {
    const obj = {
      getState:      async () => null,
      callService:   async () => ({ ok: true }),
      activateScene: async () => ({ ok: true }),
      getHistory:    async () => new Map(),
      listAllStates: async () => [],
    };
    expect(isHomeAutomationGateway(obj)).toBe(false);
  });

  it('rejects a gateway missing listAllStates', () => {
    const obj = {
      getState:      async () => null,
      callService:   async () => ({ ok: true }),
      activateScene: async () => ({ ok: true }),
      getStates:     async () => new Map(),
      getHistory:    async () => new Map(),
    };
    expect(isHomeAutomationGateway(obj)).toBe(false);
  });

  it('noop gateway returns empty array from listAllStates', async () => {
    const noop = createNoOpGateway();
    const result = await noop.listAllStates();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('noop gateway returns empty map from getStates', async () => {
    const noop = createNoOpGateway();
    const result = await noop.getStates(['light.x']);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('noop gateway returns empty map from getHistory', async () => {
    const noop = createNoOpGateway();
    const result = await noop.getHistory(['sensor.x'], { sinceIso: '2026-04-20T00:00:00Z' });
    expect(result).toBeInstanceOf(Map);
  });
});
