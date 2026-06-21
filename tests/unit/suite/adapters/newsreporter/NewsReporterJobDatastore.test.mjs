import { describe, it, expect } from '@jest/globals';
import { NewsReporterJobDatastore } from '#adapters/newsreporter/NewsReporterJobDatastore.mjs';

const nullLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

/** Fake ConfigService returning a fixed newsreporter app config. */
const fakeConfigService = (config) => ({
  getHouseholdAppConfig: (householdId, appName) =>
    appName === 'newsreporter' ? config : null,
});

describe('NewsReporterJobDatastore', () => {
  const config = {
    'world-cup-reporter': { enabled: true, schedule: '50 7 * * *' },
    'rss-roundup': { schedule: '0 6 * * *' }, // enabled omitted => enabled
    'disabled-reporter': { enabled: false, schedule: '0 5 * * *' },
  };

  it('builds a Job per enabled reporter with correct id/name/schedule', async () => {
    const store = new NewsReporterJobDatastore({
      configService: fakeConfigService(config),
      logger: nullLogger,
    });
    const jobs = await store.loadJobs();
    const ids = jobs.map((j) => j.id).sort();
    expect(ids).toEqual(['rss-roundup', 'world-cup-reporter']);

    const wc = jobs.find((j) => j.id === 'world-cup-reporter');
    expect(wc.name).toBe('newsreporter:world-cup-reporter');
    expect(wc.schedule).toBe('50 7 * * *');
    expect(wc.enabled).toBe(true);
    expect(wc.timeout).toBe(120000);
    expect(wc.bucket).toBe('newsreporter');
  });

  it('excludes disabled reporters', async () => {
    const store = new NewsReporterJobDatastore({
      configService: fakeConfigService(config),
      logger: nullLogger,
    });
    const jobs = await store.loadJobs();
    expect(jobs.find((j) => j.id === 'disabled-reporter')).toBeUndefined();
  });

  it('reporterIds() returns the set of enabled reporter ids', async () => {
    const store = new NewsReporterJobDatastore({
      configService: fakeConfigService(config),
      logger: nullLogger,
    });
    const ids = await store.reporterIds();
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(['rss-roundup', 'world-cup-reporter']);
  });

  it('returns no jobs when the newsreporter config is missing', async () => {
    const store = new NewsReporterJobDatastore({
      configService: fakeConfigService(null),
      logger: nullLogger,
    });
    expect(await store.loadJobs()).toEqual([]);
    expect([...(await store.reporterIds())]).toEqual([]);
  });

  it('getJob(id) returns the matching job or null', async () => {
    const store = new NewsReporterJobDatastore({
      configService: fakeConfigService(config),
      logger: nullLogger,
    });
    expect((await store.getJob('world-cup-reporter')).id).toBe('world-cup-reporter');
    expect(await store.getJob('disabled-reporter')).toBeNull();
  });
});
