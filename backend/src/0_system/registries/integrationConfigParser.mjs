/**
 * Convention-based provider -> capability mapping.
 * Used to infer capability from service config keys.
 */
export const PROVIDER_CAPABILITY_MAP = {
  // Media
  plex: 'media',
  jellyfin: 'media',

  // Home automation
  homeassistant: 'home_automation',

  // AI
  openai: 'ai',
  anthropic: 'ai',

  // Messaging
  telegram: 'messaging',
  discord: 'messaging',

  // Finance
  buxfer: 'finance',
};

/**
 * Keys that represent capability sections (not service entries).
 */
export const CAPABILITY_KEYS = ['ai', 'messaging', 'media', 'home_automation', 'finance'];

/**
 * Parse integrations.yml config into services and app routing.
 *
 * @param {object} config - Raw integrations.yml content
 * @returns {{ services: object, appRouting: object, unknownKeys: string[] }}
 */
export function parseIntegrationsConfig(config) {
  const services = {};
  const appRouting = {};
  const unknownKeys = [];

  if (!config || typeof config !== 'object') {
    return { services, appRouting, unknownKeys };
  }

  for (const [key, value] of Object.entries(config)) {
    if (CAPABILITY_KEYS.includes(key)) {
      // Check if it's a simple capability array (e.g., home_automation: [{provider: 'homeassistant'}])
      // vs app routing (e.g., messaging: {nutribot: [{platform: 'telegram'}]})
      if (Array.isArray(value)) {
        // Simple capability declaration - extract service entries
        for (const entry of value) {
          const provider = entry?.provider ?? entry?.platform;
          if (provider && PROVIDER_CAPABILITY_MAP[provider]) {
            // Copy config excluding provider/platform key
            const { provider: _p, platform: _pl, ...serviceConfig } = entry;
            services[provider] = serviceConfig;
          }
        }
      } else {
        // Per-app routing section (ai, messaging, etc.)
        appRouting[key] = parseAppRouting(value);
      }
    } else if (PROVIDER_CAPABILITY_MAP[key]) {
      // Service connection entry (plex, homeassistant, etc.)
      services[key] = value;
    } else {
      // Unknown key
      unknownKeys.push(key);
    }
  }

  return { services, appRouting, unknownKeys };
}

/**
 * Parse per-app routing from capability config section.
 *
 * Input: { nutribot: [{ provider: 'openai' }], journalist: [{ provider: 'anthropic' }] }
 * Output: { nutribot: 'openai', journalist: 'anthropic' }
 *
 * @param {object} capabilityConfig - Config for a single capability (ai, messaging, etc.)
 * @returns {object} App -> provider mapping
 */
export function parseAppRouting(capabilityConfig) {
  if (!capabilityConfig || typeof capabilityConfig !== 'object') {
    return {};
  }

  const routing = {};

  for (const [appName, configs] of Object.entries(capabilityConfig)) {
    if (!Array.isArray(configs) || configs.length === 0) continue;

    // Take first config entry
    const config = configs[0];
    // Support both 'provider' and 'platform' keys
    const provider = config.provider ?? config.platform;
    if (provider) {
      routing[appName] = provider;
    }
  }

  return routing;
}
