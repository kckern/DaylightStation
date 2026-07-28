/**
 * Raw Strava activity CRUD — the `strava` subcommands that talk to the API
 * and nothing else (no local session files involved).
 *
 * Exports a `commands` map rather than a single `{spec, run}` pair, because
 * these nine commands share so much formatting that splitting them into nine
 * modules would be pure ceremony.
 *
 * @module cli/lib/fitness/stravaCrud
 */

import moment from 'moment-timezone';
import { parseArgs, str, num, bool, present } from './argv.mjs';
import { CliError } from './context.mjs';
import { stravaApi, refreshIfNeeded, loadUserAuth, authPaths } from './stravaAuth.mjs';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function metersToMiles(m) { return (m / 1609.34).toFixed(2); }
function secondsToMinutes(s) { return Math.round(s / 60); }
function ts(local) { return String(local || '').slice(0, 16).replace('T', ' '); }

function formatActivityRow(a) {
  const dur = secondsToMinutes(a.moving_time || 0);
  const dist = a.distance ? `${metersToMiles(a.distance)}mi` : '';
  const hr = a.average_heartrate ? `HR${Math.round(a.average_heartrate)}` : '';
  return `  ${String(a.id).padEnd(11)} ${ts(a.start_date_local)}  ${(a.type || '').padEnd(15)} ${String(dur).padStart(3)}min ${dist.padEnd(8)} ${hr.padEnd(7)} ${a.name || ''}`;
}

/** Pull the shared `--user` override out of a parsed flag bag. */
function userOpt(flags) {
  const username = str(flags, 'user');
  return username ? { username } : {};
}

function requireId(positional, what = 'activity id') {
  if (!positional[0]) throw new CliError(`${what} required`);
  return positional[0];
}

const USER_FLAG_HELP = '  --user=NAME   Auth as a non-default user (default: DAYLIGHT_USER)';

// ---------------------------------------------------------------------------
// me
// ---------------------------------------------------------------------------

const me = {
  spec: {
    name: 'me',
    summary: 'show the authenticated athlete',
    usage: 'fitness strava me [--json]',
    details: `  --json        Print the raw API response\n${USER_FLAG_HELP}`,
  },
  async run(argv, ctx) {
    const { flags } = parseArgs(argv);
    const athlete = await stravaApi(ctx, '/athlete', userOpt(flags));

    if (bool(flags, 'json')) {
      console.log(JSON.stringify(athlete, null, 2));
      return athlete;
    }

    console.log(`Athlete ${athlete.id}: ${athlete.firstname} ${athlete.lastname}`);
    console.log(`  Username: ${athlete.username}`);
    console.log(`  Profile:  ${athlete.profile_medium || athlete.profile}`);
    console.log(`  Location: ${[athlete.city, athlete.state, athlete.country].filter(Boolean).join(', ')}`);
    console.log(`  Created:  ${athlete.created_at}`);
    if (athlete.weight) console.log(`  Weight:   ${(athlete.weight * 2.20462).toFixed(1)} lbs`);
    if (athlete.ftp) console.log(`  FTP:      ${athlete.ftp} W`);
    return athlete;
  },
};

// ---------------------------------------------------------------------------
// token / refresh
// ---------------------------------------------------------------------------

const token = {
  spec: {
    name: 'token',
    summary: 'show access-token status and TTL',
    usage: 'fitness strava token',
    details: USER_FLAG_HELP,
  },
  async run(argv, ctx) {
    const { flags } = parseArgs(argv);
    const opts = userOpt(flags);
    const auth = await refreshIfNeeded(ctx, opts);
    const { username, userAuthPath } = authPaths(ctx, opts.username);
    const ttl = auth.expires_at - Math.floor(Date.now() / 1000);

    console.log(`User:        ${username}`);
    console.log(`Auth file:   ${userAuthPath}`);
    console.log(`Expires at:  ${moment.unix(auth.expires_at).format('YYYY-MM-DD HH:mm:ss Z')}`);
    console.log(`TTL:         ${Math.floor(ttl / 60)} min ${ttl % 60} sec`);
    console.log(`Updated at:  ${auth.updated_at}`);
    return auth;
  },
};

