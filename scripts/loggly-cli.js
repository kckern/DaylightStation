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
 *   --json                    Output raw JSON
 *   --help                    Show this help message
 * 
 * Environment Variables:
 *   LOGGLY_SUBDOMAIN          Your Loggly subdomain (required)
 *   LOGGLY_API_TOKEN          Your Loggly API Token (required for search)
 *   LOGGLY_TOKEN              Fallback for API Token (usually this is input token, but checked just in case)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Load config files similar to backend/index.js
try {
  const rootDir = path.resolve(__dirname, '..');
  const appConfigPath = path.join(rootDir, 'config.app.yml');
  const secretsConfigPath = path.join(rootDir, 'config.secrets.yml');
  const localConfigPath = path.join(rootDir, 'config.app-local.yml');

  let appConfig = {};
  let secretsConfig = {};
  let localConfig = {};

  if (fs.existsSync(appConfigPath)) {
    appConfig = yaml.load(fs.readFileSync(appConfigPath, 'utf8'));
  }
  if (fs.existsSync(secretsConfigPath)) {
    secretsConfig = yaml.load(fs.readFileSync(secretsConfigPath, 'utf8'));
  }
  if (fs.existsSync(localConfigPath)) {
    localConfig = yaml.load(fs.readFileSync(localConfigPath, 'utf8'));
  }

  // Merge configs into process.env
  process.env = { ...process.env, ...appConfig, ...secretsConfig, ...localConfig };

} catch (e) {
  console.warn('Warning: Failed to load YAML configuration files:', e.message);
}

const SUBDOMAIN = process.env.LOGGLY_SUBDOMAIN;
const API_TOKEN = process.env.LOGGLY_API_TOKEN || process.env.LOGGLY_TOKEN;

if (!SUBDOMAIN) {
  console.error('Error: LOGGLY_SUBDOMAIN environment variable is required.');
  process.exit(1);
}

if (!API_TOKEN) {
  console.error('Error: LOGGLY_API_TOKEN (or LOGGLY_TOKEN) environment variable is required.');
  console.error('Note: You need an API Token from Loggly Settings > API Tokens, not just the Input Token.');
  process.exit(1);
}

const args = process.argv.slice(2);
const options = {
  query: '*',
  from: '-1h',
  until: 'now',
  limit: 50,
  order: 'desc',
  json: false
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
    case '--json':
      options.json = true;
      break;
    case '--help':
      console.log(`
Loggly CLI Utility

Usage:
  node scripts/loggly-cli.js [options]

Options:
  -q, --query <string>      Search query (default: "*")
  -f, --from <string>       Start time (default: "-1h")
  -u, --until <string>      End time (default: "now")
  -l, --limit <number>      Number of events to retrieve (default: 50)
  -o, --order <string>      Order: "asc" or "desc" (default: "desc")
  --json                    Output raw JSON
  --help                    Show this help message
`);
      process.exit(0);
      break;
  }
}

const apiClient = axios.create({
  baseURL: `https://${SUBDOMAIN}.loggly.com/apiv2`,
  headers: {
    'Authorization': `Bearer ${API_TOKEN}`
  }
});

async function searchLogs() {
  try {
    if (!options.json) {
      console.log(`Searching Loggly (${SUBDOMAIN})...`);
      console.log(`Query: ${options.query}`);
      console.log(`Time: ${options.from} to ${options.until}`);
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
      console.log(`Search initiated. RSID: ${rsid}. Waiting for results...`);
    }

    // Step 2: Retrieve Events
    // The events endpoint waits until results are ready
    const eventsRes = await apiClient.get(`/events?rsid=${rsid}`);
    
    const events = eventsRes.data.events;

    if (options.json) {
      console.log(JSON.stringify(events, null, 2));
    } else {
      console.log(`\nFound ${events.length} events:\n`);
      events.forEach(event => {
        const timestamp = new Date(event.timestamp).toISOString();
        const tags = event.tags.join(', ');
        let message = event.logmsg;
        
        // Try to parse JSON message if it looks like one
        try {
            if (typeof message === 'string' && (message.startsWith('{') || message.startsWith('['))) {
                const parsed = JSON.parse(message);
                // If it has a 'message' field, use that, otherwise show the whole object
                message = parsed.message || JSON.stringify(parsed);
                
                // If we have a 'meta' or 'context' object, maybe show it too
                if (parsed.meta) message += ` ${JSON.stringify(parsed.meta)}`;
                if (parsed.context) message += ` ${JSON.stringify(parsed.context)}`;
            }
        } catch (e) {
            // Keep original message
        }

        console.log(`[${timestamp}] [${tags}] ${message}`);
      });
    }

  } catch (error) {
    if (error.response) {
      console.error(`API Error: ${error.response.status} ${error.response.statusText}`);
      console.error(JSON.stringify(error.response.data, null, 2));
      if (error.response.status === 401 || error.response.status === 403) {
        console.error('\nCheck your LOGGLY_API_TOKEN. It must be a valid API Token (not Input Token).');
      }
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

searchLogs();
