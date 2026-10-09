import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { resolveRoster, resolvePolicy } from '../../../modules/chess/portable/ladder.mjs';
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert.ok(['--data-root', '--output-root', '--base-manifest'].includes(key) && !Object.hasOwn(options, key));
  assert.ok(process.argv[i + 1]);
  options[key] = process.argv[++i];
}
for (const key of ['--data-root', '--output-root', '--base-manifest']) assert.ok(path.isAbsolute(options[key] ?? ''), 'Explicit absolute ' + key + ' required');
const root = fs.realpathSync(options['--data-root']),
  output = fs.realpathSync(options['--output-root']);
assert.ok(output !== root && !output.startsWith(root + path.sep), 'Output must be separate from input data');
for (const name of ['fixture.json', 'source-contract-inputs.json', 'provenance.json', 'expectations.json', 'next-readonly-expectations.json', 'extended-readonly-expectations.json']) assert.ok(!fs.existsSync(path.join(output, name)), 'Refusing overwrite');
fs.chmodSync(output, 0o700);
const sourceFile = new URL('./local-app-fixture.json', import.meta.url);
const inputs = [];
const observeAbsent = relative => {
  const p = path.join(root, relative);
  if (!fs.existsSync(p) && !inputs.some(row => row.path === p)) inputs.push({
    path: p,
    absent: true
  });
};
const read = relative => {
  const p = path.join(root, relative);
  if (!fs.existsSync(p)) {
    observeAbsent(relative);
    return null;
  }
  assert.equal(fs.realpathSync(p), p, 'Inputs must be canonical, not symlinked');
  const before = fs.statSync(p);
  assert.ok(before.isFile());
  const bytes = fs.readFileSync(p),
    hash = createHash('sha256').update(bytes).digest('hex');
  inputs.push({
    path: p,
    sha256: hash,
    dev: before.dev,
    ino: before.ino
  });
  return yaml.load(bytes.toString()) ?? {};
};
const resolve = stem => {
  for (const e of ['.yml', '.yaml']) {
    if (fs.existsSync(path.join(root, stem + e))) return stem + e;
    observeAbsent(stem + e);
  }
  return stem + '.yml';
};
const system = read(resolve('system/config/system'));
assert.ok(system, 'System configuration required');
const householdId = system.households?.default ?? 'default';
assert.match(householdId, /^[a-zA-Z0-9_-]+$/);
const folder = householdId === 'default' ? 'household' : 'household-' + householdId;
observeAbsent(folder + '/household.yml');
const household = read(fs.existsSync(path.join(root, folder, 'household.yml')) ? folder + '/household.yml' : resolve(folder + '/config/household'));
assert.ok(household && Array.isArray(household.users));
const app = (registered, name) => {
  const registeredPath = resolve(folder + '/' + registered);
  if (fs.existsSync(path.join(root, registeredPath))) return read(registeredPath);
  for (const s of [folder + '/apps/' + name, folder + '/apps/' + name + '/config']) {
    const f = resolve(s);
    if (fs.existsSync(path.join(root, f))) return read(f);
  }
  inputs.push({
    path: path.join(root, registeredPath),
    absent: true
  });
  return {};
};
const school = app('school/school', 'school'),
  scales = app('hardware/scales', 'scales'),
  piano = app('piano/config', 'piano');
