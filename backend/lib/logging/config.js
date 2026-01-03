import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';

const DEFAULT_CONFIG = {
  defaultLevel: 'info',
  loggers: {},
  tags: ['backend']
};

let cachedConfig = null;

const safeReadYaml = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return parse(raw) || {};
    }
  } catch (err) {
    const line = `[logging-config] failed to read ${filePath} ${err?.message || err}\n`;
    process.stderr.write(line);
  }
  return {};
};

export const hydrateProcessEnvFromConfigs = (baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')) => {
  const appConfig = safeReadYaml(path.join(baseDir, 'config.app.yml'));
  const secretsConfig = safeReadYaml(path.join(baseDir, 'config.secrets.yml'));
  const localConfig = safeReadYaml(path.join(baseDir, 'config.app-local.yml'));
  const merged = { ...appConfig, ...secretsConfig, ...localConfig };
  process.env = { ...process.env, ...merged };
  return merged;
};

const applyEnvOverrides = (config) => {
  const out = { ...config, loggers: { ...(config.loggers || {}) } };
  Object.entries(process.env || {}).forEach(([key, value]) => {
    if (!key.startsWith('LOG_LEVEL_')) return;
    const loggerName = key.replace(/^LOG_LEVEL_/, '').toLowerCase().replace(/__/g, '/').replace(/_/g, '.');
    if (!loggerName) return;
    out.loggers[loggerName] = String(value || '').toLowerCase();
  });
  return out;
};

export const loadLoggingConfig = (baseDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')) => {
  if (cachedConfig) return cachedConfig;

  // Auto-detect environment
  const isProduction = fs.existsSync('/.dockerenv') || process.env.NODE_ENV === 'production';

  const loggingPath = path.join(baseDir, 'config', 'logging.yml');
  const fileConfig = safeReadYaml(loggingPath);

  // Merge configs with environment-based defaults
  let merged = { ...DEFAULT_CONFIG, ...fileConfig };

  // Auto-adjust defaultLevel based on environment (if not explicitly set in config)
  if (!fileConfig.defaultLevel) {
    merged.defaultLevel = isProduction ? 'info' : 'debug';
  }

  // Apply environment variable overrides (highest priority)
  merged = applyEnvOverrides(merged);

  cachedConfig = merged;
  return merged;
};

export const resolveLoggerLevel = (name, config = loadLoggingConfig()) => {
  if (!name) return config.defaultLevel || 'info';
  return config.loggers?.[name] || config.loggers?.[name.toLowerCase?.()] || config.defaultLevel || 'info';
};

export const getLoggingTags = (config = loadLoggingConfig()) => config.tags || ['backend'];

// Token resolution helpers
export const resolveLogglyToken = () => process.env.LOGGLY_TOKEN || process.env.LOGGLY_INPUT_TOKEN;
export const resolveLogglySubdomain = () => process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;

export default loadLoggingConfig;
