// backend/src/5_composition/serverMain.mjs
/**
 * DaylightStation Backend Entry Point
 *
 * Routes all requests to the DDD backend (in src/).
 */

import { createServer } from 'http';
import dotenv from 'dotenv';
import { installCrashHandlers } from '#system/boot/installCrashHandlers.mjs';
import { backendModulePaths, resolveRuntimeDataPaths, runtimeLogDirectory } from '#system/boot/runtimePaths.mjs';
import { createServerRequestHandler } from '#api/serverRequestHandler.mjs';

installCrashHandlers();

import { initConfigService, ConfigValidationError, configService } from '#system/config/index.mjs';
import { hydrateProcessEnvFromConfigs, loadLoggingConfig, resolveLoggerLevel, getLoggingTags, resolveLogglyToken } from '#system/logging/config.mjs';
import { initializeLogging } from '#system/logging/dispatcher.mjs';
import { createConsoleTransport, createFileTransport, createHttpLogSinkTransport, initSessionFileTransport, initSessionEventsFileTransport } from '#system/logging/transports/index.mjs';
import { createSchoolLedgerTransport } from '#adapters/logging/SchoolLedgerTransport.mjs';
import { createLogglyTransport } from '#adapters/logging/LogglyTransport.mjs';
import { StartupMetricSamplingPolicy } from '#apps/logging/StartupMetricSamplingPolicy.mjs';
import { createLogger } from '#system/logging/logger.mjs';
import { resolveGeneralFileSinks } from '#system/logging/generalSinks.mjs';
import { createSecretsProvider } from '#adapters/secrets/createSecretsProvider.mjs';

const { envFile, repoRoot } = backendModulePaths(import.meta.url);
// Load repo-root .env deterministically (nodemon/working-dir can vary)
dotenv.config({ path: envFile });
const runtimePaths = resolveRuntimeDataPaths({ basePath: process.env.DAYLIGHT_BASE_PATH });
const { isDocker } = runtimePaths;