const refresh = {
  spec: {
    name: 'refresh',
    summary: 'force an OAuth token refresh',
    usage: 'fitness strava refresh',
    details: USER_FLAG_HELP,
  },
  async run(argv, ctx) {
    const { flags } = parseArgs(argv);
    const opts = userOpt(flags);
    const before = loadUserAuth(ctx, opts.username);
    const fresh = await refreshIfNeeded(ctx, { ...opts, force: true });

    console.log('Token refreshed.');
    console.log(`  Old expiry: ${before.expires_at ? moment.unix(before.expires_at).format('YYYY-MM-DD HH:mm:ss') : '(none)'}`);
    console.log(`  New expiry: ${moment.unix(fresh.expires_at).format('YYYY-MM-DD HH:mm:ss')}`);
    return fresh;
  },
};

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const list = {
  spec: {
    name: 'list',
    summary: 'list recent activities',
    usage: 'fitness strava list [--days=N] [--page=N] [--per-page=N] [--json]',
    details: `  --days=N      Look back N days (default 7)
  --per-page=N  Results per page (default 30)
  --page=N      Page number (default 1)
  --json        Print the raw API response
${USER_FLAG_HELP}`,
  },
  async run(argv, ctx) {
    const { flags } = parseArgs(argv);
    const days = num(flags, 'days', 7);
    const perPage = num(flags, 'per-page', 30);
    const page = num(flags, 'page', 1);

    const params = new URLSearchParams({
      after: String(Math.floor(moment().subtract(days, 'days').unix())),
      page: String(page),
      per_page: String(perPage),
    });
    const acts = await stravaApi(ctx, `/athlete/activities?${params}`, userOpt(flags));

    if (bool(flags, 'json')) {
      console.log(JSON.stringify(acts, null, 2));
      return acts;
    }

    console.log(`${acts.length} activities in last ${days} days (page ${page}, per_page ${perPage}):`);
    for (const a of acts) console.log(formatActivityRow(a));
    return acts;
  },
};

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

const get = {
  spec: {
    name: 'get',
    summary: 'show full activity details',
    usage: 'fitness strava get <id> [--json]',
    details: `  --json        Print the raw API response\n${USER_FLAG_HELP}`,
  },
  async run(argv, ctx) {
    const { positional, flags } = parseArgs(argv);
    const id = requireId(positional);
    const a = await stravaApi(ctx, `/activities/${id}`, userOpt(flags));

    if (bool(flags, 'json')) {
      console.log(JSON.stringify(a, null, 2));
      return a;
    }

    console.log(`Activity ${a.id}: ${a.name}`);
    console.log(`  URL:       https://www.strava.com/activities/${a.id}`);
    console.log(`  Type:      ${a.type}${a.sport_type && a.sport_type !== a.type ? ` (sport: ${a.sport_type})` : ''}`);
    console.log(`  Date:      ${a.start_date_local}`);
    console.log(`  Duration:  ${secondsToMinutes(a.moving_time)} min moving / ${secondsToMinutes(a.elapsed_time)} min elapsed`);
    if (a.distance) console.log(`  Distance:  ${metersToMiles(a.distance)} mi (${a.distance.toFixed(0)} m)`);
    if (a.average_heartrate) console.log(`  HR:        ${Math.round(a.average_heartrate)} avg, ${Math.round(a.max_heartrate || 0)} max`);
    if (a.suffer_score != null) console.log(`  Suffer:    ${a.suffer_score}`);
    if (a.calories) console.log(`  Calories:  ${a.calories}`);
    if (a.device_name) console.log(`  Device:    ${a.device_name}`);
    if (a.gear_id) console.log(`  Gear:      ${a.gear_id}`);
    console.log(`  Trainer:   ${a.trainer ? 'yes' : 'no'} | Commute: ${a.commute ? 'yes' : 'no'} | Hidden: ${a.hide_from_home ? 'yes' : 'no'} | Manual: ${a.manual ? 'yes' : 'no'}`);
    if (a.description) console.log(`  Description:\n    ${a.description.split('\n').join('\n    ')}`);
    return a;
  },
};

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

