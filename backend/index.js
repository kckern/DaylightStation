import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path, { join } from 'path';
import cors from 'cors'; // Step 2: Import cors
import request from 'request'; // Import the request module
import { createWebsocketServer } from './routers/websocket.mjs';
import { createServer } from 'http';
import { loadFile } from './lib/io.mjs';
import 'dotenv/config'; // Load .env file
import { initMqttSubscriber } from './lib/mqtt.mjs';
import { userDataService } from './lib/config/UserDataService.mjs';

// Config path resolver and loader
import { resolveConfigPaths, getConfigFilePaths } from './lib/config/pathResolver.mjs';
import { loadAllConfig, logConfigSummary } from './lib/config/loader.mjs';

// ConfigService v2 (primary config system)
import { initConfigService, ConfigValidationError, configService } from './lib/config/index.mjs';


// Logging system
import { initializeLogging, getDispatcher } from './lib/logging/dispatcher.js';
import { createConsoleTransport, createLogglyTransport, createFileTransport } from './lib/logging/transports/index.js';
import { createLogger } from './lib/logging/logger.js';
import { ingestFrontendLogs } from './lib/logging/ingestion.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags, hydrateProcessEnvFromConfigs, resolveLogglyToken } from './lib/logging/config.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const isDocker = existsSync('/.dockerenv');

// Resolve config paths (from env vars, mount, or fallback)
const configPaths = resolveConfigPaths({ isDocker, codebaseDir: join(__dirname, '..') });

if (configPaths.error) {
  console.error('[FATAL] Configuration error:', configPaths.error);
  console.error('[FATAL] Set DAYLIGHT_CONFIG_PATH and DAYLIGHT_DATA_PATH environment variables');
  process.exit(1);
}

console.log(`[Config] Source: ${configPaths.source}, Config: ${configPaths.configDir}`);

// Check for config files in resolved path
const configFiles = getConfigFilePaths(configPaths.configDir);
const configExists = configFiles && existsSync(configFiles.system);

// Load configuration from YAML files into process.env (for logging config)
hydrateProcessEnvFromConfigs(configPaths.configDir);

// Initialize ConfigService v2 (primary config system)
// Fails fast if config is invalid - this is intentional
try {
  initConfigService(configPaths.dataDir);
  console.log('[Config] ConfigService v2 initialized with dataDir:', configPaths.dataDir);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error('[FATAL] Config validation failed:');
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}


let loggingConfig = loadLoggingConfig();

// Initialize the new unified logging system
const dispatcher = initializeLogging({
  defaultLevel: resolveLoggerLevel('backend', loggingConfig),
  componentLevels: loggingConfig.loggers || {}
});

// Add console transport
dispatcher.addTransport(createConsoleTransport({
  colorize: !isDocker,
  format: isDocker ? 'json' : 'pretty'
}));

// Add file transport in development mode (with log rotation)
if (!isDocker) {
  dispatcher.addTransport(createFileTransport({
    filename: join(__dirname, '..', 'dev.log'),
    format: 'json', // JSON format for easier parsing
    maxSize: 50 * 1024 * 1024, // 50 MB before rotation
    maxFiles: 3, // Keep 3 rotated files (dev.log, dev.log.1, dev.log.2)
    colorize: false
  }));
  console.log('[Logging] File transport enabled: dev.log (max 50MB, 3 files)');
}

// Add Loggly transport if configured
const logglyToken = resolveLogglyToken();
const logglySubdomain = process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;
if (logglyToken && logglySubdomain) {
  dispatcher.addTransport(createLogglyTransport({
    token: logglyToken,
    subdomain: logglySubdomain,
    tags: getLoggingTags(loggingConfig) || ['daylight', 'backend']
  }));
}

// Create the root logger using the new system
let rootLogger = createLogger({
  source: 'backend',
  app: 'api',
  context: { env: process.env.NODE_ENV }
});

const app = express();
app.use(cors()); // Step 3: Enable CORS for all routes
app.use(express.json({ limit: '50mb' })); // Parse JSON request bodies with increased limit for voice memos
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Parse URL-encoded bodies

// Create HTTP server
const server = createServer(app);


