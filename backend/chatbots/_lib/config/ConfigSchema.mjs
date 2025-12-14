/**
 * Configuration schema definitions using Zod
 * @module _lib/config/ConfigSchema
 */

import { z } from 'zod';

/**
 * Environment variable interpolation pattern
 * Matches ${VAR_NAME} patterns
 */
const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Common configuration schema shared across all bots
 */
export const CommonConfigSchema = z.object({
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  timezone: z.string().default('America/Los_Angeles'),
  paths: z.object({
    data: z.string(),
    icons: z.string().optional(),
    fonts: z.string().optional(),
  }),
  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  }).default({ level: 'info' }),
});

/**
 * Telegram bot configuration schema
 */
export const TelegramConfigSchema = z.object({
  token: z.string().min(1, 'Telegram token is required'),
  botId: z.string().min(1, 'Bot ID is required'),
});

/**
 * OpenAI API configuration schema
 */
export const OpenAIConfigSchema = z.object({
  apiKey: z.string().min(1, 'OpenAI API key is required'),
  model: z.string().default('gpt-4o'),
  maxTokens: z.number().positive().default(1000),
  timeout: z.number().positive().default(60000),
});

/**
 * Rate limiting configuration schema
 */
export const RateLimitConfigSchema = z.object({
  gptCallsPerMinute: z.number().positive().default(20),
  telegramMessagesPerSecond: z.number().positive().default(30),
});

/**
 * Full bot configuration schema (common + bot-specific)
 */
export const BotConfigSchema = CommonConfigSchema.extend({
  telegram: TelegramConfigSchema.optional(),
  openai: OpenAIConfigSchema.optional(),
  rateLimit: RateLimitConfigSchema.default({
    gptCallsPerMinute: 20,
    telegramMessagesPerSecond: 30,
  }),
});

/**
 * Nutribot-specific configuration schema
 */
export const NutribotConfigSchema = BotConfigSchema.extend({
  telegram: TelegramConfigSchema,
  openai: OpenAIConfigSchema,
  reporting: z.object({
    calorieThresholds: z.array(z.number()).default([400, 1000, 1600]),
    dailyBudget: z.number().positive().default(2000),
    historyDays: z.number().positive().default(7),
    autoGenerateOnComplete: z.boolean().default(true),
  }).default({}),
  coaching: z.object({
    enabled: z.boolean().default(true),
    onThreshold: z.boolean().default(true),
    onDemand: z.boolean().default(true),
  }).default({}),
  upc: z.object({
    providers: z.array(z.object({
      name: z.string(),
      enabled: z.boolean().default(true),
      appId: z.string().optional(),
      appKey: z.string().optional(),
    })).default([]),
  }).default({}),
});

/**
 * Journalist-specific configuration schema
 */
export const JournalistConfigSchema = BotConfigSchema.extend({
  telegram: TelegramConfigSchema,
  openai: OpenAIConfigSchema,
  journaling: z.object({
    maxQueueSize: z.number().positive().default(10),
    followUpCount: z.number().positive().default(3),
  }).default({}),
  quiz: z.object({
    categories: z.array(z.string()).default([]),
  }).default({}),
});

/**
 * Check if a value contains environment variable references
 * @param {string} value - Value to check
 * @returns {boolean}
 */
export function hasEnvVarReference(value) {
  if (typeof value !== 'string') return false;
  // Need to use new RegExp to avoid stateful lastIndex issues
  const pattern = /\$\{([^}]+)\}/g;
  return pattern.test(value);
}

/**
 * Get the schema for a specific bot
 * @param {string} botName - Name of the bot
 * @returns {z.ZodSchema}
 */
export function getSchemaForBot(botName) {
  const schemas = {
    nutribot: NutribotConfigSchema,
    journalist: JournalistConfigSchema,
  };
  return schemas[botName] || BotConfigSchema;
}

export default {
  CommonConfigSchema,
  TelegramConfigSchema,
  OpenAIConfigSchema,
  RateLimitConfigSchema,
  BotConfigSchema,
  NutribotConfigSchema,
  JournalistConfigSchema,
  hasEnvVarReference,
  getSchemaForBot,
};
