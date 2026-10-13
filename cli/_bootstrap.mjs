import { readBuxferCredsDirect } from '../__app_modules/finance/cli/access.mjs';
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
import { execSync } from 'node:child_process';
import axios from 'axios';
import { initConfigService, getConfigService as getInstance, resetConfigService } from '#system/config/index.mjs';
import { HttpClient } from '#system/services/HttpClient.mjs';
import { HomeAssistantAdapter } from "../__capabilities/home-control/server/adapters/homeassistant/HomeAssistantAdapter.mjs";
import { JevAdapter } from '#adapters/ai/JevAdapter.mjs';
import { createSecretsProvider } from '#adapters/secrets/createSecretsProvider.mjs';
import { DataService } from '#adapters/persistence/files/DataService.mjs';
import { assertHomeAutomationGateway } from "../__capabilities/home-control/server/application/ports/IHomeAutomationGateway.mjs";
import { createWriteAuditor } from './_writeAudit.mjs';

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
let _finance = null;
let _financeInitPromise = null;
let _writeAuditor = null;
let _writeAuditorInitPromise = null;
let _conciergeConfig = null;
let _conciergeConfigPromise = null;
let _transcriptDir = null;
let _financeDirect = null;
let _healthAnalytics = null;
let _healthAnalyticsInitPromise = null;
let _decisionGateway;

/**
 * Resolve the data directory the same way __backend/index.js does:
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
      _configService = await initConfigService(dataDir, { secretsProviderFactory: createSecretsProvider });
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
 * The typed-decision model (IDecisionGateway, Jev), or null when
 * system/auth/jev.yml has no api_key. Callers must treat null as
 * "no model" and keep their non-model behaviour.
 *
 * Mirrors the fallback wiring in __backend/src/app.mjs (decisionGateway).
 *
 * @param {{ logger?: Object }} [opts]
 * @returns {Promise<import('#apps/common/ports/IDecisionGateway.mjs').IDecisionGateway|null>}
 */
export async function getDecisionGateway({ logger } = {}) {
  if (_decisionGateway !== undefined) return _decisionGateway;
  const configService = await getConfigService();
  const apiKey = configService.getSystemAuth?.('jev', 'api_key');
  _decisionGateway = apiKey ? new JevAdapter({ apiKey }, { httpClient: axios, logger }) : null;
  return _decisionGateway;
}

/**
 * Build the household's Home Assistant gateway.
 *
 * Returns an IHomeAutomationGateway (the port — never the concrete adapter).
 * Throws if HA isn't configured; commands map that to EXIT_CONFIG.
 *
 * Mirrors the wiring in __backend/src/0_system/registries/IntegrationLoader.mjs
 * #buildAdapterConfig — host comes from services.yml via resolveServiceUrl(),
 * token comes from household auth.
 */
export async function getHaGateway() {
  if (_haGateway) return _haGateway;
  if (_haInitPromise) return _haInitPromise;

  _haInitPromise = (async () => {
    const cfg = await getConfigService();
    // Home Assistant is a provider under the household capability
    // `home_automation`; older households may instead use the provider name
    // itself as the integration key. Accept both config-driven layouts.
    const integration = cfg.getHouseholdIntegration(null, 'homeassistant')
      ?? cfg.getHouseholdIntegration(null, 'home_automation');
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
 * Mirrors __backend/src/app.mjs createContentRegistry() call (line ~496),
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

    const { createContentRegistry } = await import('#composition/bootstrap.mjs');
    const { ContentQueryService } = await import("../__capabilities/content-catalog/server/application/ContentQueryService.mjs");

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
    _contentQuery.__registry = registry;
    return _contentQuery;
  })();

  return _contentInitPromise;
}

/**
 * Build the household's concierge memory accessor.
 *
 * Returns the ConciergeMemoryService (.get / .set / .merge over key strings)
 * with `__workingMemory` exposed so the `list` action can dump all keys via
 * the underlying WorkingMemoryState.getAll().
 *
 * Hardcoded agentId/userId match the ConciergeMemoryService's identity
 * ('concierge' / 'household').
 */
