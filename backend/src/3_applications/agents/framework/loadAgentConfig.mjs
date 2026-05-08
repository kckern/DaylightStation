// backend/src/3_applications/agents/framework/loadAgentConfig.mjs

const HARDCODED_DEFAULTS = Object.freeze({
  memory: {
    last_messages: 100,
    time_window_hours: null,
    working_memory: {
      enabled: true,
      scope: 'resource',
      template_ref: 'default',
    },
    observational: {
      enabled: true,
      observer_model: 'openai/gpt-4o-mini',
      reflector_model: 'openai/gpt-4o-mini',
      message_tokens_threshold: 30000,
      observation_tokens_threshold: 40000,
    },
    semantic_recall: {
      enabled: false,
      top_k: 5,
      message_range: 2,
      scope: 'resource',
    },
  },
});

function deepMerge(base, override) {
  if (override === null || override === undefined) return base;
  if (typeof base !== 'object' || base === null) return override;
  if (typeof override !== 'object') return override;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = (key in base) ? deepMerge(base[key], override[key]) : override[key];
  }
  return out;
}

/**
 * Load and resolve an agent's memory configuration.
 *
 * Order of precedence (last wins):
 *   1. HARDCODED_DEFAULTS (this file)
 *   2. yaml.default (data/household/config/agents.yml)
 *   3. yaml.overrides[agentId]
 *
 * Errors in configService are swallowed and treated as "no YAML present".
 *
 * @param {object} args
 * @param {object|null} args.configService — exposes getAppConfig('agents')
 * @param {string} args.agentId
 * @returns {object} resolved per-agent config
 */
export function loadAgentConfig({ configService, agentId }) {
  let yaml = null;
  try {
    yaml = configService?.getAppConfig?.('agents') ?? null;
  } catch {
    yaml = null;
  }

  let cfg = HARDCODED_DEFAULTS;
  if (yaml?.default) cfg = deepMerge(cfg, yaml.default);
  if (yaml?.overrides?.[agentId]) cfg = deepMerge(cfg, yaml.overrides[agentId]);
  return cfg;
}

export default loadAgentConfig;