// Run: 0=default, 1=race, 2=long, 3=workout | Ride: 10=default, 11=race, 12=workout
const WORKOUT_TYPE_ALIASES = {
  'default': 0, 'race': 1, 'long': 2, 'long-run': 2, 'workout': 3,
  'ride-default': 10, 'ride-race': 11, 'ride-workout': 12,
};

const update = {
  spec: {
    name: 'update',
    summary: 'update activity metadata',
    usage: 'fitness strava update <id> [opts]',
    details: `  --name="..."          Activity title
  --type=Run            Activity type
  --sport-type=TrailRun Sport type
  --description="..."   Description body
  --gear=ID             Gear id
  --workout-type=X      race|long|workout|default|ride-* or an integer
                          Run:  0=default 1=race 2=long 3=workout
                          Ride: 10=default 11=race 12=workout
  --commute / --no-commute
  --hide / --show       Hide from or show on the home feed
  --trainer / --no-trainer
${USER_FLAG_HELP}`,
  },
  async run(argv, ctx) {
    const { positional, flags } = parseArgs(argv, {
      valueFlags: ['name', 'description', 'type', 'sport-type', 'gear', 'workout-type'],
    });
    const id = requireId(positional);

    const body = {};
    const map = { name: 'name', type: 'type', 'sport-type': 'sport_type', description: 'description', gear: 'gear_id' };
    for (const [flag, field] of Object.entries(map)) {
      const v = str(flags, flag);
      if (v !== undefined) body[field] = v;
    }

    const wt = str(flags, 'workout-type');
    if (wt !== undefined) {
      const n = WORKOUT_TYPE_ALIASES[wt.toLowerCase()] ?? parseInt(wt, 10);
      if (Number.isNaN(n)) {
        throw new CliError(`Invalid --workout-type "${wt}". Use an integer or one of: ${Object.keys(WORKOUT_TYPE_ALIASES).join(', ')}`);
      }
      body.workout_type = n;
    }

    if (present(flags, 'commute')) body.commute = bool(flags, 'commute');
    if (present(flags, 'trainer')) body.trainer = bool(flags, 'trainer');
    if (bool(flags, 'hide')) body.hide_from_home = true;
    if (bool(flags, 'show')) body.hide_from_home = false;

    if (Object.keys(body).length === 0) {
      throw new CliError('No update fields. Use --name, --type, --sport-type, --description, --gear, --workout-type, --commute/--no-commute, --hide/--show, --trainer/--no-trainer');
    }

    const result = await stravaApi(ctx, `/activities/${id}`, {
      ...userOpt(flags),
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log(`Updated activity ${id}:`);
    for (const [k, v] of Object.entries(body)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    console.log(`  https://www.strava.com/activities/${result.id || id}`);
    return result;
  },
};

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

const del = {
  spec: {
    name: 'delete',
    summary: 'permanently delete an activity',
    usage: 'fitness strava delete <id> --force',
    details: `  --force       Required to confirm; without it the activity is only previewed\n${USER_FLAG_HELP}`,
  },
  async run(argv, ctx) {
    const { positional, flags } = parseArgs(argv);
    const id = requireId(positional);
    const opts = userOpt(flags);

    if (!bool(flags, 'force') && !bool(flags, 'f')) {
      const a = await stravaApi(ctx, `/activities/${id}`, opts);
      console.log('About to DELETE:');
      console.log(formatActivityRow(a));
      throw new CliError('\nThis is permanent. Re-run with --force to confirm.');
    }

    await stravaApi(ctx, `/activities/${id}`, { ...opts, method: 'DELETE' });
    console.log(`Deleted activity ${id}.`);
    return { id, deleted: true };
  },
};

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const create = {
  spec: {
    name: 'create',
    summary: 'create a manual activity (no GPS or streams)',
    usage: 'fitness strava create [opts]',
    details: `  --name="..."          Title (default "Manual Activity")
  --type=Workout        Activity type (default Workout)
  --start=ISO           Local start, e.g. 2026-05-01T07:00:00 (default: now)
  --duration=SECONDS    Elapsed time (default 600)
  --distance=METERS     Distance
  --description="..."   Description body
  --trainer             Mark as a trainer activity
  --commute             Mark as a commute
${USER_FLAG_HELP}`,
  },
  async run(argv, ctx) {
    const { flags } = parseArgs(argv, { valueFlags: ['name', 'description', 'type', 'start'] });

    const params = new URLSearchParams({
      name: str(flags, 'name', 'Manual Activity'),
      type: str(flags, 'type', 'Workout'),
      start_date_local: str(flags, 'start', moment().format('YYYY-MM-DDTHH:mm:ss')),
      elapsed_time: String(num(flags, 'duration', 600)),
    });
    const distance = str(flags, 'distance');
    const desc = str(flags, 'description');
    if (distance) params.set('distance', distance);
    if (desc) params.set('description', desc);
    if (bool(flags, 'trainer')) params.set('trainer', '1');
    if (bool(flags, 'commute')) params.set('commute', '1');

    const result = await stravaApi(ctx, `/activities?${params}`, { ...userOpt(flags), method: 'POST' });

    console.log(`Created activity ${result.id}: ${result.name}`);
    console.log(`  Type:     ${result.type}`);
    console.log(`  Start:    ${result.start_date_local}`);
    console.log(`  Elapsed:  ${secondsToMinutes(result.elapsed_time)} min`);
    if (result.distance) console.log(`  Distance: ${metersToMiles(result.distance)} mi`);
    console.log(`  URL:      https://www.strava.com/activities/${result.id}`);
    return result;
  },
};

// ---------------------------------------------------------------------------
// streams
// ---------------------------------------------------------------------------

const streams = {
  spec: {
    name: 'streams',
    summary: 'show activity stream metadata',
    usage: 'fitness strava streams <id> [--keys=time,heartrate,...] [--json]',
    details: `  --keys=A,B,C  Stream keys (default time,heartrate,distance)
  --json        Print the raw API response
${USER_FLAG_HELP}`,
  },
  async run(argv, ctx) {
    const { positional, flags } = parseArgs(argv);
    const id = requireId(positional);
    const keys = str(flags, 'keys', 'time,heartrate,distance').split(',').map(s => s.trim());

    const params = new URLSearchParams({ keys: keys.join(','), key_by_type: 'true' });
    const result = await stravaApi(ctx, `/activities/${id}/streams?${params}`, userOpt(flags));

    if (bool(flags, 'json')) {
      console.log(JSON.stringify(result, null, 2));
      return result;
    }

    console.log(`Streams for activity ${id}:`);
    for (const [type, stream] of Object.entries(result)) {
      console.log(`  ${type.padEnd(12)} ${String(stream.original_size || stream.data?.length || 0).padStart(6)} pts (resolution: ${stream.resolution || '?'}, type: ${stream.series_type || '?'})`);
    }
    return result;
  },
};

/**
 * Command map merged into the `strava` group by the dispatcher.
 * @type {Object<string, {spec: Object, run: Function}>}
 */
export const commands = {
  me,
  whoami: me,
  token,
  refresh,
  list,
  recent: list,
  get,
  show: get,
  update,
  edit: update,
  delete: del,
  rm: del,
  create,
  add: create,
  streams,
};

/** Aliases that should not get their own line in the help output. */
export const aliases = new Set(['whoami', 'recent', 'show', 'edit', 'rm', 'add']);