async function initializeApp() {
  // Create WebSocket server FIRST, before any Express routes
  // createWebsocketServer(server);

  // Exclude WebSocket paths from all Express middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/ws')) {
      return next('route'); // Skip all remaining middleware for this route
    }
    next();
  });

  if (configExists) {

    // Load all config using unified loader
    const configResult = loadAllConfig({
      configDir: configPaths.configDir,
      dataDir: configPaths.dataDir,
      isDocker,
      isDev: !isDocker
    });

    // Populate process.env with merged config
    process.env = { 
      ...process.env, 
      isDocker, 
      ...configResult.config
    };
    
    loggingConfig = loadLoggingConfig();

    // Update dispatcher level and component levels if needed
    dispatcher.setLevel(resolveLoggerLevel('backend', loggingConfig));
    dispatcher.componentLevels = loggingConfig.loggers || {};

    // Recreate root logger with updated context (new system)
    rootLogger = createLogger({
      source: 'backend',
      app: 'api',
      context: { env: process.env.NODE_ENV }
    });
    
    // Log config loading summary
    logConfigSummary(configResult, rootLogger);

    // Validate configuration and log status
    const { validateConfig, getConfigStatusSummary } = await import('./lib/config/healthcheck.mjs');
    const configValidation = validateConfig({ logger: rootLogger, verbose: false });
    if (!configValidation.valid) {
      rootLogger.error('config.startup.invalid', { 
        issues: configValidation.issues,
        warnings: configValidation.warnings 
      });
    }
    // Log config summary in dev mode
    if (!isDocker) {
      console.log('\n' + getConfigStatusSummary() + '\n');
    }

    // Initialize WebSocket server after config is loaded
    createWebsocketServer(server);

    // Initialize MQTT subscriber for vibration sensors (fitness)
    try {
      const householdId = configService.getDefaultHouseholdId();
      const householdConfig = userDataService.readHouseholdAppData(householdId, 'fitness', 'config');
      let legacyFitnessConfig = {};
      const dataRoot = process.env.path?.data;
      const legacyYml = dataRoot && path.join(dataRoot, 'config/apps/fitness.yml');
      const legacyYaml = dataRoot && path.join(dataRoot, 'config/apps/fitness.yaml');
      if ((legacyYml && existsSync(legacyYml)) || (legacyYaml && existsSync(legacyYaml))) {
        legacyFitnessConfig = loadFile('config/apps/fitness') || {};
      }
      const equipmentConfig = householdConfig?.equipment || legacyFitnessConfig.equipment || [];

      if (process.env.mqtt) {
        initMqttSubscriber(equipmentConfig);
      } else {
        rootLogger.warn('mqtt.not_configured', { message: 'process.env.mqtt missing; skipping MQTT init' });
      }
    } catch (err) {
      rootLogger.error('mqtt.init.failed', { error: err?.message });
    }

    // Import routers dynamically after configuration is set
    const { default: cron } = await import('./routers/cron.mjs');
    const { default: fetchRouter } = await import('./routers/fetch.mjs');
    const { default: harvestRouter } = await import('./routers/harvest.mjs');
    // JournalistRouter now handled in api.mjs for proxy_toggle support
    const { default: homeRouter } = await import('./routers/home.mjs');
    const { default: mediaRouter } = await import('./routers/media.mjs');
    const { default: healthRouter } = await import('./routers/health.mjs');
    const { default: lifelogRouter } = await import('./routers/lifelog.mjs');
    const { default: fitnessRouter } = await import('./routers/fitness.mjs');
    const { default: printerRouter } = await import('./routers/printer.mjs');
    const { default: gratitudeRouter } = await import('./routers/gratitude.mjs');
    const { default: plexProxyRouter } = await import('./routers/plexProxy.mjs');


    const { default: exe } = await import('./routers/exe.mjs');
    const { default: tts } = await import('./routers/tts.mjs');

    // Backend API
    app.post('/api/logs', (req, res) => {
      const body = req.body;
      const entries = Array.isArray(body) ? body : [body];
      const ingestLogger = rootLogger.child({ module: 'http-logs' });
      const allowedLevels = new Set(['debug', 'info', 'warn', 'error']);
      let accepted = 0;

      for (const entry of entries) {
        if (!entry || typeof entry.event !== 'string') continue;
        const level = String(entry.level || 'info').toLowerCase();
        const safeLevel = allowedLevels.has(level) ? level : 'info';
        const data = entry.data || entry.payload || {};
        const context = entry.context || {};
        const tags = entry.tags || [];
        ingestLogger[safeLevel](entry.event, data, {
          message: entry.message,
          context,
          tags,
          source: entry.source || 'http-logs'
        });
        accepted += 1;
      }

      if (!accepted) {
        return res.status(400).json({ status: 'error', message: 'No valid log events' });
      }
      return res.status(202).json({ status: 'ok', accepted });
    });
    app.get('/debug', (_, res) => res.json({ process: { __dirname, env: process.env } }));
    app.get('/debug/log', (req, res) => {
      const msg = req.query.message || 'Test log from /debug/log';
      rootLogger.info('debug.log.test', { message: msg, type: 'info' });
      rootLogger.warn('debug.log.test', { message: msg, type: 'warn' });
      rootLogger.error('debug.log.test', { message: msg, type: 'error' });
      res.json({ status: 'ok', message: 'Logs emitted', content: msg });
    });

    // Logging health/metrics endpoint
    app.get('/api/logging/health', (_, res) => {
      const metrics = dispatcher.getMetrics();
      const transports = dispatcher.getTransportNames();
      res.json({
        status: 'ok',
        dispatcher: metrics,
        transports: transports.map(name => ({ name, status: 'ok' })),
        level: loggingConfig.defaultLevel || 'info'
      });
    });
    
    // Health check endpoints
    app.get('/api/ping', (_, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
    app.get('/api/status', (_, res) => res.status(200).json({ 
      status: 'ok', 
      uptime: process.uptime(), 
      timestamp: new Date().toISOString(),
      serverdata: loadFile("state/cron")
    }));
    app.get('/api/status/nas', (_, res) => res.status(200).json({ 
      status: 'ok', 
      accessible: true,
      timestamp: new Date().toISOString()
    }));
    
    // Helper to get household head user
    const getHouseholdHead = () => {
      const dataPath = process.env.path?.data || '/usr/src/app/data';
      const hid = process.env.household_id || 'default';
      const householdPath = `${dataPath}/households/${hid}/household.yml`;
      try {
        const householdData = parse(readFileSync(householdPath, 'utf8'));
        return householdData?.head || '{username}';
      } catch (err) {
        rootLogger.warn('household.head.error', { error: err.message });
        return '{username}';
      }
    };
    
    // Redirect /data/lifelog/* to /data/users/{head}/lifelog/*
    // This allows frontend to use simple paths without specifying user
    app.get('/data/lifelog/*', (req, res) => {
      const headUser = getHouseholdHead();
      const remainder = req.params[0];
      res.redirect(`/data/users/${headUser}/lifelog/${remainder}`);
    });
    
    // Redirect household-level data to households/{hid}/shared/
    app.get('/data/weather', (req, res) => {
      const hid = process.env.household_id || 'default';
      res.redirect(`/data/households/${hid}/shared/weather`);
    });
    app.get('/data/events', (req, res) => {
      const hid = process.env.household_id || 'default';
      res.redirect(`/data/households/${hid}/shared/events`);
    });
    app.get('/data/calendar', (req, res) => {
      const hid = process.env.household_id || 'default';
      res.redirect(`/data/households/${hid}/shared/calendar`);
    });
    
    app.use('/data', fetchRouter);
    
    app.use('/cron', cron);
    app.use("/harvest", harvestRouter);
    // JournalistRouter now handled via /api/journalist in api.mjs
    app.use("/home", homeRouter);
    app.use("/media", mediaRouter);
    app.use("/api/health", healthRouter);
    app.use("/api/lifelog", lifelogRouter);
    app.use("/api/fitness", fitnessRouter);
    app.use("/exe", exe);
    app.use("/print", printerRouter);
    app.use("/tts", tts);
    app.use("/api/gratitude", gratitudeRouter);
    app.use("/plex_proxy", plexProxyRouter);

    // Mount API router on main app for webhook routes (journalist, foodlog)
    const { default: apiRouter } = await import('./api.mjs');
    app.use("/api", apiRouter);


    // Frontend
    const frontendPath = join(__dirname, '../frontend/dist');
    const frontendExists = existsSync(frontendPath);
    if (frontendExists) {
      // Serve the frontend from the root URL
      app.use(express.static(frontendPath));

      // Forward non-matching paths to frontend for React Router to handle, but skip /ws/* for WebSocket
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/ws')) {
          // Let the WebSocket server handle this
          return next();
        }
        res.sendFile(join(frontendPath, 'index.html'));
      });
    } else {
      rootLogger.debug('frontend.dev.redirect', { path: frontendPath, target: 'http://localhost:3111' });
      app.use('/', (req, res, next) => {
        if (req.path.startsWith('/ws/')) return next();
        res.redirect('http://localhost:3111');
      });
    }

  } else {
    app.get("*", function (req, res, next) {
      if (req.path.startsWith('/ws/')) return next();
      res.status(500).json({ error: 'This application is not configured yet. Ensure system.yml exists in the data mount.' });
    });
  }

  // Start HTTP server
  // Start HTTP server - bind to 0.0.0.0 to ensure IPv4 compatibility
  // This prevents IPv6-only processes from intercepting localhost requests
  const port = process.env.PORT || 3112;
  const host = '0.0.0.0';
  server.listen(port, host, () => {
    rootLogger.info('server.started', { 
      port,
      host,
      env: process.env.NODE_ENV || 'development',
      transports: dispatcher.getTransportNames()
    });
  });
}

// Initialize the app
initializeApp().catch(err => rootLogger.error('server.init.failure', { error: err?.message, stack: err?.stack }));



// another app on port 3119 for an api
const api_app = express();
api_app.use(cors()); // Step 3: Enable CORS for all routes
async function initializeApiApp() {


  const { default: apiRouter } = await import('./api.mjs');

  api_app.use(express.json({
    limit: '50mb', // Increased limit for voice memo audio uploads
    strict: false // Allows parsing of JSON with single-quoted property names
  }));
  api_app.use(express.urlencoded({ limit: '50mb', extended: true }));
  api_app.use('', apiRouter);  // Mount at root - subdomain already indicates API
  
  api_app.listen(3119, () => {
    rootLogger.info('api.secondary.listen', { port: 3119 });
  });



  
}

initializeApiApp().catch(err => rootLogger.error('api.secondary.init.failure', { message: err?.message || err, stack: err?.stack }));