export async function getMemory() {
  if (_memory) return _memory;
  if (_memoryInitPromise) return _memoryInitPromise;

  _memoryInitPromise = (async () => {
    const cfg = await getConfigService();
    const dataService = new DataService({ configService: cfg });
    const { createConciergeMemoryAccess } = await import('../__app_modules/concierge/server/memory-access.mjs');
    const memory = await createConciergeMemoryAccess({ dataService });
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
export async function getFinance() {
  if (_finance) return _finance;
  if (_financeInitPromise) return _financeInitPromise;

  _financeInitPromise = (async () => {
    const { createFinanceAccess } = await import('../__app_modules/finance/cli/access.mjs');
    _finance = await createFinanceAccess({ getConfigService, getHttpClient });
    return _finance;
  })();

  return _financeInitPromise;
}

/**
 * Build the write-audit log writer. Append-only NDJSON, one file per UTC date,
 * stored under media/logs/cli/. Falls back to /tmp when the
 * data path is not writable (typical on dev hosts where the data volume is
 * Docker-owned).
 */
export async function getWriteAuditor() {
  if (_writeAuditor) return _writeAuditor;
  if (_writeAuditorInitPromise) return _writeAuditorInitPromise;

  _writeAuditorInitPromise = (async () => {
    const cfg = await getConfigService();
    // Append-only, unbounded, and read by nobody in __backend/src, cli or
    // frontend/src — an operator-inspectable trail, which is a log. Logs live in
    // media, not the committable tree. `cli` also named the mechanism rather
    // than a domain, so its old home failed the folder rule twice over.
    // _writeAudit keeps its /tmp fallback for a read-only volume.
    const baseDir = path.join(cfg.getMediaDir(), 'logs', 'cli');
    _writeAuditor = createWriteAuditor({ baseDir });
    return _writeAuditor;
  })();

  return _writeAuditorInitPromise;
}

/**
 * Load the household concierge.yml app config (satellites, scopes, media policy).
 * Re-reads from disk so changes to the YAML are picked up without restarting
 * the CLI process.
 */
export async function getConciergeConfig() {
  if (_conciergeConfig) return _conciergeConfig;
  if (_conciergeConfigPromise) return _conciergeConfigPromise;

  _conciergeConfigPromise = (async () => {
    const cfg = await getConfigService();
    const value = cfg.reloadHouseholdAppConfig?.(null, 'concierge')
                  ?? cfg.getHouseholdAppConfig?.(null, 'concierge');
    if (!value) {
      throw new Error('Concierge config not found (data/household/agents/concierge.yml).');
    }
    _conciergeConfig = value;
    return _conciergeConfig;
  })();

  return _conciergeConfigPromise;
}

/**
 * Read Buxfer credentials without ConfigService — needed for `dscli finance --direct`
 * which is meant to work without the app server / bootstrap chain.
 *
 * Lookup order (mirrors cli/buxfer.cli.mjs):
 *   1. BUXFER_EMAIL + BUXFER_PASSWORD env vars
 *   2. `sudo docker exec daylight-station cat data/household/auth/buxfer.yml`
 *
 * The dockerExec param is overridable for testing.
 */


/**
 * Build a Buxfer adapter without going through ConfigService — for `--direct`
 * usage where the user doesn't have the data volume mounted or the app server
 * isn't running. Credentials come from BUXFER_EMAIL+BUXFER_PASSWORD env or via
 * `sudo docker exec daylight-station cat data/household/auth/buxfer.yml`.
 */
export async function getFinanceDirect() {
  if (_financeDirect) return _financeDirect;
  const { createDirectFinanceAccess } = await import('../__app_modules/finance/cli/access.mjs');
  _financeDirect = await createDirectFinanceAccess({ getHttpClient });
  return _financeDirect;
}

// Exported for unit tests only — not part of the public factory API.
export { readBuxferCredsDirect as _readBuxferCredsDirect };

/**
 * Build the household's HealthAnalyticsService for the dscli health
 * subcommands. Uses the same domain service the in-process HealthCoachAgent
 * uses — one set of analytics, two transports.
 *
 * Wiring (mirrors __backend/src/5_composition/bootstrap.mjs around line 2587):
 *   healthStore     ← YamlHealthDatastore({ dataService, configService })
 *   healthService   ← AggregateHealthUseCase({ healthStore })   (exposes getHealthForRange)
 *   periodResolver  ← new PeriodResolver()
 *
 * No HTTP, no backend running needed.
 */
export async function getHealthAnalytics() {
  if (_healthAnalytics) return _healthAnalytics;
  if (_healthAnalyticsInitPromise) return _healthAnalyticsInitPromise;

  _healthAnalyticsInitPromise = (async () => {
    const cfg = await getConfigService();

    const dataService                = new DataService({ configService: cfg });
    const { createHealthCliAnalytics } = await import("../__app_modules/health/server/composition/cli-analytics.mjs");
    _healthAnalytics = await createHealthCliAnalytics({ configService: cfg, dataService });
    return _healthAnalytics;
  })();

  return _healthAnalyticsInitPromise;
}

/**
 * Resolve the directory where ConciergeTranscript writes per-request transcript
 * JSON files. Mirrors __backend/src/app.mjs which sets
 *   mediaLogsDir = path.join(configService.getMediaDir(), 'logs')
 * and ConciergeTranscript writes to {mediaLogsDir}/concierge/...
 */
export async function getTranscriptDir() {
  if (_transcriptDir) return _transcriptDir;
  const cfg = await getConfigService();
  _transcriptDir = path.join(cfg.getMediaDir(), 'logs', 'concierge');
  return _transcriptDir;
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
  _finance = null;
  _financeInitPromise = null;
  _writeAuditor = null;
  _writeAuditorInitPromise = null;
  _conciergeConfig = null;
  _conciergeConfigPromise = null;
  _transcriptDir = null;
  _financeDirect = null;
  _healthAnalytics = null;
  _healthAnalyticsInitPromise = null;
  _decisionGateway = undefined;
  resetConfigService();
}
