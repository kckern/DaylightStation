/**
 * The admin YAML browser's file allowlist must cover every registered app
 * config. A file missing from it 403s with no error, no log, and no other
 * signal — the file just becomes uneditable. That failure mode already shipped
 * once (3 of 11 files covered), which is why this list is derived from the
 * registry and why this test guards the derivation.
 */
import { EDITABLE_CONFIG_FILES } from '#adapters/persistence/yaml/YamlAdminConfigStore.mjs';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

describe('admin YAML browser allowlist', () => {
  it('covers EVERY registered app config — no app is silently 403ed', () => {
    const missing = Object.entries(HOUSEHOLD_APP_CONFIGS)
      .map(([app, rel]) => [app, `household/${rel}.yml`])
      .filter(([, file]) => !EDITABLE_CONFIG_FILES.includes(file));
    expect(missing).toEqual([]);
  });

  it('still allows the root-level files that are not app configs', () => {
    expect(EDITABLE_CONFIG_FILES).toContain('household/integrations.yml');
  });

  it('keeps the Office Keypad bindings editable after they leave the app registry', () => {
    expect(EDITABLE_CONFIG_FILES).toContain('household/triggers/bindings/keyboard.yml');
  });

  it('never grants a whole domain directory (would expose log trees)', () => {
    for (const entry of EDITABLE_CONFIG_FILES) expect(entry).toMatch(/\.ya?ml$/);
  });

  it('has no duplicate entries — a collision between derived and hand-added', () => {
    expect(EDITABLE_CONFIG_FILES.length).toBe(new Set(EDITABLE_CONFIG_FILES).size);
  });

  it('never grants anything under a masked auth directory', () => {
    const masked = EDITABLE_CONFIG_FILES.filter(
      (f) => f.startsWith('household/auth/') || f.startsWith('system/auth/')
    );
    expect(masked).toEqual([]);
  });

  it('holds no entry that could escape the data root', () => {
    const escaping = EDITABLE_CONFIG_FILES.filter(
      (f) => f.includes('..') || f.startsWith('/') || f.includes('\\')
    );
    expect(escaping).toEqual([]);
  });
});
