import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const sourceFilePath = path.resolve(process.cwd(), 'frontend/src/hooks/fitness/ZoneProfileStore.js');

describe('ZoneProfileStore build_profile log level contract', () => {
  let source;

  beforeAll(async () => {
    source = await fs.promises.readFile(sourceFilePath, 'utf8');
  });

  it('build_profile diagnostic does NOT use logger.warn()', () => {
    // logger.warn fires on every HR update for every user, causing massive log spam.
    // It should use logger.sampled() or logger.debug() instead.
    const usesWarn = source.includes("logger.warn('zoneprofilestore.build_profile'");
    expect(usesWarn).toBe(false);
  });

  it('build_profile diagnostic uses logger.sampled() or logger.debug()', () => {
    // The diagnostic log should use a non-spammy log method
    const usesSampled = source.includes("logger.sampled('zoneprofilestore.build_profile'");
    const usesDebug = source.includes("logger.debug('zoneprofilestore.build_profile'");
    expect(usesSampled || usesDebug).toBe(true);
  });
});
