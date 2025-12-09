#!/usr/bin/env node

/**
 * Loggly CLI Utility
 * 
 * Usage:
 *   node scripts/loggly-cli.js [options]
 * 
 * Options:
 *   -q, --query <string>      Search query (default: "*")
 *   -f, --from <string>       Start time (default: "-1h")
 *   -u, --until <string>      End time (default: "now")
 *   -l, --limit <number>      Number of events to retrieve (default: 50)
 *   -o, --order <string>      Order: "asc" or "desc" (default: "desc")
 *   --stalls                  Preset query for stall lifecycle diagnostics
 *   --overlay                 Preset query for overlay visibility/summary
 *   --startup                 Preset query for startup watchdog signals
 *   --json                    Output raw JSON
 *   --help                    Show this help message
 * 
 * Environment Variables:
 *   LOGGLY_SUBDOMAIN          Your Loggly subdomain (required)
 *   LOGGLY_API_TOKEN          Your Loggly API Token (required for search)
 *   LOGGLY_TOKEN              Fallback for API Token (usually this is input token, but checked just in case)
 */

const axios = require('axios');
const path = require('path');

const formatArg = (arg) => {
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg, null, 2); }
  catch (_) { return String(arg); }
};

const write = (stream, ...args) => {
  stream.write(args.map(formatArg).join(' ') + '\n');
};

const logInfo = (...args) => write(process.stdout, ...args);
const logWarn = (...args) => write(process.stderr, ...args);
const logError = (...args) => write(process.stderr, ...args);

async function hydrateEnv() {
  try {
    const { hydrateProcessEnvFromConfigs } = await import('../backend/lib/logging/config.js');
    hydrateProcessEnvFromConfigs(path.resolve(__dirname, '..'));
  } catch (e) {
    logWarn('Warning: Failed to load YAML configuration files:', e.message);
  }
}

let envReady = false;

async function ensureEnv() {
  if (envReady) return;
  await hydrateEnv();
  envReady = true;
}

const PRESETS = {
  stalls: {
    query: 'media-resilience AND (stall OR stallId:*)',
    columns: [
      ['ts', 'timestamp'],
      ['event', 'event'],
      ['stallId', 'stallId'],
      ['waitKey', 'waitKey'],
      ['seconds', 'seconds'],
      ['bufferMs', 'bufferRunwayMs'],
      ['ready', 'readyState'],
      ['net', 'networkState'],
      ['progress', 'progressToken'],
      ['frame', 'frame.advancing'],
      ['durationMs', 'stallDurationMs']
    ]
  },
  overlay: {
    query: 'overlay-state-change OR overlay-summary OR overlay-ui',
    columns: [
      ['ts', 'timestamp'],
      ['event', 'event'],
      ['waitKey', 'waitKey'],
      ['label', 'overlayLabel'],
      ['visible', 'isVisible'],
      ['active', 'overlayActive'],
      ['reasons', 'reasons'],
      ['severity', 'severity']
    ]
  },
  startup: {
    query: 'startup-watchdog* OR startup-signal',
    columns: [
      ['ts', 'timestamp'],
      ['event', 'event'],
      ['waitKey', 'waitKey'],
      ['state', 'state'],
      ['reason', 'reason'],
      ['attempts', 'attempts'],
      ['elapsedMs', 'elapsedMs'],
      ['timeoutMs', 'timeoutMs']
    ]
  }
};

const args = process.argv.slice(2);
const options = {
  query: '*',
  from: '-1h',
  until: 'now',
  limit: 50,
  order: 'desc',
  json: false,
  preset: null
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-q':
    case '--query':
      options.query = args[++i];
      break;
    case '-f':
    case '--from':
      options.from = args[++i];
      break;
    case '-u':
    case '--until':
      options.until = args[++i];
      break;
    case '-l':
    case '--limit':
      options.limit = parseInt(args[++i], 10);
      break;
    case '-o':
    case '--order':
      options.order = args[++i];
      break;
    case '--stalls':
      options.preset = 'stalls';
      break;
    case '--overlay':
      options.preset = 'overlay';
      break;
    case '--startup':
      options.preset = 'startup';
      break;
    case '--json':
      options.json = true;
      break;
    case '--help':
      logInfo(`
Loggly CLI Utility

Usage:
  node scripts/loggly-cli.js [options]

Options:
  -q, --query <string>      Search query (default: "*")
  -f, --from <string>       Start time (default: "-1h")
  -u, --until <string>      End time (default: "now")
  -l, --limit <number>      Number of events to retrieve (default: 50)
  -o, --order <string>      Order: "asc" or "desc" (default: "desc")
  --stalls                  Preset query for stall lifecycle diagnostics
  --overlay                 Preset query for overlay visibility/summary
  --startup                 Preset query for startup watchdog signals
  --json                    Output raw JSON
  --help                    Show this help message
`);
      process.exit(0);
      break;
  }
}

