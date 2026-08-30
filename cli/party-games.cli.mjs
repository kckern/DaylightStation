#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = process.env.DAYLIGHT_BASE_URL || 'http://localhost:3111';

export function parseCliArgs(argv) {
  const flags = { baseUrl: DEFAULT_BASE, json: false, hostMode: null, seed: null, actor: 'host', data: {}, sets: [] };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json') flags.json = true;
    else if (value === '--base-url') flags.baseUrl = argv[++index];
    else if (value === '--host-mode') flags.hostMode = argv[++index];
    else if (value === '--seed') flags.seed = Number(argv[++index]);
    else if (value === '--actor') flags.actor = argv[++index];
    else if (value === '--data') flags.data = parseJsonObject(argv[++index], '--data');
    else if (value === '--set') flags.sets.push(argv[++index]);
    else if (value.startsWith('--')) throw new Error(`Unknown option: ${value}`);
    else positional.push(value);
  }
  return { command: positional[0] || 'help', args: positional.slice(1), flags };
}

function parseJsonObject(value, label) {
  let parsed;
  try { parsed = JSON.parse(value || ''); }
  catch (error) { throw new Error(`${label} must be valid JSON: ${error.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function parseScalar(value) {
  try { return JSON.parse(value); }
  catch { return value; }
}

export function patchFromSetFlags(values) {
  const patch = {};
  for (const assignment of values) {
    const split = assignment.indexOf('=');
    if (split <= 0) throw new Error(`--set requires path=value, received: ${assignment}`);
    const path = assignment.slice(0, split).split('.').filter(Boolean);
    if (path.length === 0) throw new Error(`--set path is empty: ${assignment}`);
    let cursor = patch;
    for (const segment of path.slice(0, -1)) cursor = cursor[segment] ||= {};
    cursor[path.at(-1)] = parseScalar(assignment.slice(split + 1));
  }
  return patch;
}

export function defaultSeats(profile) {
  const preset = profile.team_presets?.[0];
  const source = preset?.teams?.length ? preset.teams : [{ name: 'Team 1', members: [] }, { name: 'Team 2', members: [] }];
  const colors = ['#e6b325', '#3273dc', '#e05263', '#29b36b'];
  return source.map((team, index) => ({
    id: `team_${index + 1}`,
    slot: `slot_${index + 1}`,
    name: team.name || `Team ${index + 1}`,
    color: team.color || colors[index % colors.length],
    members: structuredClone(team.members || []),
  }));
}

export function buildCreatePayload({ entry, profile, hostMode = null, seed = null }) {
  const setupKind = entry.setup_profile?.kind || entry.setup || 'none';
  const seats = setupKind === 'none' ? [] : defaultSeats(profile);
  const participants = seats.flatMap((seat) => seat.members || []);
  const allowedModes = entry.setup_profile?.host_modes || [];
  const selectedHostMode = hostMode || (allowedModes.includes('human') ? 'human' : allowedModes[0]);
  const setup = {
    ...(seats.length ? { teams: seats } : {}),
    ...(selectedHostMode ? { host: { mode: selectedHostMode } } : {}),
  };
  if (entry.setup_profile?.verifier === 'opponent' && selectedHostMode && selectedHostMode !== 'human') {
    setup.verifier_id = seats[1]?.members?.[0]?.id || null;
  }
  return {
    definition_id: entry.definition_id,
    surface_id: 'party-games',
    seats,
    participants,
    setup,
    ...(Number.isInteger(seed) ? { seed } : {}),
  };
}

export function diagnosticUrl(baseUrl, sessionId) {
  const query = new URLSearchParams({ diagnostic_session: sessionId });
  return `${baseUrl.replace(/\/$/, '')}/app/party-games?${query}`;
}

function usage() {
  process.stdout.write(`Usage: node cli/party-games.cli.mjs <command> [args] [options]

Process-memory sessions never write gaming snapshots, journals, effects, or drawing files.
They expire after four hours and disappear when the backend restarts.

Commands:
  catalog                                  List mounted Party Games definitions
  create <definition-or-experience>        Create an ephemeral session and print its UI URL
  show <diagnostic-session-id>              Show projected state and diagnostic history
  list                                     List active ephemeral sessions
  advance <session-id> <command-type>       Apply one legal rules command
  override <session-id> --set path=value    Merge-patch projected game state
  delete <diagnostic-session-id>            Remove an ephemeral session immediately
  url <diagnostic-session-id>               Print the attach URL

Options:
  --base-url <url>      App URL (default: $DAYLIGHT_BASE_URL or http://localhost:3111)
  --host-mode <mode>    human, computer, or ai-assisted when supported
  --seed <integer>      Deterministic unsigned seed for create
  --actor <id>          Semantic actor for advance (default: host)
  --data '<json>'       Extra command fields for advance
  --set path=value      Repeatable override; values accept JSON scalars/objects
  --json                Print full JSON

Examples:
  npm run gaming:party -- create charades
  npm run gaming:party -- advance diagnostic:ID performer.ready
  npm run gaming:party -- override diagnostic:ID --set phase=performing --set deadline=4102444800000
`);
}

export function createApi(baseUrl, fetchImpl = fetch) {
  const root = `${baseUrl.replace(/\/$/, '')}/api/v1/gaming`;
  return async (path, { method = 'GET', body = null } = {}) => {
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new Error(`app not reachable at ${baseUrl} (${error.cause?.code || error.message})`);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    return payload;
  };
}

function sessionSummary(session, baseUrl) {
  return {
    session_id: session.header.session_id,
    definition_id: session.diagnostic?.definition_id,
    ruleset_id: session.header.ruleset.id,
    phase: session.state?.phase || null,
    status: session.header.status,
    revision: session.header.revision,
    ephemeral: session.diagnostic?.ephemeral === true,
    url: diagnosticUrl(baseUrl, session.header.session_id),
  };
}

function print(value, json, baseUrl) {
  if (json) return process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  if (value?.header?.session_id) return process.stdout.write(`${JSON.stringify(sessionSummary(value, baseUrl), null, 2)}\n`);
  return process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runCli(argv, { fetchImpl = fetch } = {}) {
  const { command, args, flags } = parseCliArgs(argv);
  if (command === 'help') { usage(); return 0; }
  const baseUrl = flags.baseUrl.replace(/\/$/, '');
  const api = createApi(baseUrl, fetchImpl);

  if (command === 'catalog') {
    const catalog = await api('/environments/party-games/catalog');
    print(flags.json ? catalog : catalog.entries.map((entry) => ({ definition_id: entry.definition_id, experience_id: entry.experience_id, title: entry.title, setup: entry.setup })), flags.json, baseUrl);
    return 0;
  }
  if (command === 'create') {
    if (!args[0]) throw new Error('create requires a definition id or experience id');
    const [catalog, profile] = await Promise.all([api('/environments/party-games/catalog'), api('/environments/party-games/profile')]);
    const entry = catalog.entries.find((candidate) => candidate.definition_id === args[0])
      || catalog.entries.find((candidate) => candidate.experience_id === args[0]);
    if (!entry) throw new Error(`Party Games definition is not mounted: ${args[0]}`);
    const payload = buildCreatePayload({ entry, profile, hostMode: flags.hostMode, seed: flags.seed });
    const created = await api('/diagnostics/sessions', { method: 'POST', body: payload });
    print(created, flags.json, baseUrl);
    return 0;
  }
  if (command === 'list') {
    const result = await api('/diagnostics/sessions');
    print(result.sessions, flags.json, baseUrl);
    return 0;
  }
  if (command === 'show') {
    if (!args[0]) throw new Error('show requires a diagnostic session id');
    print(await api(`/diagnostics/sessions/${encodeURIComponent(args[0])}`), flags.json, baseUrl);
    return 0;
  }
  if (command === 'advance') {
    if (!args[0] || !args[1]) throw new Error('advance requires a diagnostic session id and command type');
    const result = await api(`/diagnostics/sessions/${encodeURIComponent(args[0])}/advance`, {
      method: 'POST', body: { actor_id: flags.actor, command: { type: args[1], ...flags.data } },
    });
    print(result, flags.json, baseUrl);
    return 0;
  }
  if (command === 'override') {
    if (!args[0]) throw new Error('override requires a diagnostic session id');
    if (flags.sets.length === 0) throw new Error('override requires at least one --set path=value');
    const result = await api(`/diagnostics/sessions/${encodeURIComponent(args[0])}/state`, { method: 'PATCH', body: { patch: patchFromSetFlags(flags.sets) } });
    print(result, flags.json, baseUrl);
    return 0;
  }
  if (command === 'delete') {
    if (!args[0]) throw new Error('delete requires a diagnostic session id');
    print(await api(`/diagnostics/sessions/${encodeURIComponent(args[0])}`, { method: 'DELETE' }), flags.json, baseUrl);
    return 0;
  }
  if (command === 'url') {
    if (!args[0]) throw new Error('url requires a diagnostic session id');
    process.stdout.write(`${diagnosticUrl(baseUrl, args[0])}\n`);
    return 0;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