export async function main() {
  // ==========================================================================
  // Configuration
  // ==========================================================================

  console.log(`[Bootstrap] Env: DAYLIGHT_ENV=${process.env.DAYLIGHT_ENV ?? 'unset'}`);

  // Detect base directory from environment
  const { baseDir } = runtimePaths;

  if (!baseDir) {
    console.error('[Bootstrap] DAYLIGHT_BASE_PATH not set. Cannot start.');
    process.exit(1);
  }

  // Derive data directory from base (data and media are siblings)
  const { dataDir, configDir, configPaths, configExists } = runtimePaths;

  console.log(`[Bootstrap] Config source: ${configPaths.source}, dataDir: ${dataDir}`);

  // Hydrate process.env from config files (for logging config, etc.)
  hydrateProcessEnvFromConfigs(configDir);

  // Initialize ConfigService singleton (loads all YAML configs)
  try {
    await initConfigService(dataDir, { secretsProviderFactory: createSecretsProvider });
    console.log(`[Bootstrap] ConfigService initialized from ${dataDir}`);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error('[Bootstrap] Config validation failed:', err.message);
      process.exit(1);
    }
    // Ignore "already initialized" errors - can happen if app.mjs was loaded first
    if (!err.message?.includes('already initialized')) {
      throw err;
    }
  }

  // ==========================================================================
  // Logging
  // ==========================================================================

  const loggingConfig = loadLoggingConfig();
  const dispatcher = initializeLogging({
    defaultLevel: resolveLoggerLevel('backend', loggingConfig),
    componentLevels: loggingConfig.loggers || {},
    timezone: configService.getTimezone()
  });

  dispatcher.addTransport(createConsoleTransport({
    colorize: !isDocker,
    format: isDocker ? 'json' : 'pretty'
  }));

  // File sinks. The durable one at media/logs/backend.log is registered in
  // every environment now: it used to be skipped in Docker, and with Loggly
  // unconfigured in production that left stdout as the dispatcher's only
  // general transport — the log Docker truncated 90 minutes after the
  // 2026-08-16 remount storm. Which files, and their rotation bounds, is
  // policy and lives in generalSinks.mjs; the registration is wiring and lives
  // here. The transport rotates by size and re-opens through the new inode, so
  // buffered writes flush into the generation they belong to (see the comment
  // above openStream in file.mjs).
  //
  // Each registration is guarded because createFileTransport opens its
  // descriptor eagerly and throws if it cannot: before this change the only
  // file sink lived at the repo root, where that could not realistically fail,
  // and now one lives on the media mount, where a full disk, a read-only
  // remount or a permissions slip is a thing that happens. Following
  // schoolLedger's rule — a logging failure must cost the log, never the
  // server — degrade to the remaining transports and say so on stderr, which
  // is the one channel that cannot itself be the thing that broke.
  //
  // `logging.fileSink` in system.yml (path / maxSizeMb / maxFiles) overrides
  // the defaults, so an operator can move or resize the log without a code
  // change. The bounds are a decision about how much history the next incident
  // gets — read the standing facts at the top of generalSinks.mjs first.
  const mediaDir = configService.getMediaDir();
  for (const sink of resolveGeneralFileSinks({
    isDocker,
    mediaDir,
    repoRoot,
    config: configService.get('logging.fileSink')
  })) {
    try {
      dispatcher.addTransport(createFileTransport(sink));
    } catch (err) {
      process.stderr.write(
        `[WARN] file log sink disabled: cannot write ${sink.filename} (${err?.code ?? err?.message}). `
        + 'Backend logs will still reach the console, but nothing there survives a restart.\n'
      );
    }
  }

  const logglyToken = resolveLogglyToken();
  const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
  if (logglyToken && logglySubdomain) {
    const startupMetricSampling = new StartupMetricSamplingPolicy();
    dispatcher.addTransport(createLogglyTransport({
      token: logglyToken,
      subdomain: logglySubdomain,
      tags: getLoggingTags(loggingConfig),
      acceptEvent: (event) => startupMetricSampling.accept(event),
    }));
  }

  // Remote log sink — queryable storage for the general event stream, which the
  // file sinks deliberately do not provide: they answer "did it survive a
  // restart", not "what happened across the household at 16:54". Everything
  // product-specific is in the configured URL, so the sink can be repointed
  // without touching code (`logging.remoteSink` in system-local.{env}.yml).
  //
  // Enabled per environment rather than everywhere: a dev machine shipping into
  // the household's stream makes the stream worse. Absent config is a no-op.
  //
  // Guarded like the file sinks, and for a stronger reason — this one is a
  // network call. `createHttpLogSinkTransport` is written not to throw, so the
  // try/catch is belt-and-braces around construction only; the same rule holds
  // either way, that a logging failure costs the log and never the server.
  const remoteSinkConfig = configService.get('logging.remoteSink');
  if (remoteSinkConfig?.enabled) {
    try {
      dispatcher.addTransport(createHttpLogSinkTransport(remoteSinkConfig));
    } catch (err) {
      process.stderr.write(
        `[WARN] remote log sink disabled: ${err?.message ?? err}. `
        + 'Backend logs still reach the console and the file sink.\n'
      );
    }
  }

  // Session file transport - writes per-app session logs to media/logs/
  //
  // 14 days, not 3. Three days assumed someone would go looking the same week,
  // and a household does not work that way: a kiosk problem is usually reported
  // days after it started, by a child, in passing. Two weeks spans that gap and
  // covers a holiday. Measured cost on prod: the 3-day window held 30.7 MB of
  // .jsonl and the 14-day window 32.7 MB, so the change costs about 2 MB today;
  // even at the busiest observed day-rate (18.2 MB) the ceiling is ~255 MB.
  // Pruning now runs on a daily timer inside the transport, so this window is
  // enforced continuously rather than only at boot.
  initSessionFileTransport({
    baseDir: runtimeLogDirectory(mediaDir),
    maxAgeDays: 14
  });

  // Session events file transport - stream-writes full-fidelity input telemetry
  // (channel:'input') to per-app .events files under media/logs/
  initSessionEventsFileTransport({
    baseDir: runtimeLogDirectory(mediaDir),
    maxAgeDays: 30
  });

  // School ledger - dated JSONL of every `school.*` event, so a term's worth of
  // issuance, grading and enrollment history outlives a container restart. In
  // Docker the only other transports are console and Loggly, which meant the
  // School record lived in stdout and a redeploy erased the evidence for the
  // very problem that prompted it.
  dispatcher.addTransport(createSchoolLedgerTransport({
    baseDir: runtimeLogDirectory(mediaDir),
    maxAgeDays: 400
  }));

  const logger = createLogger({
    source: 'backend',
    app: 'router',
    context: { env: process.env.NODE_ENV }
  });

  // Validate data directory permissions
  const { validateDataPermissions } = await import('../0_system/boot/validateDataPermissions.mjs');
  validateDataPermissions({ dataDir, logger });

  // ==========================================================================
  // Create HTTP Server and Load Backend
  // ==========================================================================

  const server = createServer();

  logger.info('router.loading_backend', { message: 'Loading DDD backend...' });

  const { createApp } = await import('../app.mjs');
  const app = await createApp({
    server,
    logger,
    configPaths,
    configExists
  });
  logger.info('router.backend_loaded', { message: 'DDD backend loaded' });

  // ==========================================================================
  // Request Routing
  // ==========================================================================

  server.on('request', createServerRequestHandler({ app }));

  // ==========================================================================
  // Start Server
  // ==========================================================================

  // Get port from ConfigService
  // In prod (Docker): backend serves everything on app.port
  // In dev: Vite serves on app.port, backend hides on app.port + 1
  const appPort = configService.getAppPort();
  const port = isDocker ? appPort : appPort + 1;
  server.listen(port, '0.0.0.0', () => {
    logger.info('server.started', {
      port,
      appPort,
      host: '0.0.0.0',
      mode: isDocker ? 'production' : 'development',
      message: isDocker
        ? 'Production: backend serves static + API'
        : `Development: backend on ${port}, Vite expected on ${appPort}`
    });
  });

  // ==========================================================================
  // Self-memory watchdog
  // ==========================================================================
  // The backend had no visibility into its own RSS, so a slow leak climbed to
  // ~19.5 GB over ~4.75h on 2026-07-04 and took the host into swap-death before
  // anyone noticed. Log the memory breakdown every 5 min so a climb is visible
  // in the logs (and greppable) long before it becomes an outage. The split of
  // heapUsed (JS objects) vs external/arrayBuffers (off-heap Buffers) also tells
  // us WHICH kind of leak we're chasing. `warn` above ~2 GB RSS so it stands out.
  const MB = 1024 * 1024;
  const memInterval = setInterval(() => {
    const m = process.memoryUsage();
    const data = {
      rssMB: Math.round(m.rss / MB),
      heapUsedMB: Math.round(m.heapUsed / MB),
      heapTotalMB: Math.round(m.heapTotal / MB),
      externalMB: Math.round(m.external / MB),
      arrayBuffersMB: Math.round((m.arrayBuffers || 0) / MB),
    };
    const level = data.rssMB > 2048 ? 'warn' : 'info';
    logger[level]('server.memory', data);
  }, 5 * 60 * 1000);
  memInterval.unref?.();
}