const getPath = (obj, pathStr) => {
  if (!obj || !pathStr) return null;
  return pathStr.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
};

async function searchLogs() {
  try {
    await ensureEnv();
    const SUBDOMAIN = process.env.LOGGLY_SUBDOMAIN;
    const API_TOKEN = process.env.LOGGLY_API_TOKEN || process.env.LOGGLY_TOKEN;

    if (!SUBDOMAIN) {
      logError('Error: LOGGLY_SUBDOMAIN environment variable is required.');
      process.exit(1);
    }

    if (!API_TOKEN) {
      logError('Error: LOGGLY_API_TOKEN (or LOGGLY_TOKEN) environment variable is required.');
      logError('Note: You need an API Token from Loggly Settings > API Tokens, not just the Input Token.');
      process.exit(1);
    }

    const apiClient = axios.create({
      baseURL: `https://${SUBDOMAIN}.loggly.com/apiv2`,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`
      }
    });

    if (options.preset && PRESETS[options.preset]) {
      options.query = PRESETS[options.preset].query;
      // Modest defaults for presets
      if (options.from === '-1h' && options.preset === 'startup') {
        options.from = '-2h';
      }
      if (options.limit === 50) {
        options.limit = 100;
      }
    }
    if (!options.json) {
      logInfo(`Searching Loggly (${SUBDOMAIN})...`);
      logInfo(`Query: ${options.query}`);
      logInfo(`Time: ${options.from} to ${options.until}`);
      if (options.preset) {
        logInfo(`Preset: ${options.preset}`);
      }
    }

    // Step 1: Initiate Search
    const searchParams = new URLSearchParams({
      q: options.query,
      from: options.from,
      until: options.until,
      size: options.limit,
      order: options.order
    });

    const searchRes = await apiClient.get(`/search?${searchParams.toString()}`);
    const rsid = searchRes.data.rsid.id;

    if (!options.json) {
      logInfo(`Search initiated. RSID: ${rsid}. Waiting for results...`);
    }

    // Step 2: Retrieve Events
    // The events endpoint waits until results are ready
    const eventsRes = await apiClient.get(`/events?rsid=${rsid}`);
    const events = eventsRes.data.events;

    if (options.json) {
      logInfo(JSON.stringify(events, null, 2));
    } else {
      logInfo(`\nFound ${events.length} events:\n`);
      events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        const tags = (event.tags || []).join(', ');
        const preset = options.preset && PRESETS[options.preset];
        let message = event.logmsg;
        let parsed = null;

        try {
          if (typeof message === 'string' && (message.trim().startsWith('{') || message.trim().startsWith('['))) {
            parsed = JSON.parse(message);
          }
        } catch (_) {
          parsed = null;
        }

        if (preset && parsed && typeof parsed === 'object') {
          const row = preset.columns.map(([label, pathStr]) => {
            const value = pathStr === 'timestamp' ? timestamp : getPath(parsed, pathStr);
            return `${label}=${value == null ? 'n/a' : value}`;
          }).join(' ');
          logInfo(`[${timestamp}] [${tags}] ${row}`);
          return;
        }

        // fallback string formatting
        if (parsed) {
          if (parsed.data && typeof parsed.data === 'object') {
            logInfo({ timestamp, ...parsed.data });
          } else {
            const summary = parsed.message || parsed.event || message;
            logInfo(`[${timestamp}] [${tags}] ${summary} ${JSON.stringify(parsed)}`);
          }
        } else {
          logInfo(`[${timestamp}] [${tags}] ${message}`);
        }
      });
    }

  } catch (error) {
    if (error.response) {
      logError(`API Error: ${error.response.status} ${error.response.statusText}`);
      logError(JSON.stringify(error.response.data, null, 2));
      if (error.response.status === 401 || error.response.status === 403) {
        logError('\nCheck your LOGGLY_API_TOKEN. It must be a valid API Token (not Input Token).');
      }
    } else {
      logError('Error:', error.message);
    }
    process.exit(1);
  }
}

searchLogs();
