#!/usr/bin/env node

/**
 * Strava CLI — Command-line CRUD for Strava activities
 *
 * Reads OAuth credentials from the DaylightStation auth files:
 *   data/system/auth/strava.yml          (client_id, client_secret)
 *   data/users/{user}/auth/strava.yml    (refresh, access_token, expires_at)
 *
 * Auto-refreshes the access token when expired and writes the new tokens
 * back to the user auth file (matching the StravaClientAdapter pattern).
 *
 * Usage:
 *   node cli/strava.cli.mjs <command> [args]
 *
 * Commands:
 *   me                          Show authenticated athlete info
 *   token                       Show access token status (TTL)
 *   refresh                     Force OAuth token refresh
 *   list [--days=N --page=N --per-page=N --json]
 *                               List recent activities
 *   get <id> [--json]           Get full activity details
 *   update <id> [opts]          Update activity metadata
 *                               Opts: --name="..." --type=Run --description="..."
 *                                     --gear=... --commute/--no-commute
 *                                     --hide/--show --trainer/--no-trainer
 *   delete <id> [--force]       Delete activity (--force required to confirm)
 *   create [opts]               Create a manual activity (no GPS/streams)
 *                               Opts: --name="..." --type=Workout --start=ISO
 *                                     --duration=600 (sec) --distance=meters
 *                                     --description="..." --trainer --commute
 *   streams <id> [--keys=time,heartrate,...] [--json]
 *                               Get activity streams
 *   help                        Show this message
 *
 * Environment:
 *   DAYLIGHT_BASE_PATH          Override project root (default: detect from script location)
 *   DAYLIGHT_USER               Override user (default: "kckern")
 *   DEBUG                       Print stack traces on error
 *
 * @module cli/strava
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import dotenv from 'dotenv';
import moment from 'moment-timezone';

// ---------------------------------------------------------------------------
// Bootstrap (matches cli/scripts/backfill-strava-enrichment.mjs pattern)
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker
  ? '/usr/src/app'
  : (process.env.DAYLIGHT_BASE_PATH || projectRoot);
const dataDir = path.join(baseDir, 'data');

// Try to use the project's FileIO utilities; fall back to direct js-yaml
let loadYamlSafe, saveYaml;
try {
  ({ loadYamlSafe, saveYaml } = await import('#system/utils/FileIO.mjs'));
} catch {
  const { readFileSync, writeFileSync, mkdirSync } = await import('fs');
  const yamlMod = await import('yaml');
  const Y = yamlMod.default || yamlMod;
  loadYamlSafe = (p) => {
    try {
      const full = p.endsWith('.yml') || p.endsWith('.yaml') ? p : `${p}.yml`;
      return Y.parse(readFileSync(full, 'utf-8'));
    } catch { return null; }
  };
  saveYaml = (p, data) => {
    const full = p.endsWith('.yml') || p.endsWith('.yaml') ? p : `${p}.yml`;
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, Y.stringify(data));
  };
}

// ---------------------------------------------------------------------------
// Constants & paths
// ---------------------------------------------------------------------------
const STRAVA_BASE = 'https://www.strava.com';
const username = process.env.DAYLIGHT_USER || 'kckern';

const systemAuthPath = path.join(dataDir, 'system', 'auth', 'strava.yml');
const userAuthBase   = path.join(dataDir, 'users', username, 'auth', 'strava'); // saveYaml appends .yml
const userAuthPath   = `${userAuthBase}.yml`;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function loadSystemAuth() {
  const data = loadYamlSafe(systemAuthPath);
  if (!data?.client_id || !data?.client_secret) {
    fail(`Strava system auth missing client_id/client_secret at ${systemAuthPath}`);
  }
  return data;
}

function loadUserAuth() {
  const data = loadYamlSafe(userAuthBase);
  if (!data?.refresh) {
    fail(`User auth missing refresh token at ${userAuthPath}`);
  }
  return data;
}

async function refreshIfNeeded({ force = false } = {}) {
  const auth = loadUserAuth();
  const now = Math.floor(Date.now() / 1000);

  // Token is valid for >60 seconds — skip refresh
  if (!force && auth.access_token && auth.expires_at && now < auth.expires_at - 60) {
    return auth;
  }

  const sys = loadSystemAuth();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refresh,
    client_id: String(sys.client_id),
    client_secret: sys.client_secret,
  });

  const res = await fetch(`${STRAVA_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    fail(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  const updated = {
    refresh: data.refresh_token || auth.refresh,
    access_token: data.access_token,
    expires_at: data.expires_at,
    updated_at: new Date().toISOString(),
  };

  saveYaml(userAuthBase, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------
async function api(endpoint, opts = {}) {
  const auth = await refreshIfNeeded();
  const url = `${STRAVA_BASE}/api/v3${endpoint}`;

  const headers = {
    Authorization: `Bearer ${auth.access_token}`,
    ...(opts.headers || {}),
  };

  const res = await fetch(url, { ...opts, headers });

  // 204 No Content (e.g., delete)
  if (res.status === 204) return null;

  let body;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    fail(`${opts.method || 'GET'} ${endpoint} failed (${res.status}):\n${detail}`);
  }

  return body;
}

// ---------------------------------------------------------------------------
// Arg helpers
// ---------------------------------------------------------------------------
function getArg(args, name) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === name) return args[i + 1] ?? '';
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return undefined;
}

function hasFlag(args, ...names) {
  return args.some(a => names.includes(a));
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function metersToMiles(m)   { return (m / 1609.34).toFixed(2); }
function secondsToMinutes(s){ return Math.round(s / 60); }
function ts(local)          { return String(local || '').slice(0, 16).replace('T', ' '); }

function formatActivityRow(a) {
  const dur = secondsToMinutes(a.moving_time || 0);
  const dist = a.distance ? `${metersToMiles(a.distance)}mi` : '';
  const hr = a.average_heartrate ? `HR${Math.round(a.average_heartrate)}` : '';
  return `  ${String(a.id).padEnd(11)} ${ts(a.start_date_local)}  ${(a.type || '').padEnd(15)} ${String(dur).padStart(3)}min ${dist.padEnd(8)} ${hr.padEnd(7)} ${a.name || ''}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdMe(args) {
  const me = await api('/athlete');
  if (hasFlag(args, '--json')) return console.log(JSON.stringify(me, null, 2));
  console.log(`Athlete ${me.id}: ${me.firstname} ${me.lastname}`);
  console.log(`  Username: ${me.username}`);
  console.log(`  Profile:  ${me.profile_medium || me.profile}`);
  console.log(`  Location: ${[me.city, me.state, me.country].filter(Boolean).join(', ')}`);
  console.log(`  Created:  ${me.created_at}`);
  if (me.weight) console.log(`  Weight:   ${(me.weight * 2.20462).toFixed(1)} lbs`);
  if (me.ftp)    console.log(`  FTP:      ${me.ftp} W`);
}

async function cmdToken() {
  const auth = await refreshIfNeeded();
  const now = Math.floor(Date.now() / 1000);
  const ttl = auth.expires_at - now;
  console.log(`User:        ${username}`);
  console.log(`Auth file:   ${userAuthPath}`);
  console.log(`Expires at:  ${moment.unix(auth.expires_at).format('YYYY-MM-DD HH:mm:ss Z')}`);
  console.log(`TTL:         ${Math.floor(ttl / 60)} min ${ttl % 60} sec`);
  console.log(`Updated at:  ${auth.updated_at}`);
}

async function cmdRefresh() {
  const before = loadUserAuth();
  const fresh = await refreshIfNeeded({ force: true });
  console.log('Token refreshed.');
  console.log(`  Old expiry: ${before.expires_at ? moment.unix(before.expires_at).format('YYYY-MM-DD HH:mm:ss') : '(none)'}`);
  console.log(`  New expiry: ${moment.unix(fresh.expires_at).format('YYYY-MM-DD HH:mm:ss')}`);
}

async function cmdList(args) {
  const days    = parseInt(getArg(args, '--days')     ?? '7',  10);
  const perPage = parseInt(getArg(args, '--per-page') ?? '30', 10);
  const page    = parseInt(getArg(args, '--page')     ?? '1',  10);

  const after = Math.floor(moment().subtract(days, 'days').unix());
  const params = new URLSearchParams({
    after:    String(after),
    page:     String(page),
    per_page: String(perPage),
  });
  const acts = await api(`/athlete/activities?${params}`);

  if (hasFlag(args, '--json')) return console.log(JSON.stringify(acts, null, 2));

  console.log(`${acts.length} activities in last ${days} days (page ${page}, per_page ${perPage}):`);
  for (const a of acts) console.log(formatActivityRow(a));
}

async function cmdGet(id, args) {
  const a = await api(`/activities/${id}`);
  if (hasFlag(args, '--json')) return console.log(JSON.stringify(a, null, 2));

  console.log(`Activity ${a.id}: ${a.name}`);
  console.log(`  URL:       https://www.strava.com/activities/${a.id}`);
  console.log(`  Type:      ${a.type}${a.sport_type && a.sport_type !== a.type ? ` (sport: ${a.sport_type})` : ''}`);
  console.log(`  Date:      ${a.start_date_local}`);
  console.log(`  Duration:  ${secondsToMinutes(a.moving_time)} min moving / ${secondsToMinutes(a.elapsed_time)} min elapsed`);
  if (a.distance)           console.log(`  Distance:  ${metersToMiles(a.distance)} mi (${a.distance.toFixed(0)} m)`);
  if (a.average_heartrate)  console.log(`  HR:        ${Math.round(a.average_heartrate)} avg, ${Math.round(a.max_heartrate || 0)} max`);
  if (a.suffer_score != null) console.log(`  Suffer:    ${a.suffer_score}`);
  if (a.calories)           console.log(`  Calories:  ${a.calories}`);
  if (a.device_name)        console.log(`  Device:    ${a.device_name}`);
  if (a.gear_id)            console.log(`  Gear:      ${a.gear_id}`);
  console.log(`  Trainer:   ${a.trainer ? 'yes' : 'no'} | Commute: ${a.commute ? 'yes' : 'no'} | Hidden: ${a.hide_from_home ? 'yes' : 'no'} | Manual: ${a.manual ? 'yes' : 'no'}`);
  if (a.description)        console.log(`  Description:\n    ${a.description.split('\n').join('\n    ')}`);
}

async function cmdUpdate(id, args) {
  const body = {};
  const name = getArg(args, '--name');         if (name        !== undefined) body.name = name;
  const type = getArg(args, '--type');         if (type        !== undefined) body.type = type;
  const sport = getArg(args, '--sport-type');  if (sport       !== undefined) body.sport_type = sport;
  const desc = getArg(args, '--description');  if (desc        !== undefined) body.description = desc;
  const gear = getArg(args, '--gear');         if (gear        !== undefined) body.gear_id = gear;

  // workout_type: accepts integer or alias.
  // Run: 0=default, 1=race, 2=long, 3=workout
  // Ride: 10=default, 11=race, 12=workout
  const wt = getArg(args, '--workout-type');
  if (wt !== undefined) {
    const aliases = { 'default': 0, 'race': 1, 'long': 2, 'long-run': 2, 'workout': 3,
                      'ride-default': 10, 'ride-race': 11, 'ride-workout': 12 };
    const n = aliases[String(wt).toLowerCase()] ?? parseInt(wt, 10);
    if (Number.isNaN(n)) fail(`Invalid --workout-type "${wt}". Use integer or one of: ${Object.keys(aliases).join(', ')}`);
    body.workout_type = n;
  }

  if (hasFlag(args, '--commute'))    body.commute = true;
  if (hasFlag(args, '--no-commute')) body.commute = false;
  if (hasFlag(args, '--hide'))       body.hide_from_home = true;
  if (hasFlag(args, '--show'))       body.hide_from_home = false;
  if (hasFlag(args, '--trainer'))    body.trainer = true;
  if (hasFlag(args, '--no-trainer')) body.trainer = false;

  if (Object.keys(body).length === 0) {
    fail('No update fields. Use --name, --type, --sport-type, --description, --gear, --workout-type, --commute/--no-commute, --hide/--show, --trainer/--no-trainer');
  }

  const result = await api(`/activities/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  console.log(`Updated activity ${id}:`);
  for (const [k, v] of Object.entries(body)) console.log(`  ${k}: ${JSON.stringify(v)}`);
  console.log(`  https://www.strava.com/activities/${result.id || id}`);
}

async function cmdDelete(id, args) {
  if (!hasFlag(args, '--force', '-f')) {
    const a = await api(`/activities/${id}`);
    console.log('About to DELETE:');
    console.log(formatActivityRow(a));
    console.log('\nThis is permanent. Re-run with --force to confirm.');
    process.exit(1);
  }
  await api(`/activities/${id}`, { method: 'DELETE' });
  console.log(`Deleted activity ${id}.`);
}

async function cmdCreate(args) {
  const name     = getArg(args, '--name')        ?? 'Manual Activity';
  const type     = getArg(args, '--type')        ?? 'Workout';
  const start    = getArg(args, '--start')       ?? moment().format('YYYY-MM-DDTHH:mm:ss');
  const duration = parseInt(getArg(args, '--duration') ?? '600', 10);
  const distance = getArg(args, '--distance');
  const desc     = getArg(args, '--description');

  const params = new URLSearchParams({
    name,
    type,
    start_date_local: start,
    elapsed_time: String(duration),
  });
  if (distance) params.set('distance', String(distance));
  if (desc)     params.set('description', desc);
  if (hasFlag(args, '--trainer')) params.set('trainer', '1');
  if (hasFlag(args, '--commute')) params.set('commute', '1');

  const result = await api(`/activities?${params}`, { method: 'POST' });
  console.log(`Created activity ${result.id}: ${result.name}`);
  console.log(`  Type:     ${result.type}`);
  console.log(`  Start:    ${result.start_date_local}`);
  console.log(`  Elapsed:  ${secondsToMinutes(result.elapsed_time)} min`);
  if (result.distance) console.log(`  Distance: ${metersToMiles(result.distance)} mi`);
  console.log(`  URL:      https://www.strava.com/activities/${result.id}`);
}

async function cmdStreams(id, args) {
  const keys = (getArg(args, '--keys') ?? 'time,heartrate,distance').split(',').map(s => s.trim());
  const params = new URLSearchParams({ keys: keys.join(','), key_by_type: 'true' });
  const streams = await api(`/activities/${id}/streams?${params}`);

  if (hasFlag(args, '--json')) return console.log(JSON.stringify(streams, null, 2));

  console.log(`Streams for activity ${id}:`);
  for (const [type, stream] of Object.entries(streams)) {
    console.log(`  ${type.padEnd(12)} ${String(stream.original_size || stream.data?.length || 0).padStart(6)} pts (resolution: ${stream.resolution || '?'}, type: ${stream.series_type || '?'})`);
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
function help() {
  console.log(`Strava CLI — DaylightStation

USAGE
  node cli/strava.cli.mjs <command> [args]

COMMANDS
  me                          Show authenticated athlete info
  token                       Show access token status (TTL)
  refresh                     Force OAuth token refresh
  list [opts]                 List recent activities
                                --days=N (default 7)
                                --per-page=N (default 30)
                                --page=N (default 1)
                                --json
  get <id> [--json]           Get full activity details
  update <id> [opts]          Update activity metadata
                                --name="..." --type=Run --sport-type=TrailRun
                                --description="..." --gear=...
                                --workout-type=race|long|workout|default | <int>
                                  Run: 0=default 1=race 2=long 3=workout
                                  Ride: 10=default 11=race 12=workout
                                --commute / --no-commute
                                --hide / --show
                                --trainer / --no-trainer
  delete <id> [--force]       Delete activity (--force required to confirm)
  create [opts]               Create a manual activity (no GPS/streams)
                                --name="..." --type=Workout
                                --start=2026-05-01T07:00:00 (default: now)
                                --duration=600 (seconds, default: 600)
                                --distance=meters
                                --description="..." --trainer --commute
  streams <id> [opts]         Get activity streams
                                --keys=time,heartrate,distance,cadence,...
                                --json

EXAMPLES
  node cli/strava.cli.mjs me
  node cli/strava.cli.mjs list --days=14
  node cli/strava.cli.mjs get 18333086396
  node cli/strava.cli.mjs update 18333086396 --name="Upper body + bands"
  node cli/strava.cli.mjs update 18333086396 --type=Workout --description="Recovery day"
  node cli/strava.cli.mjs delete 18333086396 --force
  node cli/strava.cli.mjs create --name="Walk" --type=Walk --duration=1800

ENVIRONMENT
  DAYLIGHT_BASE_PATH    Override project root (default: derived from script location)
  DAYLIGHT_USER         Override user (default: "kckern")
  DEBUG                 Print stack traces on error

AUTH FILES (read/written automatically)
  data/system/auth/strava.yml                client_id, client_secret
  data/users/{user}/auth/strava.yml          refresh, access_token, expires_at
`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const cmd  = argv[0];
const rest = argv.slice(1);

try {
  switch (cmd) {
    case 'me':
    case 'whoami':
      await cmdMe(rest);
      break;
    case 'token':
      await cmdToken();
      break;
    case 'refresh':
      await cmdRefresh();
      break;
    case 'list':
    case 'recent':
      await cmdList(rest);
      break;
    case 'get':
    case 'show':
      if (!rest[0]) fail('activity id required');
      await cmdGet(rest[0], rest.slice(1));
      break;
    case 'update':
    case 'edit':
      if (!rest[0]) fail('activity id required');
      await cmdUpdate(rest[0], rest.slice(1));
      break;
    case 'delete':
    case 'rm':
      if (!rest[0]) fail('activity id required');
      await cmdDelete(rest[0], rest.slice(1));
      break;
    case 'create':
    case 'add':
      await cmdCreate(rest);
      break;
    case 'streams':
      if (!rest[0]) fail('activity id required');
      await cmdStreams(rest[0], rest.slice(1));
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      help();
      break;
    default:
      console.error(`ERROR: unknown command "${cmd}"\n`);
      help();
      process.exit(1);
  }
} catch (err) {
  console.error('ERROR:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}
