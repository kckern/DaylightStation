import { APP_CONFIGS } from '#apps/admin/AppsConfigService.mjs';
import { HOUSEHOLD_APP_CONFIGS } from '#shared/contracts/householdConfig.mjs';

describe('AppsConfigService path registry', () => {
  it('points every admin app at its registry path, not a hardcoded one', () => {
    for (const [appId, filePath] of Object.entries(APP_CONFIGS)) {
      expect(filePath.startsWith('household/config/')).toBe(false);
      expect(filePath).toMatch(/^household\//);
      expect(appId).not.toBe('chatbots'); // dead duplicate, removed
    }
    // Both dropped IDs, asserted by absence — the loop above can only ever
    // catch an ID that is still present, and 'keyboard' left the map too:
    // it is a uid'd binding list, not app config.
    expect(Object.keys(APP_CONFIGS)).not.toContain('chatbots');
    expect(Object.keys(APP_CONFIGS)).not.toContain('keyboard');
  });

  it('resolves the admin "media" app to the MediaApp surface file', () => {
    expect(APP_CONFIGS.media).toBe(`household/${HOUSEHOLD_APP_CONFIGS['media-app']}.yml`);
  });

  it('resolves finance to the renamed singular folder', () => {
    expect(APP_CONFIGS.finance).toBe('household/finance/config.yml');
  });
});
