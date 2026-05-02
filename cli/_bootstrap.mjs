/**
 * Lazy memoized factories for dscli command implementations.
 *
 * Each factory returns the same instance on repeated calls within one CLI
 * invocation. Commands import only the factories they need — `dscli ha state`
 * never pays the cost of constructing the content registry.
 *
 * To add a new factory: declare a module-level cache var, write an exported
 * async function that initializes once, and wire any cross-cutting deps from
 * the existing factories.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { initConfigService, getConfigService as getInstance, resetConfigService } from '#system/config/index.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';
import { HomeAssistantAdapter } from '#adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs';
import { assertHomeAutomationGateway } from '#apps/home-automation/ports/IHomeAutomationGateway.mjs';

const _isDocker = existsSync('/.dockerenv');

let _configService = null;
let _configInitPromise = null;
let _httpClient = null;
let _haGateway = null;
let _haInitPromise = null;
let _contentQuery = null;
let _contentInitPromise = null;
let _memory = null;
let _memoryInitPromise = null;
let _buxfer = null;
let _buxferInitPromise = null;

/**
 * Resolve the data directory the same way backend/index.js does:
 *   - /usr/src/app/data inside Docker (/.dockerenv present)
 *   - $DAYLIGHT_BASE_PATH/data otherwise
 */
function resolveDataDir() {
  if (_isDocker) {
    return '/usr/src/app/data';
  }
  return path.join(process.env.DAYLIGHT_BASE_PATH, 'data');
}

/**
 * Get the initialized ConfigService singleton.
 * Initializes from DAYLIGHT_BASE_PATH on first call; subsequent calls return
 * the same instance.
 *
 * @returns {Promise<import('#system/config/ConfigService.mjs').ConfigService>}
 */
export async function getConfigService() {
  if (_configService) return _configService;
  if (_configInitPromise) return _configInitPromise;

  if (!_isDocker && !process.env.DAYLIGHT_BASE_PATH) {
    throw new Error(
      'DAYLIGHT_BASE_PATH not set. ' +
      'Set DAYLIGHT_BASE_PATH to the directory containing data/ and media/.'
    );
  }

  _configInitPromise = (async () => {
    try {
      // If a previous init left the singleton populated, reuse it.
      _configService = getInstance();
      return _configService;
    } catch {
      // Not initialized yet — do it now.
      const dataDir = resolveDataDir();
      _configService = await initConfigService(dataDir);
      return _configService;
    }
  })();

  return _configInitPromise;
}

/**
 * Get a memoized HTTP client.
 *
 * @returns {HttpClient}
 */
export function getHttpClient() {
  if (_httpClient) return _httpClient;
  _httpClient = new HttpClient();
  return _httpClient;
}

/**
 * Build the household's Home Assistant gateway.
 *
 * Returns an IHomeAutomationGateway (the port — never the concrete adapter).
 * Throws if HA isn't configured; commands map that to EXIT_CONFIG.
 *
 * Mirrors the wiring in backend/src/0_system/registries/IntegrationLoader.mjs
 * #buildAdapterConfig — host comes from services.yml via resolveServiceUrl(),
 * token comes from household auth.
 */
export async function getHaGateway() {
  if (_haGateway) return _haGateway;
  if (_haInitPromise) return _haInitPromise;

  _haInitPromise = (async () => {
    const cfg = await getConfigService();
    const integration = cfg.getHouseholdIntegration(null, 'homeassistant');
    if (!integration) {
      throw new Error('Home Assistant integration not configured for default household.');
    }
    const auth = cfg.getHouseholdAuth('homeassistant');
    if (!auth?.token) {
      throw new Error('Home Assistant auth token missing (data/household/auth/homeassistant.yml).');
    }
    const baseUrl = cfg.resolveServiceUrl?.('homeassistant');
    if (!baseUrl) {
      throw new Error('Home Assistant baseUrl missing — set host in data/system/config/services.yml.');
    }
    const gateway = new HomeAssistantAdapter(
      { baseUrl, token: auth.token },
      { httpClient: getHttpClient() },
    );
    assertHomeAutomationGateway(gateway);
    _haGateway = gateway;
    return _haGateway;
  })();

  return _haInitPromise;
}

