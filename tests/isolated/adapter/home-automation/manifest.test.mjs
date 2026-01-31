// tests/unit/suite/adapters/home-automation/homeassistant/manifest.test.mjs
import manifest from '#adapters/home-automation/homeassistant/manifest.mjs';

describe('Home Assistant Manifest', () => {
  test('has required fields', () => {
    expect(manifest.provider).toBe('home_assistant');
    expect(manifest.capability).toBe('home_automation');
    expect(manifest.displayName).toBe('Home Assistant');
  });

  test('adapter factory returns HomeAssistantAdapter class', async () => {
    const { HomeAssistantAdapter: AdapterClass } = await manifest.adapter();
    expect(AdapterClass.name).toBe('HomeAssistantAdapter');
  });

  test('has config schema with host and token', () => {
    expect(manifest.configSchema.host.required).toBe(true);
    expect(manifest.configSchema.token.secret).toBe(true);
    expect(manifest.configSchema.token.required).toBe(true);
    expect(manifest.configSchema.port.default).toBe(8123);
  });
});