const base = JSON.parse(fs.readFileSync(sourceFile));
const fixtureFiles = base.fixtureFiles;
fixtureFiles['data/system/config/system.yml'].households = {
  default: householdId
};
fixtureFiles['data/system/config/system.yml'].timezone = system.timezone ?? 'America/Los_Angeles';
fixtureFiles['data/' + folder + '/household.yml'] = {
  head: household.head,
  users: household.users,
  ...(household.timezone ? {
    timezone: household.timezone
  } : {})
};
fixtureFiles['data/' + folder + '/school/school.yml'] = school.learners === undefined ? {} : {
  learners: school.learners
};
fixtureFiles['data/' + folder + '/hardware/scales.yml'] = {
  nutribot: scales.nutribot?.density_levels === undefined ? {} : {
    density_levels: scales.nutribot.density_levels
  }
};
fixtureFiles['data/' + folder + '/piano/config.yml'] = piano.gameLimit === undefined ? {} : {
  gameLimit: piano.gameLimit
};
const profiles = [];
for (const entry of household.users) {
  const id = typeof entry === 'object' ? entry.id ?? entry.name : entry;
  assert.match(id, /^[a-zA-Z0-9_-]+$/);
  const p = read(resolve('users/' + id + '/profile'));
  if (!p) continue;
  const projected = Object.fromEntries(['username', 'display_name', 'name', 'group_label', 'birthyear'].filter(k => p[k] !== undefined).map(k => [k, p[k]]));
  fixtureFiles['data/users/' + id + '/profile.yml'] = projected;
  profiles.push({
    id,
    ...projected
  });
}
const enabled = piano.gameLimit?.enabled === true;
// Enabled-budget history is intentionally not part of this selected projection.
const blockers = enabled ? ['Piano enabled budget needs separately reviewed current-day history'] : [];
const sourceContract = {
  householdId,
  timezone: system.timezone,
  household: {
    head: household.head,
    users: household.users,
    ...(household.timezone ? {
      timezone: household.timezone
    } : {})
  },
  profiles,
  school: {
    learners: school.learners
  },
  scales: {
    nutribot: {
      density_levels: scales.nutribot?.density_levels
    }
  },
  piano: {
    gameLimit: piano.gameLimit
  }
};
const manifest = JSON.parse(fs.readFileSync(options['--base-manifest']));
assert.equal(manifest.schema, 'comparator-v1');
assert.deepEqual(manifest.cases.map(c => c.id), ['node-edge-liveness', 'player-default-config', 'fitness-authored-course'], 'Use reviewed initial three-case manifest');
const safety = {
  reviewed: true,
  disposition: 'read-only',
  sideEffects: false,
  nonlocal: false,
  longLived: false
};
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'credentialless'
};
const make = (id, url, body, extra = {}) => ({
  id,
  method: 'GET',
  path: url,
  safety,
  expected: {
    status: 200,
    headers: {
      ...headers,
      ...extra
    },
    body
  },
  normalize: {
    jsonPaths: [],
    headers: ['date', 'connection', 'keep-alive']
  }
});
const raw = school.learners;
const learners = raw === undefined || raw === null ? null : Array.isArray(raw) ? raw : raw.include;
assert.ok(learners === null || Array.isArray(learners) && learners.every(id => typeof id === 'string' && id), 'Invalid School learner policy');
const roster = profiles.filter(p => learners === null ? Number.isInteger(p.birthyear) && new Date().getFullYear() - p.birthyear < 18 : learners.includes(p.username ?? p.id)).map(p => ({
  id: p.username ?? p.id,
  name: p.display_name || p.username || p.id,
  ...(p.group_label ? {
    groupLabel: p.group_label
  } : {}),
  ...(Number.isInteger(p.birthyear) ? {
    birthyear: p.birthyear
  } : {})
}));
assert.ok(roster.length, 'Populated School roster branch required');
const rows = scales.nutribot?.density_levels;
assert.ok(Array.isArray(rows) && rows.length, 'This profile requires the declared density table; fallback branch remains uncovered');
const defaultMacros = {
  1: [30, 60, 10],
  2: [15, 70, 15],
  3: [35, 45, 20],
  4: [25, 50, 25],
  5: [20, 50, 30],
  6: [15, 45, 40],
  7: [15, 20, 65],
  8: [10, 15, 75],
  9: [0, 0, 100]
};
const densityRevision = JSON.stringify(rows.map(row => {
  assert.ok(Number.isFinite(Number(row.level)) && Number.isFinite(Number(row.kcal_per_g)));
  const fallback = defaultMacros[Number(row.level)];
  assert.ok(row.macros || fallback);
  return [Number(row.level), Number(row.kcal_per_g), row.macros?.protein_pct ?? fallback?.[0], row.macros?.carb_pct ?? fallback?.[1], row.macros?.fat_pct ?? fallback?.[2]];
}));
assert.ok(typeof household.head === 'string' && household.head, 'Declared household head required');
manifest.cases.push(make('school-private-roster', '/api/v1/school/roster', {
  kind: 'json-array',
  exact: roster
}), make('health-private-context', '/api/v1/health/context', {
  kind: 'json',
  required: {
    userId: 'string',
    densityLevels: 'array',
    densityRevision: 'string'
  },
  equals: {
    userId: household.head,
    densityRevision
  }
}), ...(!enabled ? [make('piano-guest-budget-disabled', '/api/v1/piano/users/guest/game-budget', {
  kind: 'json',
  required: {
    enabled: 'boolean'
  },
  equals: {
    enabled: false
  }
}, {
  'cache-control': 'no-store'
})] : []), make('gratitude-private-users', '/api/v1/gratitude/users', {
  kind: 'json',
  required: {
    users: 'array',
    _household: 'string'
  },
  equals: {
    users: profiles.map(p => ({
      id: p.id,
      name: p.display_name || p.name || p.id.charAt(0).toUpperCase() + p.id.slice(1),
      group_label: p.group_label || null
    })),
    _household: householdId
  }
}));
// These expectations follow the reviewed local-file readers, not observed HTTP bodies.
const objectBody = value => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.ok(Object.keys(value).length, 'Empty root object requires separate comparator support');
  const required = Object.fromEntries(Object.entries(value).map(([key, v]) => {
    const type = Array.isArray(v) ? 'array' : typeof v;
    assert.ok(v !== null && ['object', 'string', 'number', 'boolean', 'array'].includes(type));
    return [key, type];
  }));
  return {
    kind: 'json',
    required,
    equals: value
  };
};
const next = {
  schema: 'comparator-v1',
  cases: []
};
const weight = read(resolve('users/' + household.head + '/lifelog/weight'));
if (weight && Object.keys(weight).length) {
  assert.ok(!Array.isArray(weight), 'Reviewed weight branch requires date-keyed object');
  fixtureFiles['data/users/' + household.head + '/lifelog/weight.yml'] = weight;
  next.cases.push(make('health-private-weight', '/api/v1/health/weight', objectBody(weight)), make('lifelog-private-weight', '/api/v1/lifelog/weight', objectBody(weight)));
} else blockers.push('Empty or absent weight root branch is not covered by this pack');
const finances = read(resolve(folder + '/finance/finances'));
// Only the fields consumed by budgets(); mortgage and per-period transactions stay out.
if (finances?.budgets) {
  const projected = Object.fromEntries(Object.entries(finances.budgets).map(([date, row]) => [date, Object.fromEntries(['budgetEnd', 'accounts', 'totalBudget', 'shortTermStatus'].filter(key => row[key] !== undefined).map(key => [key, row[key]]))]));
  fixtureFiles['data/' + folder + '/finance/finances.yml'] = {
    budgets: projected
  };
  const budgets = Object.entries(projected).map(([startDate, budget]) => ({
    startDate,
    endDate: budget.budgetEnd,
    accounts: budget.accounts,
    totalBudget: budget.totalBudget,
    shortTermStatus: budget.shortTermStatus
  }));
  next.cases.push(make('finance-private-budgets', '/api/v1/finance/budgets', objectBody({
    budgets: JSON.parse(JSON.stringify(budgets)),
    household: householdId
  })));
} else {
  const c = make('finance-private-budgets-missing', '/api/v1/finance/budgets', objectBody({
    error: 'Budget data not found'
  }));
  c.expected.status = 404;
  next.cases.push(c);
}
const memos = read(resolve(folder + '/finance/transaction.memos'));
if (memos !== null) fixtureFiles['data/' + folder + '/finance/transaction.memos.yml'] = memos;
assert.ok(memos === null || typeof memos === 'object' && !Array.isArray(memos));
next.cases.push(make('finance-private-memos', '/api/v1/finance/memos', objectBody({
  memos: memos || {},
  household: householdId
})));
const pairs = read(resolve(folder + '/finance/transaction.pairs'));
assert.ok(pairs === null || Array.isArray(pairs));
if (pairs !== null) fixtureFiles['data/' + folder + '/finance/transaction.pairs.yml'] = pairs;
next.cases.push(make('finance-private-pairs', '/api/v1/finance/pairs', objectBody({
  pairs: pairs || [],
  household: householdId
})));
const learnerIds = new Set(roster.map(p => p.id));
const pianoUsers = profiles.map(p => ({
  id: p.username ?? p.id,
  name: p.display_name || p.username || p.id,
  group_label: p.group_label ?? null,
  birthyear: p.birthyear ?? null,
  schoolLearner: learnerIds.has(p.username ?? p.id)
}));
next.cases.push(make('piano-private-roster', '/api/v1/piano/users', objectBody({
  users: pianoUsers
})));
sourceContract.weight = weight;
sourceContract.finance = {
  budgets: fixtureFiles['data/' + folder + '/finance/finances.yml']?.budgets,
  memos,
  pairs
};
// Further finite reads: source-backed records, guest Chess and read-only lists.
const extended = { schema: 'comparator-v1', cases: [] };
const branches = [];
const addExtended = (id, url, value, source, populated) => {
  const c = make(id, url, objectBody(value));
  c.expectationSource = source;
  extended.cases.push(c);
  branches.push({ caseId: id, branch: populated ? 'populated' : 'empty-or-absent', populatedGap: !populated });
};
sourceContract.extended = { health: {}, gratitude: {}, piano: {} };
for (const [endpoint, stem, message] of [
  ['workouts', 'lifelog/strava', 'Workout data retrieved successfully'],
  ['fitness', 'lifelog/fitness', 'Fitness data retrieved successfully'],
  ['nutrition', 'lifelog/nutrition/nutriday', 'Nutrition data retrieved successfully'],
  ['coaching', 'health_coaching', 'Health coaching data retrieved successfully']
]) {
  const raw = read(resolve('users/' + household.head + '/' + stem));
  assert.ok(raw === null || typeof raw === 'object' && !Array.isArray(raw), 'Reviewed Health file must have object root');
  if (raw !== null) fixtureFiles['data/users/' + household.head + '/' + stem + '.yml'] = raw;
  sourceContract.extended.health[endpoint] = raw;
  addExtended('health-private-' + endpoint, '/api/v1/health/' + endpoint,
    { message, data: raw || {} }, ['modules/health/server/api/routers/health.mjs:532-584',
      'modules/health/server/application/health/HealthOperations.mjs:112-116',
      'modules/health/server/adapters/persistence/yaml/YamlHealthDatastore.mjs:119-174'],
    raw !== null && Object.keys(raw).length > 0);
}
const chess = app('gaming/chess', 'chess');
const chessFields = ['default_rung', 'rungs', 'opponent_delay_ms', 'opponent', 'feedback', 'addressing', 'ladder'];
assert.ok(Object.keys(chess).every(key => chessFields.includes(key)), 'Unreviewed Chess config fields require source review');
assert.ok(Object.keys(chess).length, 'Absent Chess config root branch is not covered');
fixtureFiles['data/' + folder + '/gaming/chess.yml'] = chess;
sourceContract.extended.chess = chess;
addExtended('chess-guest-private-config', '/api/v1/piano-games/chess/config', chess,
  ['modules/chess/server/api/chess.mjs:31-39,133-137',
    'modules/chess/server/application/ChessConfigService.mjs:14-15,71-75',
    'modules/chess/server/composition/runtime.mjs:24-33', 'shared/contracts/householdConfig.mjs:50'], true);
