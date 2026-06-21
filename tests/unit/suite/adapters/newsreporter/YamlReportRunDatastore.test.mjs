import { describe, it, expect } from '@jest/globals';
import { YamlReportRunDatastore } from '#adapters/persistence/yaml/YamlReportRunDatastore.mjs';
import { isReportRunHistory } from '#apps/newsreporter/ports/IReportRunHistory.mjs';

/**
 * Fake DataService capturing household.write calls (path, data, householdId).
 */
const fakeDataService = (writeImpl) => {
  const writes = [];
  return {
    writes,
    household: {
      write: (path, data, householdId) => {
        writes.push({ path, data, householdId });
        return writeImpl ? writeImpl({ path, data, householdId }) : true;
      },
    },
  };
};

const captureLogger = () => {
  const events = [];
  return {
    events,
    info: (e, d) => events.push({ e, d }),
    debug: () => {},
    warn: (e, d) => events.push({ e, d }),
    error: (e, d) => events.push({ e, d }),
  };
};

const runResult = () => ({
  startedAt: '2026-06-21T13:50:00.000Z',
  status: 'ok',
  sourceCounts: { matches: 3 },
  sinkResults: [{ status: 'ok' }],
  error: null,
});

describe('YamlReportRunDatastore', () => {
  it('is a valid IReportRunHistory', () => {
    const store = new YamlReportRunDatastore({ dataService: fakeDataService(), logger: captureLogger() });
    expect(isReportRunHistory(store)).toBe(true);
  });

  it('writes to history/newsreporter/{reporterId}/{date} keyed by startedAt calendar date', async () => {
    const dataService = fakeDataService();
    const store = new YamlReportRunDatastore({ dataService, logger: captureLogger() });
    await store.record('world-cup-reporter', runResult());
    expect(dataService.writes).toHaveLength(1);
    expect(dataService.writes[0].path).toBe('history/newsreporter/world-cup-reporter/2026-06-21');
  });

  it('persists the run outcome fields', async () => {
    const dataService = fakeDataService();
    const store = new YamlReportRunDatastore({ dataService, logger: captureLogger() });
    await store.record('rep', runResult());
    expect(dataService.writes[0].data).toEqual({
      startedAt: '2026-06-21T13:50:00.000Z',
      status: 'ok',
      sourceCounts: { matches: 3 },
      sinkResults: [{ status: 'ok' }],
      error: null,
    });
  });

  it('swallows a write failure (logs write_failed, never throws into the caller)', async () => {
    const logger = captureLogger();
    const dataService = fakeDataService(() => { throw new Error('disk full'); });
    const store = new YamlReportRunDatastore({ dataService, logger });
    await expect(store.record('rep', runResult())).resolves.toBeUndefined();
    expect(logger.events.some(({ e }) => e === 'newsreporter.history.write_failed')).toBe(true);
  });
});
