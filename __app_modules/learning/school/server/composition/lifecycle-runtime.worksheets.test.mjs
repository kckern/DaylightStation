import { describe, it, expect, vi } from 'vitest';
import { buildWorksheetPlatforms } from "./lifecycle-runtime.mjs";
import { BeelooWorksheetPlatformAdapter } from "#adapters/worksheets/BeelooWorksheetPlatformAdapter.mjs";

const loggers = () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const child = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const rootLogger = { child: vi.fn(() => child) };
  return { logger, rootLogger };
};
const configWith = (url) => ({ resolveServiceUrl: vi.fn((name) => (name === 'beeloo' ? url : null)) });

describe('buildWorksheetPlatforms', () => {
  it('with no services.yml beeloo url, warns school.worksheets.unwired and returns an empty Map', async () => {
    const { logger, rootLogger } = loggers();
    const platforms = await buildWorksheetPlatforms({ configService: configWith(null), rootLogger, logger });
    expect(platforms).toBeInstanceOf(Map);
    expect(platforms.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('school.worksheets.unwired', { platform: 'beeloo', reason: 'no services.yml beeloo url' });
  });

  it('with a url, builds the real Beeloo adapter under the key beeloo', async () => {
    const { logger, rootLogger } = loggers();
    const platforms = await buildWorksheetPlatforms({ configService: configWith('http://beeloo.test:8111'), rootLogger, logger });
    expect([...platforms.keys()]).toEqual(['beeloo']);
    expect(platforms.get('beeloo')).toBeInstanceOf(BeelooWorksheetPlatformAdapter);
    expect(rootLogger.child).toHaveBeenCalledWith({ module: 'worksheets-beeloo' });
    expect(logger.info).toHaveBeenCalledWith('school.worksheets.wired', { platform: 'beeloo' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('an adapter that will not load warns and returns an empty Map', async () => {
    const { logger, rootLogger } = loggers();
    const platforms = await buildWorksheetPlatforms({
      configService: configWith('http://beeloo.test:8111'), rootLogger, logger,
      loadAdapter: async () => { throw new Error('module not found'); },
    });
    expect(platforms.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('school.worksheets.unwired', { platform: 'beeloo', reason: 'module not found' });
  });

  it('an adapter whose constructor throws warns and returns an empty Map', async () => {
    const { logger, rootLogger } = loggers();
    const platforms = await buildWorksheetPlatforms({
      configService: configWith('http://beeloo.test:8111'), rootLogger, logger,
      loadAdapter: async () => class { constructor() { throw new Error('bad base url'); } },
    });
    expect(platforms.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('school.worksheets.unwired', { platform: 'beeloo', reason: 'bad base url' });
  });
});