// Resolve authored roster content with the pure source contract. Guest progress and
// its gate/standing expectations are derived here without calling the service or API.
const chessRoster = resolveRoster(chess), chessPolicy = resolvePolicy(chess);
assert.ok(chessRoster.length > 1 && chessPolicy.wins_required > 0);
const ladder = { roster: chessRoster, available: chessRoster.slice(0, 1), current: chessRoster[0],
  unlocked_through: 0, status: { level: 0, window: chessPolicy.window, needed: chessPolicy.wins_required,
    wins: 0, played: 0, promotes: false, at_top: false },
  standing: { round: 1, level: 0, counted: 0, practice: 0, gateWins: 0,
    gateNeeded: chessPolicy.wins_required, gateWindow: chessPolicy.window,
    remaining: chessPolicy.wins_required, promotes: false, atTop: false },
  policy: chessPolicy, persisted: false };
addExtended('chess-guest-private-ladder', '/api/v1/piano-games/chess/ladder', ladder,
  ['modules/chess/server/api/chess.mjs:305-309', 'modules/chess/server/application/ChessLadderService.mjs:28-53',
    'modules/chess/portable/ladder.mjs:159-171,177-204,314-331,350-367,406-408'], true);
for (const kind of ['selections', 'discarded']) {
  const relative = folder + '/gratitude/' + kind + '.gratitude.yml';
  const raw = read(relative);
  const rows = Array.isArray(raw) ? raw : [];
  const items = rows.map(row => {
    assert.ok(row.id, 'Gratitude row id required');
    if (kind === 'discarded') return { id: row.id, text: row.text };
    assert.ok(row.item?.id, 'Selection item id required');
    return { id: row.id, userId: row.userId, item: { id: row.item.id, text: row.item.text },
      datetime: row.datetime, printed: Array.isArray(row.printed) ? row.printed : [] };
  });
  // Project only serialized fields; options, recycled choices and print actions are excluded.
  if (raw !== null) fixtureFiles['data/' + relative] = items;
  sourceContract.extended.gratitude[kind] = items;
  addExtended('gratitude-private-' + kind, '/api/v1/gratitude/' + kind + '/gratitude',
    { items: JSON.parse(JSON.stringify(items)), _household: householdId },
    ['modules/gratitude/server/api/gratitude.mjs:27-39,173-185,255-268',
      'modules/gratitude/server/adapters/persistence/YamlGratitudeDatastore.mjs:56-61,83-116,214-215,285-286'], items.length > 0);
}
const snapshotRelative = folder + '/gratitude/snapshots', snapshotDir = path.join(root, snapshotRelative);
const snapshots = [];
if (!fs.existsSync(snapshotDir)) observeAbsent(snapshotRelative);
else {
  assert.equal(fs.realpathSync(snapshotDir), snapshotDir);
  const stat = fs.statSync(snapshotDir); assert.ok(stat.isDirectory());
  const entries = fs.readdirSync(snapshotDir).sort();
  inputs.push({ path: snapshotDir, kind: 'directory', entries, dev: stat.dev, ino: stat.ino });
  for (const name of entries.filter(name => !name.startsWith('._') && /\.ya?ml$/.test(name))) {
    const baseName = name.replace(/\.(yml|yaml)$/, '');
    assert.ok(!baseName.includes('..') && !baseName.includes('/') && !baseName.includes('\\'));
    const data = read(snapshotRelative + '/' + name) || {};
    const projected = { ...(data.id ? { id: data.id } : {}), ...(data.createdAt ? { createdAt: data.createdAt } : {}) };
    fixtureFiles['data/' + snapshotRelative + '/' + name] = projected;
    snapshots.push({ file: baseName, id: data.id || baseName.split('_').slice(1).join('_'),
      createdAt: data.createdAt || null, name: baseName });
  }
}
snapshots.sort((a, b) => a.name < b.name ? 1 : -1);
sourceContract.extended.gratitude.snapshots = snapshots;
addExtended('gratitude-private-snapshot-list', '/api/v1/gratitude/snapshot/list',
  { snapshots, _household: householdId }, ['modules/gratitude/server/api/gratitude.mjs:314-323',
    'modules/gratitude/server/adapters/persistence/YamlGratitudeDatastore.mjs:133-139,336-369'], snapshots.length > 0);
