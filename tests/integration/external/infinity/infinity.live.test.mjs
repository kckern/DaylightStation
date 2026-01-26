/**
 * Infinity Live Integration Test
 *
 * Run with: npm test -- tests/integration/external/infinity/infinity.live.test.mjs
 *
 * Requires:
 * - INFINITY_DEV in secrets.yml (API token)
 * - infinity.workspace in system.yml (workspace ID)
 * - infinity.<tableKey> in system.yml (board IDs)
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { InfinityHarvester, createInfinityHarvesters } from '#backend/src/2_adapters/harvester/other/InfinityHarvester.mjs';
import axios from 'axios';

describe('Infinity Live Integration', () => {
  let httpClient;
  let infinityConfig;
  let tableKeys;

  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // Create HTTP client
    httpClient = axios.create({ timeout: 30000 });

    // Get Infinity config
    infinityConfig = configService.get?.('infinity') || {};
    
    // Get all table keys (excluding workspace, dev, UUIDs, and deprecated boards)
    const skipKeys = ['workspace', 'INFINITY_DEV', 'dev', 'program'];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    tableKeys = Object.keys(infinityConfig).filter(
      (k) => !skipKeys.includes(k) && !uuidPattern.test(infinityConfig[k])
    );
  });

  it('has valid credentials configured', () => {
    const token = configService.getSecret('INFINITY_DEV');
    const workspace = infinityConfig.workspace || process.env.INFINITY_WORKSPACE;

    if (!token) {
      console.log('INFINITY_DEV token not configured - skipping test');
      return;
    }

    if (!workspace) {
      console.log('infinity.workspace not configured - skipping test');
      return;
    }

    console.log(`Workspace ID: ${workspace}`);
    console.log(`Table keys configured: ${tableKeys.join(', ') || '(none)'}`);

    expect(token).toBeDefined();
    expect(workspace).toBeDefined();
  });

  it('lists available table keys from config', () => {
    console.log('Available Infinity tables:');
    for (const key of tableKeys) {
      console.log(`  - ${key}: ${infinityConfig[key]}`);
    }

    // This test passes even if no tables are configured
    expect(Array.isArray(tableKeys)).toBe(true);
  });

  it('creates harvesters for all configured tables', () => {
    const token = configService.getSecret('INFINITY_DEV');
    if (!token) {
      console.log('No token - skipping harvester creation test');
      return;
    }

    const harvesters = createInfinityHarvesters({
      httpClient,
      configService,
      logger: console,
    });

    console.log(`Created ${harvesters.length} Infinity harvesters:`);
    for (const h of harvesters) {
      const status = h.getStatus();
      console.log(`  - ${h.serviceId}: configured=${status.configured}`);
    }

    expect(harvesters.length).toBe(tableKeys.length);
  });

  it('fetches data from first configured table', async () => {
    const token = configService.getSecret('INFINITY_DEV');
    if (!token) {
      console.log('INFINITY_DEV token not configured - skipping test');
      return;
    }

    if (tableKeys.length === 0) {
      console.log('No tables configured - skipping fetch test');
      return;
    }

    const firstKey = tableKeys[0];
    console.log(`Testing table: ${firstKey}`);

    const harvester = new InfinityHarvester({
      httpClient,
      configService,
      tableKey: firstKey,
      logger: console,
    });

    try {
      const username = configService.getHeadOfHousehold();
      const result = await harvester.harvest(username);

      console.log(`Status: ${result.status}`);
      console.log(`Items fetched: ${result.count || 0}`);

      if (result.items?.length > 0) {
        console.log('Sample item keys:', Object.keys(result.items[0]).join(', '));
        console.log('Sample folders:', [...new Set(result.items.map((i) => i.folder))].join(', '));
      }

      expect(result.status).toBe('success');
      expect(result.count).toBeGreaterThanOrEqual(0);
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('Invalid or expired token');
      } else if (error.response?.status === 404) {
        console.log('Table not found - check table ID');
      } else {
        throw error;
      }
    }
  }, 60000);

  it('fetches lists table specifically (if configured)', async () => {
    const token = configService.getSecret('INFINITY_DEV');
    if (!token) {
      console.log('INFINITY_DEV token not configured - skipping test');
      return;
    }

    if (!infinityConfig.lists) {
      console.log('infinity.lists not configured - skipping test');
      return;
    }

    const harvester = new InfinityHarvester({
      httpClient,
      configService,
      tableKey: 'lists',
      logger: console,
    });

    try {
      const username = configService.getHeadOfHousehold();
      const result = await harvester.harvest(username);

      console.log(`Lists table: ${result.count} items`);

      if (result.items?.length > 0) {
        // Group by folder
        const byFolder = {};
        for (const item of result.items) {
          byFolder[item.folder] = (byFolder[item.folder] || 0) + 1;
        }
        console.log('Items per folder:', byFolder);
      }

      expect(result.status).toBe('success');
    } catch (error) {
      console.log(`Error: ${error.message}`);
      throw error;
    }
  }, 60000);

  it('reports status correctly', () => {
    const token = configService.getSecret('INFINITY_DEV');
    if (!token || tableKeys.length === 0) {
      console.log('Skipping status test - no config');
      return;
    }

    const harvester = new InfinityHarvester({
      httpClient,
      configService,
      tableKey: tableKeys[0],
      logger: console,
    });

    const status = harvester.getStatus();

    console.log('Harvester status:', status);

    expect(status.serviceId).toBe(tableKeys[0]);
    expect(status.category).toBe('other');
    expect(status.configured).toBe(true);
    expect(status.circuitBreaker).toBeDefined();
  });
});
