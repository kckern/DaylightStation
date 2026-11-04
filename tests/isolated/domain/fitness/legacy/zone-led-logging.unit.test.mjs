import fs from 'fs';
import path from 'path';

// Use process.cwd() instead of import.meta.url (babel-jest transforms ESM to CJS)
const hookFilePath = path.resolve(process.cwd(), '__app_modules/wellness/fitness/browser/hooks/fitness/useZoneLedSync.js');

describe('zone LED logging', () => {
  let fileContent;

  beforeAll(async () => {
    fileContent = await fs.promises.readFile(hookFilePath, 'utf8');
  });

  test('imports getLogger from Logger.js', () => {
    // The hook moved into the fitness app module; it still imports the shared logger.
    expect(fileContent).toMatch(/import \{ getLogger \} from ["'][^"']*frontend\/src\/lib\/logging\/Logger\.js["']/);
  });

  test('uses sampled logging for zone LED activations', () => {
    // Check that the file contains sampled logging with the correct event name
    expect(fileContent).toContain("getLogger().sampled('fitness.zone_led.activated'");
  });

  test('sampled logging uses maxPerMinute: 20 rate limit', () => {
    // Verify the implementation uses the correct rate limit
    expect(fileContent).toContain('maxPerMinute: 20');
  });

  test('zone LED logging includes zone count and ids', () => {
    // Verify logging includes relevant zone data
    expect(fileContent).toContain('zoneCount');
    expect(fileContent).toContain('zoneIds');
    expect(fileContent).toContain('sessionEnded');
    expect(fileContent).toContain('householdId');
  });
});
