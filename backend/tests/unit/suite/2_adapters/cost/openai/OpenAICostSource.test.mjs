import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAICostSource } from '#adapters/cost/openai/OpenAICostSource.mjs';
import { ICostSource } from '#applications/cost/ports/ICostSource.mjs';
import { CostEntry } from '#domains/cost/entities/CostEntry.mjs';
import { CostCategory } from '#domains/cost/value-objects/CostCategory.mjs';

describe('OpenAICostSource', () => {
  let source;
  let mockLogger;
  let rateConfig;

  beforeEach(() => {
    mockLogger = {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    };

    rateConfig = {
      'gpt-4o': {
        input_tokens: 5.00,    // $5.00 per 1K input tokens
        output_tokens: 15.00   // $15.00 per 1K output tokens
      },
      'gpt-4o-mini': {
        input_tokens: 0.15,    // $0.15 per 1K input tokens
        output_tokens: 0.60    // $0.60 per 1K output tokens
      },
      'whisper-1': {
        input_tokens: 0.006,   // $0.006 per second (mapped as tokens)
        output_tokens: 0
      },
      default: {
        input_tokens: 1.00,
        output_tokens: 2.00
      }
    };
  });

  describe('constructor', () => {
    it('should require rateConfig', () => {
      expect(() => new OpenAICostSource({})).toThrow('rateConfig is required');
    });

    it('should accept rateConfig and optional logger', () => {
      const source = new OpenAICostSource({
        rateConfig,
        logger: mockLogger
      });

      expect(source).toBeInstanceOf(OpenAICostSource);
    });

    it('should extend ICostSource', () => {
      const source = new OpenAICostSource({
        rateConfig,
        logger: mockLogger
      });

      expect(source).toBeInstanceOf(ICostSource);
    });

    it('should use console as default logger', () => {
      // Should not throw when logger is not provided
      const source = new OpenAICostSource({ rateConfig });
      expect(source).toBeInstanceOf(OpenAICostSource);
    });
  });

  describe('getSourceId', () => {
    beforeEach(() => {
      source = new OpenAICostSource({ rateConfig, logger: mockLogger });
    });

    it('should return "openai"', () => {
      expect(source.getSourceId()).toBe('openai');
    });
  });

  describe('getSupportedCategories', () => {
    beforeEach(() => {
      source = new OpenAICostSource({ rateConfig, logger: mockLogger });
    });

    it('should return expected categories', () => {
      const categories = source.getSupportedCategories();

      expect(categories).toHaveLength(3);
      expect(categories[0]).toBeInstanceOf(CostCategory);
      expect(categories[0].toString()).toBe('ai/openai/gpt-4o/chat');
      expect(categories[1].toString()).toBe('ai/openai/gpt-4o-mini/chat');
      expect(categories[2].toString()).toBe('ai/openai/whisper/transcription');
    });
  });

  describe('fetchCosts', () => {
    beforeEach(() => {
      source = new OpenAICostSource({ rateConfig, logger: mockLogger });
    });

    it('should return empty array (OpenAI does not provide cost history API)', async () => {
      const since = new Date('2026-01-01');
      const results = await source.fetchCosts(since);

      expect(results).toEqual([]);
    });

    it('should return empty array when no since parameter provided', async () => {
      const results = await source.fetchCosts();

      expect(results).toEqual([]);
    });
  });

  describe('onCost', () => {
    beforeEach(() => {
      source = new OpenAICostSource({ rateConfig, logger: mockLogger });
    });

    it('should register callbacks', () => {
      const callback = vi.fn();

      source.onCost(callback);

      // Trigger a trackUsage to verify callback is registered
      source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.any(CostEntry));
    });

    it('should support multiple callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      source.onCost(callback1);
      source.onCost(callback2);

      source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('trackUsage', () => {
    beforeEach(() => {
      source = new OpenAICostSource({ rateConfig, logger: mockLogger });
    });

    it('should create CostEntry with correct amounts for gpt-4o', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 1000, completionTokens: 500 },
        { householdId: 'default', userId: 'teen', feature: 'assistant' }
      );

      expect(entry).toBeInstanceOf(CostEntry);

      // Calculate expected cost:
      // Input: (1000 / 1000) * $5.00 = $5.00
      // Output: (500 / 1000) * $15.00 = $7.50
      // Total: $12.50
      expect(entry.amount.amount).toBe(12.50);
      expect(entry.amount.currency).toBe('USD');
    });

    it('should create CostEntry with correct amounts for gpt-4o-mini', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o-mini', promptTokens: 2000, completionTokens: 1000 },
        { householdId: 'default' }
      );

      // Calculate expected cost:
      // Input: (2000 / 1000) * $0.15 = $0.30
      // Output: (1000 / 1000) * $0.60 = $0.60
      // Total: $0.90
      expect(entry.amount.amount).toBe(0.90);
    });

    it('should calculate totalTokens from promptTokens + completionTokens when not provided', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(entry.usage.quantity).toBe(150);
      expect(entry.usage.unit).toBe('tokens');
    });

    it('should use totalTokens when provided', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, totalTokens: 200 },
        { householdId: 'default' }
      );

      expect(entry.usage.quantity).toBe(200);
    });

    it('should set correct category path for chat models', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(entry.category.toString()).toBe('ai/openai/gpt-4o/chat');
    });

    it('should set correct category path for whisper model', () => {
      const entry = source.trackUsage(
        { model: 'whisper-1', promptTokens: 60 },
        { householdId: 'default' }
      );

      expect(entry.category.toString()).toBe('ai/openai/whisper/transcription');
    });

    it('should set correct attribution', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default', userId: 'teen', feature: 'assistant' }
      );

      expect(entry.attribution.householdId).toBe('default');
      expect(entry.attribution.userId).toBe('teen');
      expect(entry.attribution.feature).toBe('assistant');
    });

    it('should set entryType to USAGE', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(entry.entryType).toBe('usage');
    });

    it('should include model and token counts in metadata', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(entry.metadata.model).toBe('gpt-4o');
      expect(entry.metadata.promptTokens).toBe(100);
      expect(entry.metadata.completionTokens).toBe(50);
    });

    it('should handle missing model rates gracefully using default', () => {
      const entry = source.trackUsage(
        { model: 'unknown-model', promptTokens: 1000, completionTokens: 500 },
        { householdId: 'default' }
      );

      expect(entry).toBeInstanceOf(CostEntry);
      // Uses default rates: (1000/1000)*1.00 + (500/1000)*2.00 = 1.00 + 1.00 = 2.00
      expect(entry.amount.amount).toBe(2.00);
    });

    it('should log warning when model has no rate and no default', () => {
      // Create source without default rate config
      const noDefaultConfig = {
        'gpt-4o': {
          input_tokens: 5.00,
          output_tokens: 15.00
        }
      };
      const sourceNoDefault = new OpenAICostSource({
        rateConfig: noDefaultConfig,
        logger: mockLogger
      });

      const result = sourceNoDefault.trackUsage(
        { model: 'unknown-model', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith('cost.openai.no_rate', { model: 'unknown-model' });
    });

    it('should call all registered callbacks with the entry', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      source.onCost(callback1);
      source.onCost(callback2);

      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(callback1).toHaveBeenCalledWith(entry);
      expect(callback2).toHaveBeenCalledWith(entry);
    });

    it('should handle zero token counts', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 0, completionTokens: 0 },
        { householdId: 'default' }
      );

      expect(entry.amount.amount).toBe(0);
      expect(entry.usage.quantity).toBe(0);
    });

    it('should default promptTokens and completionTokens to 0', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o' },
        { householdId: 'default' }
      );

      expect(entry.amount.amount).toBe(0);
      expect(entry.metadata.promptTokens).toBe(0);
      expect(entry.metadata.completionTokens).toBe(0);
    });

    it('should generate unique IDs for each entry', () => {
      const entry1 = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      const entry2 = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      expect(entry1.id).not.toBe(entry2.id);
    });

    it('should set occurredAt to current time', () => {
      const before = new Date();

      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100, completionTokens: 50 },
        { householdId: 'default' }
      );

      const after = new Date();

      expect(entry.occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(entry.occurredAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should handle fractional token costs correctly', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 123, completionTokens: 456 },
        { householdId: 'default' }
      );

      // Input: (123 / 1000) * $5.00 = $0.615
      // Output: (456 / 1000) * $15.00 = $6.84
      // Total: $7.455 -> rounded to $7.46 (Money rounds to cents)
      expect(entry.amount.amount).toBe(7.46);
    });
  });

  describe('cost calculation accuracy', () => {
    beforeEach(() => {
      source = new OpenAICostSource({ rateConfig, logger: mockLogger });
    });

    it('should calculate costs at scale correctly', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 100000, completionTokens: 50000 },
        { householdId: 'default' }
      );

      // Input: (100000 / 1000) * $5.00 = $500.00
      // Output: (50000 / 1000) * $15.00 = $750.00
      // Total: $1250.00
      expect(entry.amount.amount).toBe(1250.00);
    });

    it('should handle small token counts', () => {
      const entry = source.trackUsage(
        { model: 'gpt-4o', promptTokens: 1, completionTokens: 1 },
        { householdId: 'default' }
      );

      // Input: (1 / 1000) * $5.00 = $0.005
      // Output: (1 / 1000) * $15.00 = $0.015
      // Total: $0.02 (rounded)
      expect(entry.amount.amount).toBe(0.02);
    });
  });
});
