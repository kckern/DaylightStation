import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'yaml';
import path, { join } from 'path';
import cors from 'cors'; // Step 2: Import cors
import request from 'request'; // Import the request module
import { createWebsocketServer } from './websocket.js';
import { createServer } from 'http';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const configExists = existsSync(`${__dirname}/../config.app.yml`);
const isDocker = existsSync('/.dockerenv');

const app = express();
app.use(cors()); // Step 3: Enable CORS for all routes

// Create HTTP server
const server = createServer(app);


async function initializeApp() {
  // Create WebSocket server FIRST, before any Express routes
  createWebsocketServer(server);

  // Exclude WebSocket paths from all Express middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/ws/')) {
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

    // Import routers dynamically after configuration is set
    const { default: cron } = await import('./cron.mjs');
    const { default: fetchRouter } = await import('./fetch.mjs');
    const { default: harvestRouter } = await import('./harvest.js');
    const { default: JournalistRouter } = await import('./journalist.mjs');
    const { default: homeRouter } = await import('./home.mjs');
    const { default: mediaRouter } = await import('./media.mjs');
    const { default: healthRouter } = await import('./health.mjs');
    const { default: exe } = await import('./exe.js');
    const { default: tts } = await import('./tts.mjs');

    // Backend API
    app.get('/debug', (_, res) => res.json({ process: { __dirname, env: process.env } }));
    app.use('/data', fetchRouter);
    
    app.use('/cron', cron);
    app.use("/harvest", harvestRouter);
    app.use("/journalist", JournalistRouter);
    app.use("/home", homeRouter);
    app.use("/media", mediaRouter);
    app.use("/health", healthRouter);
    app.use("/exe", exe);
    app.use("/tts", tts);


    // Proxy app for Plex
    const {host} = process.env.plex;
    app.use('/plex_proxy', (req, res) => {
      const url = `${host}${req.url.replace(/\/plex_proxy/, '')}${req.url.includes('?') ? '&' : '?'}${req.url.includes('X-Plex-Token') ? '' : `X-Plex-Token=${process.env.PLEX_TOKEN}`}`;
      // localhost:3112/plex_proxy/library/metadata/311217/thumb/1614603573

      console.log(`Proxying request to: ${url}`);

      const proxyRequest = request({ qs: req.query, uri: url });

      let responseSent = false;

      proxyRequest.on('error', (err) => {
        if (!responseSent) {
          responseSent = true;
          console.error(`Error proxying request to: ${url}`, err);
          res.status(500).json({ error: 'Failed to proxy request', details: err.message });
        }
      });

      req.pipe(proxyRequest).on('response', () => {
        responseSent = true;
      }).pipe(res);
    });


    // Frontend
    const frontendPath = join(__dirname, '../frontend/dist');
    const frontendExists = existsSync(frontendPath);
    if (frontendExists) {
      // Serve the frontend from the root URL
      app.use(express.static(frontendPath));

      // Forward non-matching paths to frontend for React Router to handle, but skip /ws/* for WebSocket
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/ws/')) {
          // Let the WebSocket server handle this
          return next();
        }
        res.sendFile(join(frontendPath, 'index.html'));
      });
    } else {
      console.log('Frontend not found. Redirecting to localhost:3111');
      console.log(`I was expecting to find the frontend at ${frontendPath} but it was not there. Please run the frontend build script first.`);
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
  server.listen(3112, () => {
    console.log('Listening on port 3112');
  });
}

// Initialize the app
initializeApp().catch(err => console.error('Error initializing app:', err));



// another app on port 3119 for an api
const api_app = express();
api_app.use(cors()); // Step 3: Enable CORS for all routes
async function initializeApiApp() {


  const { default: apiRouter } = await import('./api.mjs');

  api_app.use(express.json({
    strict: false // Allows parsing of JSON with single-quoted property names
  }));
  api_app.use('', apiRouter);
  
  api_app.listen(3119, () => {
    console.log('API app listening on port 3119');
  });



  
}

initializeApiApp().catch(err => console.error('Error initializing api app:', err));


