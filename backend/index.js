import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path, { join } from 'path';
import cors from 'cors'; // Step 2: Import cors
import request from 'request'; // Import the request module
import { createWebsocketServer } from './websocket.js';
import { createServer } from 'http';
import { loadFile } from './lib/io.mjs';
import { createLogger, logglyTransportAdapter, resolveLogglyToken } from './lib/logging/index.js';
import { loadLoggingConfig, resolveLoggerLevel, getLoggingTags } from './lib/logging/config.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const configExists = existsSync(`${__dirname}/../config.app.yml`);
const isDocker = existsSync('/.dockerenv');

let loggingConfig = loadLoggingConfig();

const buildTransports = (tagsOverride) => {
  const tags = tagsOverride || getLoggingTags(loggingConfig) || ['backend', 'api'];
  const transports = [];
  const token = resolveLogglyToken();
  if (token) transports.push(logglyTransportAdapter({ token, tags }));
  return transports;
};

let rootLogger = createLogger({
  name: 'DaylightBackend',
  context: { app: 'api', env: process.env.NODE_ENV },
  level: resolveLoggerLevel('backend', loggingConfig),
  transports: buildTransports()
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

    // Parse the YAML files
    const appConfig = parse(readFileSync(join(__dirname, '../config.app.yml'), 'utf8'));
    const secretsConfig = parse(readFileSync(join(__dirname, '../config.secrets.yml'), 'utf8'));
    const localConfig = !isDocker ? parse(readFileSync(join(__dirname, '../config.app-local.yml'), 'utf8')) : {};

    // Construct the process.env object
    process.env = { ...process.env, isDocker, ...appConfig, ...secretsConfig, ...localConfig };
    loggingConfig = loadLoggingConfig();

    // Recreate logger with updated env/config
    rootLogger = createLogger({
      name: 'DaylightBackend',
      context: { app: 'api', env: process.env.NODE_ENV },
      level: resolveLoggerLevel('backend', loggingConfig),
      transports: buildTransports()
    });

    // Initialize WebSocket server after config is loaded
    createWebsocketServer(server);

    // Import routers dynamically after configuration is set
    const { default: cron } = await import('./cron.mjs');
    const { default: fetchRouter } = await import('./fetch.mjs');
    const { default: harvestRouter } = await import('./harvest.js');
    const { default: JournalistRouter } = await import('./journalist.mjs');
    const { default: homeRouter } = await import('./home.mjs');
    const { default: mediaRouter } = await import('./media.mjs');
    const { default: healthRouter } = await import('./health.mjs');
    const { default: lifelogRouter } = await import('./lifelog.mjs');
    const { default: fitnessRouter } = await import('./fitness.mjs');
    const { default: printerRouter } = await import('./printer.mjs');
    const { default: gratitudeRouter } = await import('./gratitude.mjs');
    const { default: plexRouter } = await import('./plex.mjs');


    const { default: exe } = await import('./exe.js');
    const { default: tts } = await import('./tts.mjs');

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
    
    // Health check endpoints
    app.get('/api/ping', (_, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
    app.get('/api/status', (_, res) => res.status(200).json({ 
      status: 'ok', 
      uptime: process.uptime(), 
      timestamp: new Date().toISOString(),
      serverdata: loadFile("config/cron")
    }));
    app.get('/api/status/nas', (_, res) => res.status(200).json({ 
      status: 'ok', 
      accessible: true,
      timestamp: new Date().toISOString()
    }));
    
    app.use('/data', fetchRouter);
    
    app.use('/cron', cron);
    app.use("/harvest", harvestRouter);
    app.use("/journalist", JournalistRouter);
    app.use("/home", homeRouter);
    app.use("/media", mediaRouter);
    app.use("/api/health", healthRouter);
    app.use("/api/lifelog", lifelogRouter);
    app.use("/api/fitness", fitnessRouter);
    app.use("/exe", exe);
    app.use("/print", printerRouter);
    app.use("/tts", tts);
    app.use("/api/gratitude", gratitudeRouter);
    app.use("/plex_proxy", plexRouter);


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
      rootLogger.warn('frontend.missing', { path: frontendPath }, { message: 'Frontend not found. Redirecting to localhost:3111' });
      rootLogger.warn('frontend.missing.redirect', { target: 'http://localhost:3111' });
      app.use('/', (req, res, next) => {
        if (req.path.startsWith('/ws/')) return next();
        res.redirect('http://localhost:3111');
      });
    }

  } else {
    app.get("*", function (req, res, next) {
      if (req.path.startsWith('/ws/')) return next();
      res.status(500).json({ error: 'This application is not configured yet. Please add a config.app.yml file to the root of the project.' });
    });
  }

  // Start HTTP server
  const port = process.env.PORT || 3112;
  server.listen(port, () => {
    rootLogger.info('server.listen', { port });
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
  api_app.use('', apiRouter);
  
  api_app.listen(3119, () => {
    rootLogger.info('api.secondary.listen', { port: 3119 });
  });



  
}

initializeApiApp().catch(err => rootLogger.error('api.secondary.init.failure', { message: err?.message || err, stack: err?.stack }));


