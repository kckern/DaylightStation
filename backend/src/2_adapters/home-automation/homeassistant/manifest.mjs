// backend/src/2_adapters/home-automation/homeassistant/manifest.mjs

export default {
  provider: 'home_assistant',
  capability: 'home_automation',
  displayName: 'Home Assistant',

  adapter: () => import('./HomeAssistantAdapter.mjs'),

  configSchema: {
    host: { type: 'string', required: true, description: 'Home Assistant URL (e.g., http://192.168.1.50:8123)' },
    port: { type: 'number', default: 8123, description: 'Home Assistant port' },
    token: { type: 'string', secret: true, required: true, description: 'Long-lived access token' },
  }
};
