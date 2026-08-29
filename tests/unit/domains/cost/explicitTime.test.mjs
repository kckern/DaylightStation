import { afterEach, describe, expect, it, vi } from 'vitest';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { SpreadSource } from '#domains/cost/value-objects/SpreadSource.mjs';
import { OpenAICostSource } from '#adapters/cost/openai/OpenAICostSource.mjs';

afterEach(() => {
  vi.useRealTimers();
});

describe('cost domain explicit time', () => {
  it('requires an explicit timestamp and preserves the legacy ID format', () => {
    expect(() => CostEntry.generateId()).toThrow('timestamp is required for generateId');

    const id = CostEntry.generateId(new Date('2026-08-28T19:20:21.000Z'), () => 0.5);
    expect(id).toMatch(/^20260828192021-[a-z0-9]{6}$/);
  });

  it('samples the adapter clock when tracking usage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T19:20:21.456Z'));
    const source = new OpenAICostSource({
      rateConfig: { 'gpt-test': { input_tokens: 1, output_tokens: 2 } },
      logger: { warn: vi.fn() },
    });

    const entry = source.trackUsage(
      { model: 'gpt-test', promptTokens: 1000, completionTokens: 500 },
      { householdId: 'default' },
    );

    expect(entry.id).toMatch(/^20260828192021-[a-z0-9]{6}$/);
    expect(entry.occurredAt.toISOString()).toBe('2026-08-28T19:20:21.456Z');
  });

  it('requires an explicit spread reference date and preserves boundaries', () => {
    const source = new SpreadSource({
      name: 'Annual license',
      originalAmount: 120,
      spreadMonths: 12,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(() => source.getMonthsRemaining()).toThrow('asOf is required for getMonthsRemaining');
    expect(source.getMonthsRemaining(new Date('2025-12-31T23:59:59.999Z'))).toBe(12);
    expect(source.getMonthsRemaining(new Date('2026-04-01T00:00:00.000Z'))).toBe(9);
    expect(source.getMonthsRemaining(new Date('2027-01-01T00:00:00.000Z'))).toBe(0);
  });
});
