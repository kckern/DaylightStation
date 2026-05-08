// tests/isolated/agents/framework/loadAgentConfig.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { loadAgentConfig } from '../../../../backend/src/3_applications/agents/framework/loadAgentConfig.mjs';

describe('loadAgentConfig', () => {
  it('returns default config when configService returns null/undefined', () => {
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => null) },
      agentId: 'health-coach',
    });
    // Hardcoded defaults are the SAFE state — Mastra Memory disabled
    // pending upstream schema-compat fix.
    expect(cfg.memory.last_messages).toBe(false);
    expect(cfg.memory.working_memory.enabled).toBe(false);
    expect(cfg.memory.observational.enabled).toBe(false);
  });

  it('uses default block from YAML when no overrides for agent', () => {
    const yaml = {
      default: { memory: { last_messages: 50, time_window_hours: 3 } },
      overrides: {},
    };
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => yaml) },
      agentId: 'health-coach',
    });
    expect(cfg.memory.last_messages).toBe(50);
    expect(cfg.memory.time_window_hours).toBe(3);
  });

  it('merges per-agent overrides over defaults', () => {
    const yaml = {
      default: {
        memory: { last_messages: 50, working_memory: { enabled: true, scope: 'resource' } },
      },
      overrides: {
        'health-coach': {
          memory: { last_messages: 200, working_memory: { template_ref: 'health-coach' } },
        },
      },
    };
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => yaml) },
      agentId: 'health-coach',
    });
    expect(cfg.memory.last_messages).toBe(200);                       // override wins
    expect(cfg.memory.working_memory.enabled).toBe(true);             // default kept
    expect(cfg.memory.working_memory.scope).toBe('resource');         // default kept
    expect(cfg.memory.working_memory.template_ref).toBe('health-coach'); // override added
  });

  it('different agents get different overrides', () => {
    const yaml = {
      default: { memory: { last_messages: 50 } },
      overrides: {
        'health-coach':   { memory: { last_messages: 100 } },
        'lifeplan-guide': { memory: { last_messages: 30 } },
      },
    };
    const a = loadAgentConfig({ configService: { getAppConfig: vi.fn(() => yaml) }, agentId: 'health-coach' });
    const b = loadAgentConfig({ configService: { getAppConfig: vi.fn(() => yaml) }, agentId: 'lifeplan-guide' });
    expect(a.memory.last_messages).toBe(100);
    expect(b.memory.last_messages).toBe(30);
  });

  it('falls back to hardcoded defaults for missing fields in YAML', () => {
    const yaml = {
      default: { memory: { last_messages: 50 } },  // working_memory entirely missing
      overrides: {},
    };
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => yaml) },
      agentId: 'health-coach',
    });
    // hardcoded fallback for working_memory.enabled = false (safe-state default)
    expect(cfg.memory.working_memory.enabled).toBe(false);
    expect(cfg.memory.working_memory.scope).toBe('resource');
  });

  it('handles configService missing entirely (no throw)', () => {
    const cfg = loadAgentConfig({ configService: null, agentId: 'health-coach' });
    expect(cfg.memory.last_messages).toBe(false);   // safe-state default
  });

  it('handles configService.getAppConfig throwing (no throw, returns defaults)', () => {
    const cfg = loadAgentConfig({
      configService: { getAppConfig: vi.fn(() => { throw new Error('boom'); }) },
      agentId: 'health-coach',
    });
    expect(cfg.memory.last_messages).toBe(false);   // safe-state default
  });
});
