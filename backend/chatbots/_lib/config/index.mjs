/**
 * Configuration module barrel export
 * @module _lib/config
 */

export {
  loadConfig,
  clearConfigCache,
  getConfigCache,
} from './ConfigLoader.mjs';

export {
  CommonConfigSchema,
  TelegramConfigSchema,
  OpenAIConfigSchema,
  RateLimitConfigSchema,
  BotConfigSchema,
  NutribotConfigSchema,
  JournalistConfigSchema,
  hasEnvVarReference,
  getSchemaForBot,
} from './ConfigSchema.mjs';
