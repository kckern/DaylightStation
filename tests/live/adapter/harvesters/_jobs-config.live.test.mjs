// tests/live/adapter/harvesters/_jobs-config.live.test.mjs

/**
 * Validates jobs.yml configuration matches registered harvesters.
 */

import path from 'path';
import { configService, initConfigService, dataService } from '#backend/src/0_system/config/index.mjs';
import { createHarvesterServices } from '#backend/src/0_system/bootstrap.mjs';
import { loadYaml, saveYaml } from '#backend/src/0_system/utils/FileIO.mjs';
import axios from 'axios';

const EXPECTED_HARVESTERS = [
  'todoist', 'clickup', 'github',
  'lastfm', 'reddit', 'letterboxd', 'goodreads', 'foursquare',
  'gmail', 'gcal',
  'buxfer', 'shopping',
  'strava', 'withings', 'weather'
];

describe('Cron Jobs Configuration', () => {
  let jobs;
  let registeredHarvesters;

  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH required');
    }

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // Load jobs.yml
    jobs = dataService.system.read('config/jobs') || [];

    // Get registered harvesters
    const io = {
      userLoadFile(username, relativePath) {
        return loadYaml(path.join(dataPath, 'users', username, 'lifelog', relativePath));
      },
      userSaveFile(username, relativePath, content) {
        saveYaml(path.join(dataPath, 'users', username, 'lifelog', relativePath), content);
      },
      householdSaveFile(relativePath, content) {
        saveYaml(path.join(dataPath, 'households', 'default', relativePath), content);
      },
    };

    const { harvesterService } = createHarvesterServices({
      io,
      httpClient: axios,
      configService,
      dataRoot: dataPath,
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
    });

    registeredHarvesters = harvesterService.listHarvesters().map(h => h.serviceId);
  });

  it('has a cron job for every expected harvester', () => {
    const jobIds = jobs.map(j => j.id);

    for (const harvester of EXPECTED_HARVESTERS) {
      expect(jobIds).toContain(harvester);
    }
  });

  it('all expected harvesters are registered in bootstrap', () => {
    for (const harvester of EXPECTED_HARVESTERS) {
      expect(registeredHarvesters).toContain(harvester);
    }
  });

  it('all harvester jobs are enabled (not explicitly disabled)', () => {
    for (const harvester of EXPECTED_HARVESTERS) {
      const job = jobs.find(j => j.id === harvester);
      expect(job).toBeDefined();
      expect(job.enabled).not.toBe(false);
    }
  });

  it('all harvester jobs have valid cron schedule', () => {
    for (const harvester of EXPECTED_HARVESTERS) {
      const job = jobs.find(j => j.id === harvester);
      expect(job).toBeDefined();
      expect(job.schedule).toBeDefined();
      expect(job.schedule).toMatch(/^[\d\*\/\-\,\s]+$/);
    }
  });
});