/**
 * Build a ContentQueryService for the household.
 *
 * Minimal Plex-only configuration — sufficient for `dscli content search`.
 * Other content sources (immich, audiobookshelf, etc.) are not wired into the
 * CLI yet; they'll be added when their commands need them.
 *
 * Mirrors backend/src/app.mjs createContentRegistry() call (line ~496),
 * stripped to just plex + mediaBasePath.
 */
export async function getContentQuery() {
  if (_contentQuery) return _contentQuery;
  if (_contentInitPromise) return _contentInitPromise;

  _contentInitPromise = (async () => {
    const cfg = await getConfigService();
    const plexHost = cfg.resolveServiceUrl?.('plex');
    const plexAuth = cfg.getHouseholdAuth('plex');
    if (!plexHost) {
      throw new Error('Plex host not configured (set in data/system/config/services.yml).');
    }
    if (!plexAuth?.token) {
      throw new Error('Plex auth token missing (data/household/auth/plex.yml).');
    }

    const { createContentRegistry } = await import('#system/bootstrap.mjs');
    const { ContentQueryService } = await import('#apps/content/ContentQueryService.mjs');

    const result = createContentRegistry(
      {
        plex: { host: plexHost, token: plexAuth.token },
        mediaBasePath: cfg.getMediaDir(),
      },
      {
        httpClient: getHttpClient(),
        configService: cfg,
      },
    );

    const { registry } = result;
    _contentQuery = new ContentQueryService({ registry });
    return _contentQuery;
  })();

  return _contentInitPromise;
}

/**
 * Build the household's concierge memory accessor.
 *
 * Returns the YamlConciergeMemoryAdapter (.get / .set / .merge over key strings)
 * with `__workingMemory` exposed so the `list` action can dump all keys via
 * the underlying WorkingMemoryState.getAll().
 *
 * Hardcoded agentId/userId match the YamlConciergeMemoryAdapter's internals
 * ('concierge' / 'household').
 */
export async function getMemory() {
  if (_memory) return _memory;
  if (_memoryInitPromise) return _memoryInitPromise;

  _memoryInitPromise = (async () => {
    await getConfigService();
    const { dataService } = await import('#system/config/index.mjs');
    const { YamlWorkingMemoryAdapter } = await import('#adapters/agents/YamlWorkingMemoryAdapter.mjs');
    const { YamlConciergeMemoryAdapter } = await import('#adapters/persistence/yaml/YamlConciergeMemoryAdapter.mjs');
    const workingMemory = new YamlWorkingMemoryAdapter({ dataService });
    const memory = new YamlConciergeMemoryAdapter({ workingMemory });
    // Stash the working memory so `dscli memory list` can dump all keys via
    // wm.load('concierge', 'household').then(state => state.getAll()).
    memory.__workingMemory = workingMemory;
    _memory = memory;
    return _memory;
  })();

  return _memoryInitPromise;
}

/**
 * Build the household's Buxfer adapter for finance operations.
 *
 * Auth from data/household/auth/buxfer.yml (email + password).
 * Throws with a clear message if creds are missing.
 */
export async function getBuxfer() {
  if (_buxfer) return _buxfer;
  if (_buxferInitPromise) return _buxferInitPromise;

  _buxferInitPromise = (async () => {
    const cfg = await getConfigService();
    const auth = cfg.getHouseholdAuth('buxfer');
    if (!auth?.email || !auth?.password) {
      throw new Error('Buxfer credentials missing (data/household/auth/buxfer.yml requires email + password).');
    }
    const { BuxferAdapter } = await import('#adapters/finance/BuxferAdapter.mjs');
    _buxfer = new BuxferAdapter(
      { email: auth.email, password: auth.password },
      { httpClient: getHttpClient() },
    );
    return _buxfer;
  })();

  return _buxferInitPromise;
}

/**
 * Reset all memoized state. For tests only.
 */
export function _resetForTests() {
  _configService = null;
  _configInitPromise = null;
  _httpClient = null;
  _haGateway = null;
  _haInitPromise = null;
  _contentQuery = null;
  _contentInitPromise = null;
  _memory = null;
  _memoryInitPromise = null;
  _buxfer = null;
  _buxferInitPromise = null;
  resetConfigService();
}