for (const kind of ['preferences', 'preset']) {
  const relative = resolve('users/' + household.head + '/apps/piano/' + kind);
  const raw = read(relative);
  if (!raw || !Object.keys(raw).length) {
    blockers.push('Populated head-member Piano ' + kind + ' branch unavailable'); continue;
  }
  assert.ok(typeof raw === 'object' && !Array.isArray(raw));
  fixtureFiles['data/users/' + household.head + '/apps/piano/' + kind + '.yml'] = raw;
  sourceContract.extended.piano[kind] = raw;
  addExtended('piano-private-' + kind, '/api/v1/piano/users/' + encodeURIComponent(household.head) + '/' + kind,
    raw, ['modules/piano/server/api/piano.mjs:886-906',
      'modules/piano/server/adapters/YamlPianoStudioDatastore.mjs:59-76,163-185'], true);
}
for (const r of inputs) {
  if (r.absent) {
    assert.ok(!fs.existsSync(r.path), 'Absent backing file appeared');
    continue;
  }
  const stat = fs.statSync(r.path);
  assert.equal(stat.dev, r.dev);
  assert.equal(stat.ino, r.ino);
  if (r.kind === 'directory') assert.deepEqual(fs.readdirSync(r.path).sort(), r.entries, 'Backing directory changed during projection');
  else assert.equal(createHash('sha256').update(fs.readFileSync(r.path)).digest('hex'), r.sha256, 'Backing file changed during projection');
}
const nextSources = {
  'health-private-weight': ['modules/health/server/api/routers/health.mjs:520-525', 'modules/health/server/adapters/persistence/yaml/YamlHealthDatastore.mjs:88-115'],
  'lifelog-private-weight': ['capabilities/lifelog/server/api/lifelog.mjs:74-84', 'modules/health/server/adapters/weight/DataServiceWeightHistorySource.mjs:9'],
  'finance-private-budgets': ['modules/finance/server/api/finance.mjs:86-94', 'modules/finance/server/application/FinanceApiService.mjs:124-136'],
  'finance-private-budgets-missing': ['modules/finance/server/api/finance.mjs:86-94'],
  'finance-private-memos': ['modules/finance/server/application/FinanceApiService.mjs:197-199', 'modules/finance/server/adapters/persistence/YamlFinanceDatastore.mjs:253-255'],
  'finance-private-pairs': ['modules/finance/server/application/FinanceApiService.mjs:201-203', 'modules/finance/server/adapters/persistence/YamlFinanceDatastore.mjs:316-318'],
  'piano-private-roster': ['modules/piano/server/api/piano.mjs:220-237', 'backend/src/1_adapters/identity/ConfigUserDirectory.mjs:56-78']
};
for (const c of next.cases) c.expectationSource = nextSources[c.id];
const artifacts = {
  'fixture.json': {
    fixtureFiles
  },
  'source-contract-inputs.json': sourceContract,
  'provenance.json': {
    scope: 'Selected source-derived fields/files only; synthetic startup; independent snapshot',
    inputs,
    pianoBudgetEnabled: enabled,
    branches,
    blockers
  },
  'expectations.json': manifest,
  'next-readonly-expectations.json': next,
  'extended-readonly-expectations.json': extended
};
for (const [name, value] of Object.entries(artifacts)) {
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: 'wx'
  });
}
process.stdout.write(JSON.stringify({
  files: inputs.length,
  profiles: profiles.length,
  initialCases: manifest.cases.length,
  nextCases: next.cases.length,
  extendedCases: extended.cases.length,
  extendedPopulated: branches.filter(row => row.branch === 'populated').length,
  extendedEmpty: branches.filter(row => row.branch !== 'populated').length,
  pianoBudgetEnabled: enabled,
  blockers,
  scope: 'Source-derived selected projections; independent snapshot'
}) + '\n');
