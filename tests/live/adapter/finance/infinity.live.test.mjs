/**
 * Infinity Live Integration Test
 *
 * Run with: npm test -- tests/integration/external/infinity/infinity.live.test.mjs
 *
 * Requires:
 * - INFINITY_DEV in secrets.yml (API token)
 * - infinity.workspace in system.yml (workspace ID)
 * - infinity.<tableKey> in system.yml (board IDs)
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { InfinityHarvester, createInfinityHarvesters } from '#adapters/harvester/other/InfinityHarvester.mjs';
import axios from 'axios';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireSecret, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Infinity Live Integration', () => {
  let httpClient;
  let infinityConfig;
  let tableKeys;
  let token;
  let workspace;

  beforeAll(() => {
    // FAIL if data path not configured
    const dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // Create HTTP client
    httpClient = axios.create({ timeout: 30000 });

    // FAIL if token not configured
    token = requireSecret('INFINITY_DEV', configService);

    // Get Infinity config
    infinityConfig = configService.get?.('infinity') || {};
    workspace = infinityConfig.workspace || process.env.INFINITY_WORKSPACE;

    // FAIL if workspace not configured
    requireConfig('infinity.workspace', workspace);

    // Get all table keys (excluding workspace, dev, UUIDs, and deprecated boards)
    const skipKeys = ['workspace', 'INFINITY_DEV', 'dev', 'program'];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    tableKeys = Object.keys(infinityConfig).filter(
      (k) => !skipKeys.includes(k) && !uuidPattern.test(infinityConfig[k])
    );
  });

  it('has valid credentials configured', () => {
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

    expect(Array.isArray(tableKeys)).toBe(true);
  });

  it('creates harvesters for all configured tables', () => {
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
    // FAIL if no tables configured
    if (tableKeys.length === 0) {
      throw new Error(
        '[PRECONDITION FAILED] No Infinity tables configured. ' +
        'Add infinity.<tableKey> to system.yml'
      );
    }

    const firstKey = tableKeys[0];
    console.log(`Testing table: ${firstKey}`);

    const harvester = new InfinityHarvester({
      httpClient,
      configService,
      tableKey: firstKey,
      logger: console,
    });

    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const result = await harvester.harvest(username);

    // Explicit skip for rate limiting
    if (result?.skipped || result?.status === 'skipped') {
      throw new SkipTestError(`Infinity skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error || result?.status === 'error') {
      throw new Error(`[ASSERTION FAILED] Infinity error: ${result.error || result.reason}`);
    }

    console.log(`Status: ${result.status}`);
    console.log(`Items fetched: ${result.count || 0}`);

    if (result.items?.length > 0) {
      console.log('Sample item keys:', Object.keys(result.items[0]).join(', '));
      console.log('Sample folders:', [...new Set(result.items.map((i) => i.folder))].join(', '));
    }

    expect(result.status).toBe('success');
    expect(result.count).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('fetches lists table specifically (if configured)', async () => {
    // Skip if lists table not configured
    if (!infinityConfig.lists) {
      throw new SkipTestError('infinity.lists not configured');
    }

    const harvester = new InfinityHarvester({
      httpClient,
      configService,
      tableKey: 'lists',
      logger: console,
    });

    const username = configService.getHeadOfHousehold();
    const result = await harvester.harvest(username);

    // FAIL on errors
    if (result?.status === 'error') {
      throw new Error(`[ASSERTION FAILED] Lists table error: ${result.reason}`);
    }

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
  }, 60000);

  it('reports status correctly', () => {
    // FAIL if no tables to test
    if (tableKeys.length === 0) {
      throw new Error('[PRECONDITION FAILED] No tables configured for status test');
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
