import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateRawFixtures } from './raw-utf8-fixture.mjs';
import { applyLanguagePacket } from './language-fixture-packet.mjs';
import { applyFitnessPacket } from './fitness-fixture-packet.mjs';
import { applySchoolPacket } from './school-fixture-packet.mjs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { DEFAULT_SERVICE_TYPES } from '../../../modules/auto/server/domain/entities/serviceTypes.mjs';
import { resolveRoster, resolvePolicy } from '../../../modules/chess/portable/ladder.mjs';
import { assertBudgetDetailContracts } from './finance-fixture-contract.mjs';
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert.ok(['--data-root', '--output-root', '--base-manifest', '--piano-stored', '--school-packet', '--fitness-packet', '--language-packet'].includes(key) && !Object.hasOwn(options, key));
  assert.ok(process.argv[i + 1]);
  options[key] = process.argv[++i];
}
for (const key of ['--data-root', '--output-root', '--base-manifest']) assert.ok(path.isAbsolute(options[key] ?? ''), 'Explicit absolute ' + key + ' required');
const root = fs.realpathSync(options['--data-root']),
  output = fs.realpathSync(options['--output-root']);
assert.ok(output !== root && !output.startsWith(root + path.sep), 'Output must be separate from input data');
for (const name of ['fixture.json', 'source-contract-inputs.json', 'provenance.json', 'expectations.json', 'next-readonly-expectations.json', 'extended-readonly-expectations.json', 'reconciled-readonly-expectations.json', 'feedback-readonly-expectations.json', 'calendar-readonly-expectations.json', 'automotive-readonly-expectations.json', 'health-stored-readonly-expectations.json', 'finance-stored-readonly-expectations.json', 'life-stored-readonly-expectations.json', 'school-records-readonly-expectations.json']) assert.ok(!fs.existsSync(path.join(output, name)), 'Refusing overwrite');
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
// These initial cases require defaults, not unprojected household overrides.
for (const relative of [folder + '/player/config.yml', folder + '/player/config.yaml', folder + '/fitness/skyline-glider/courses']) {
  assert.ok(!fs.existsSync(path.join(root, relative)), 'Default fixture branch unavailable: ' + relative);
  observeAbsent(relative);
}
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
// Bounded detail reads: preserve complete selected records, never the whole finances file.
const reconciled = { schema: 'comparator-v1', cases: [] };
const addReconciled = (id, url, value, source, status = 200) => {
  const c = make(id, url, objectBody(JSON.parse(JSON.stringify(value))));
  c.expected.status = status;
  c.expectationSource = source;
  reconciled.cases.push(c);
};
const financeSource = ['modules/finance/server/api/finance.mjs:98-120',
  'modules/finance/server/application/FinanceApiService.mjs:138-151',
  'modules/finance/server/adapters/persistence/YamlFinanceDatastore.mjs:63-66'];
const selectedBudgets = Object.entries(finances?.budgets ?? {}).slice(-2);
for (const [i, [id, budget]] of selectedBudgets.entries()) {
  fixtureFiles['data/' + folder + '/finance/finances.yml'].budgets[id] = budget;
  addReconciled('finance-private-budget-detail-' + (i + 1), '/api/v1/finance/budgets/' + encodeURIComponent(id),
    { budget, budgetId: id, household: householdId }, financeSource);
}
const absentBudgetId = 'readiness-absent-budget';
assert.ok(!Object.hasOwn(finances?.budgets ?? {}, absentBudgetId));
if (finances?.budgets) addReconciled('finance-budget-not-found', '/api/v1/finance/budgets/' + absentBudgetId,
  { error: 'Budget not found', budgetId: absentBudgetId }, financeSource, 404);
if (finances?.mortgage) {
  fixtureFiles['data/' + folder + '/finance/finances.yml'] ??= {};
  fixtureFiles['data/' + folder + '/finance/finances.yml'].mortgage = finances.mortgage;
  addReconciled('finance-private-mortgage', '/api/v1/finance/mortgage',
    { mortgage: finances.mortgage, household: householdId }, financeSource);
} else addReconciled('finance-mortgage-absent', '/api/v1/finance/mortgage',
  { error: 'Mortgage data not found' }, financeSource, 404);
const progress = read(resolve('users/' + household.head + '/apps/piano/progress'));
if (progress && Object.keys(progress).length) {
  fixtureFiles['data/users/' + household.head + '/apps/piano/progress.yml'] = progress;
  addReconciled('piano-private-progress', '/api/v1/piano/users/' + encodeURIComponent(household.head) + '/progress',
    progress, ['modules/piano/server/api/piano.mjs:999-1003',
      'modules/piano/server/adapters/YamlPianoStudioDatastore.mjs:204-209']);
} else blockers.push('Piano populated progress unavailable; no success credit');
const prefixes = read(resolve(folder + '/media/content-prefixes'));
if (prefixes && Object.keys(prefixes).length) {
  fixtureFiles['data/' + folder + '/media/content-prefixes.yml'] = prefixes;
  addReconciled('config-private-content-prefixes', '/api/v1/config/content-prefixes', prefixes,
    ['backend/src/app.mjs:1727', 'backend/src/4_api/v1/routers/config.mjs:48-56',
      'backend/src/3_applications/config/ConfigQueryService.mjs:14-19',
      'backend/src/1_adapters/config/ConfigApiYamlSource.mjs:4']);
} else blockers.push('Content prefixes populated branch unavailable; no success credit');
sourceContract.reconciled = { selectedBudgetIds: selectedBudgets.map(([id]) => id),
  mortgagePresent: !!finances?.mortgage, pianoProgressPresent: !!progress, contentPrefixesPresent: !!prefixes };
// Three bounded stored inboxes. No audio, transcription, triage or creation paths.
const feedback = { schema: 'comparator-v1', cases: [] };
const feedbackSources = ['backend/src/4_api/v1/routers/feedback.mjs:36-49',
  'backend/src/3_applications/common/feedback/FeedbackService.mjs:190-217',
  'backend/src/1_adapters/feedback/FilesystemFeedbackRepository.mjs:26-41',
  'backend/src/0_system/utils/FileIO.mjs:70-76,138-172'];
const addFeedback = (id, url, value, branch, status = 200) => {
  const c = make(id, url, { kind: 'json', required: Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== null).map(([k, v]) => [k, Array.isArray(v) ? 'array' : typeof v])), equals: value });
  c.expected.status = status;
  c.expectationSource = feedbackSources;
  feedback.cases.push(c);
  branches.push({ id, branch });
};
const walkFeedback = relative => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) { observeAbsent(relative); return []; }
  assert.equal(fs.realpathSync(absolute), absolute);
  const stat = fs.statSync(absolute); assert.ok(stat.isDirectory());
  const entries = fs.readdirSync(absolute).sort();
  inputs.push({ path: absolute, kind: 'directory', entries, dev: stat.dev, ino: stat.ino });
  return entries.filter(name => !name.startsWith('.')).flatMap(name => {
    const child = path.join(absolute, name); assert.equal(fs.realpathSync(child), child);
    return fs.statSync(child).isDirectory() ? walkFeedback(relative + '/' + name)
      : /\.ya?ml$/.test(name) ? [relative + '/' + name] : [];
  });
};
sourceContract.feedback = {};
for (const appId of ['fitness', 'piano-kiosk', 'weekly-review']) {
  const rows = walkFeedback(folder + '/feedback/' + appId).map(relative => {
    const raw = read(relative) || {};
    const basename = path.basename(relative).replace(/\.(yml|yaml)$/, '');
    return { relative, raw, id: raw.id || basename };
  });
  const items = rows.map(({ raw: d, id }) => ({ id, app: appId, created: d.created || null,
    status: d.status || 'new', durationMs: d.durationMs || 0, transcriptStatus: d.transcriptStatus || null,
    transcript: d.transcript && d.transcript.length > 240 ? d.transcript.slice(0, 240) + '…' : d.transcript || null,
    route: d.context?.route || null, hasAudio: !!d.audio }));
  items.sort((a, b) => String(b.created || b.id).localeCompare(String(a.created || a.id)));
  const selected = rows.find(row => row.id === items[0]?.id);
  for (const row of rows) {
    // Keep one exact detail; list-only rows contain only serialized list fields.
    fixtureFiles['data/' + row.relative] = row === selected ? row.raw : Object.fromEntries(
      ['id', 'created', 'status', 'durationMs', 'transcriptStatus', 'transcript', 'context', 'audio']
        .filter(key => row.raw[key] !== undefined).map(key => [key, key === 'context'
          ? { ...(row.raw.context?.route ? { route: row.raw.context.route } : {}) } : row.raw[key]]));
  }
  addFeedback('feedback-private-' + appId + '-list', '/api/v1/feedback?app=' + appId,
    { items }, items.length ? 'populated' : 'empty');
  if (selected && /^[A-Za-z0-9_-]{1,80}$/.test(selected.id)) {
    const stamp = /^(\d{4})(\d{2})\d{8}_/.exec(selected.id);
    const detailRelative = stamp ? folder + '/feedback/' + appId + '/' + stamp[1] + '-' + stamp[2] + '/' + selected.id + '.yml' : null;
    // A legacy flat item is listed but deliberately unavailable by detail.
    if (detailRelative === selected.relative) addFeedback('feedback-private-' + appId + '-detail',
      '/api/v1/feedback/' + appId + '/' + selected.id, selected.raw, 'populated');
    else blockers.push('Feedback ' + appId + ' newest item is legacy-flat; populated detail excluded');
  }
  sourceContract.feedback[appId] = { items, selectedDetailId: selected?.id ?? null };
}
const missingFeedbackId = 'readiness-absent-item';
addFeedback('feedback-record-not-found', '/api/v1/feedback/fitness/' + missingFeedbackId,
  { error: 'not found' }, 'not-found', 404);
addFeedback('feedback-empty-app-list', '/api/v1/feedback?app=readiness-absent-app',
  { items: [] }, 'empty');
observeAbsent(folder + '/feedback/readiness-absent-app');
// Stored Calendar reads use the exact current/legacy backing preference.
const calendar = { schema: 'comparator-v1', cases: [] };
const calendarPrimary = resolve(folder + '/calendar/calendar');
const primaryEvents = read(calendarPrimary);
const calendarLegacy = resolve(folder + '/apps/calendar');
// Record the legacy branch's presence even when primary wins; never invent it.
const legacyEvents = read(calendarLegacy);
const calendarEvents = Array.isArray(primaryEvents) ? primaryEvents : legacyEvents || [];
assert.ok(Array.isArray(calendarEvents), 'Stored Calendar backing must be an event array');
const projectEvent = event => Object.fromEntries(['id', 'summary', 'description', 'location', 'start', 'end', 'organizer', 'creator']
  .filter(key => event[key] !== undefined).map(key => [key, ['organizer', 'creator'].includes(key)
    ? { ...(event[key]?.displayName ? { displayName: event[key].displayName } : {}) } : event[key]]));
const selectedEvents = calendarEvents.map(projectEvent);
if (primaryEvents !== null) fixtureFiles['data/' + calendarPrimary] = Array.isArray(primaryEvents) ? selectedEvents : primaryEvents;
if (!Array.isArray(primaryEvents) && legacyEvents !== null) fixtureFiles['data/' + calendarLegacy] = selectedEvents;
const calendarTimezone = household.timezone ?? system.timezone ?? 'America/Los_Angeles';
// Deployment and the isolated probe both set local date parsing from system.timezone.
const calendarRuntimeTimezone = system.timezone ?? 'America/Los_Angeles';
new Intl.DateTimeFormat('en-US', { timeZone: calendarRuntimeTimezone }).format(0);
const calendarTimestamp = value => moment.tz(value, calendarRuntimeTimezone);
const calendarDate = value => moment.tz(value, 'YYYY-MM-DD', true, calendarRuntimeTimezone);
const formatEvent = event => {
  const start = event.start?.dateTime || event.start?.date, end = event.end?.dateTime || event.end?.date;
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  return { id: event.id, summary: event.summary || 'Untitled Event', description: event.description || null,
    location: event.location || null, start, end, allDay,
    date: calendarTimestamp(start).tz(calendarTimezone).format('YYYY-MM-DD'),
    time: allDay ? null : calendarTimestamp(start).tz(calendarTimezone).format('h:mm A'),
    endTime: allDay ? null : calendarTimestamp(end).tz(calendarTimezone).format('h:mm A'),
    calendar: event.organizer?.displayName || event.creator?.displayName || null };
};
const eventsBetween = (start, end, allDayFirst) => selectedEvents.filter(event => {
  const at = calendarTimestamp(event.start?.dateTime || event.start?.date).tz(calendarTimezone);
  return at.isSameOrAfter(start, 'day') && at.isSameOrBefore(end, 'day');
}).map(formatEvent).sort((a, b) => allDayFirst && a.allDay !== b.allDay
  ? a.allDay ? -1 : 1 : new Date(a.start) - new Date(b.start));
const calendarSources = ['modules/calendar/server/api/calendar.mjs:38-79',
  'modules/calendar/server/application/CalendarReadContext.mjs',
  'modules/calendar/server/adapters/DataServiceCalendarEventSource.mjs',
  'modules/calendar/server/composition/calendarApi.mjs',
  'backend/src/3_applications/common/context/HouseholdContextService.mjs',
  'backend/src/0_system/config/ConfigService.mjs:65-69'];
const addCalendar = (id, url, value, branch, status = 200) => {
  const c = make(id, url, Array.isArray(value) ? { kind: 'json-array', exact: value } : objectBody(value));
  c.expected.status = status; c.expectationSource = calendarSources; calendar.cases.push(c);
  branches.push({ caseId: id, branch, populatedGap: branch !== 'populated' });
};
const dates = [...new Set(selectedEvents.map(event => String(event.start?.dateTime || event.start?.date).slice(0, 10)))].sort();
const choices = dates.map(date => ({ date, events: eventsBetween(calendarDate(date), calendarDate(date), true) }));
const pickedDates = new Set();
for (const [kind, predicate] of [['mixed', events => events.some(e => e.allDay) && events.some(e => !e.allDay)],
  ['timed', events => events.length && events.every(e => !e.allDay)],
  ['all-day', events => events.length && events.every(e => e.allDay)]]) {
  const chosen = choices.find(row => !pickedDates.has(row.date) && predicate(row.events));
  if (!chosen) { blockers.push('Calendar populated ' + kind + ' date branch unavailable'); continue; }
  pickedDates.add(chosen.date);
  addCalendar('calendar-private-date-' + kind, '/api/v1/calendar/events/' + chosen.date,
    { status: 'success', date: chosen.date, count: chosen.events.length, events: chosen.events, _household: householdId }, 'populated');
}
const calendarNow = moment().tz(calendarTimezone), today = calendarNow.clone().startOf('day');
const todayEvents = eventsBetween(today, today, true), upcoming = eventsBetween(calendarNow, calendarNow.clone().add(14, 'days'), false);
addCalendar('calendar-private-today', '/api/v1/calendar/events/today',
  { status: 'success', date: today.format('YYYY-MM-DD'), count: todayEvents.length, events: todayEvents, _household: householdId }, todayEvents.length ? 'populated' : 'empty');
addCalendar('calendar-private-upcoming', '/api/v1/calendar/events', upcoming, upcoming.length ? 'populated' : 'empty');
const absentDate = '1900-01-01';
assert.equal(eventsBetween(calendarDate(absentDate), calendarDate(absentDate), true).length, 0);
addCalendar('calendar-date-empty', '/api/v1/calendar/events/' + absentDate,
  { status: 'success', date: absentDate, count: 0, events: [], _household: householdId }, 'empty');
addCalendar('calendar-invalid-date', '/api/v1/calendar/events/2026-02-30',
  { status: 'error', error: 'Invalid date format. Use YYYY-MM-DD.' }, 'invalid-input', 400);
sourceContract.calendar = { timezone: calendarTimezone, runtimeLocalTimezone: calendarRuntimeTimezone, events: selectedEvents,
  selectedDates: [...pickedDates], primaryArray: Array.isArray(primaryEvents), legacyPresent: legacyEvents !== null,
  expectationGeneratedAt: calendarNow.toISOString() };
if (!Array.isArray(legacyEvents) || !legacyEvents.length) blockers.push('Calendar populated legacy fallback absent: unit control only, no live parity credit');
// Bounded automotive evidence reads; relay/provider credentials are never projected.
const automotive = { schema: 'comparator-v1', cases: [] };
const vehiclesConfig = read(resolve(folder + '/automotive/vehicles')) || {};
const historyRelative = vehiclesConfig.persistence?.dir
  ? String(vehiclesConfig.persistence.dir).replace(/^\/+/, '') : folder + '/automotive/log';
assert.ok(!path.isAbsolute(historyRelative) && !historyRelative.split('/').includes('..'));
const observeDirectory = relative => {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) { observeAbsent(relative); return []; }
  assert.equal(fs.realpathSync(absolute), absolute);
  const stat = fs.statSync(absolute); assert.ok(stat.isDirectory());
  const entries = fs.readdirSync(absolute).sort();
  inputs.push({ path: absolute, kind: 'directory', entries, dev: stat.dev, ino: stat.ino });
  return entries.filter(name => fs.statSync(path.join(absolute, name)).isDirectory());
};
const automotiveIds = [...new Set([...observeDirectory(folder + '/automotive').filter(id => id !== 'log'),
  ...observeDirectory(historyRelative)])].sort();
assert.ok(automotiveIds.length, 'Populated automotive roster required');
const vehicleDefs = Object.fromEntries(Object.entries(vehiclesConfig.vehicles || {}).map(([id, row]) => [id,
  { ...(row.label ? { label: row.label } : {}) }]));
fixtureFiles['data/' + folder + '/automotive/vehicles.yml'] = { vehicles: vehicleDefs,
  ...(vehiclesConfig.service_types ? { service_types: vehiclesConfig.service_types } : {}),
  ...(vehiclesConfig.persistence?.dir ? { persistence: { dir: vehiclesConfig.persistence.dir } } : {}) };
const automotiveVehicles = automotiveIds.map(id => {
  assert.match(id, /^[a-zA-Z0-9_-]+$/);
  const relative = resolve(folder + '/automotive/' + id + '/vehicle');
  const vehicle = read(relative);
  if (vehicle) fixtureFiles['data/' + relative] = vehicle;
  return { ...(vehicle || {}), id, label: vehicleDefs[id]?.label || vehicle?.label || id };
});
const configuredTypes = vehiclesConfig.service_types;
let serviceTypes = [];
if (Array.isArray(configuredTypes) && configuredTypes.length) {
  serviceTypes = configuredTypes.flatMap(row => {
    const value = typeof row?.value === 'string' ? row.value.trim() : '';
    if (!value) return [];
    const months = Number(row.default_interval_months ?? row.defaultIntervalMonths);
    const km = Number(row.default_interval_km ?? row.defaultIntervalKm);
    const spaced = value.replace(/[-_]+/g, ' ').trim();
    return [{ value, label: row.label || spaced.charAt(0).toUpperCase() + spaced.slice(1),
      defaultIntervalMonths: Number.isFinite(months) && months > 0 ? months : null,
      defaultIntervalKm: Number.isFinite(km) && km > 0 ? km : null }];
  });
}
if (!serviceTypes.length) serviceTypes = [...DEFAULT_SERVICE_TYPES];
const autoSources = ['modules/auto/server/api/automotive.mjs:39-60,95-97',
  'modules/auto/server/application/AutomotiveQueryService.mjs:8-15,26,41',
  'modules/auto/server/application/AutomotiveContainer.mjs:104-106,132-140',
  'modules/auto/server/adapters/persistence/YamlVehicleRecordDatastore.mjs:54-62',
  'modules/auto/server/adapters/persistence/YamlVehicleHistoryDatastore.mjs:50-53,95-108',
  'modules/auto/server/application/usecases/GetTripDetail.mjs',
  'modules/auto/server/domain/value-objects/GeoFix.mjs:32-48,71-81',
  'modules/auto/server/domain/services/OdometerService.mjs:121-133',
  'modules/auto/server/domain/entities/serviceTypes.mjs',
  'backend/src/0_system/utils/FileIO.mjs:70-76,238-267',
  'backend/src/2_domains/core/errors/EntityNotFoundError.mjs',
  'backend/src/0_system/http/middleware/errorHandler.mjs:90-125'];
const addAutomotive = (id, url, value, branch, status = 200) => {
  const c = make(id, url, objectBody(JSON.parse(JSON.stringify(value))));
  c.expected.status = status; c.expectationSource = autoSources; automotive.cases.push(c);
  branches.push({ caseId: id, branch, populatedGap: branch !== 'populated' });
};
addAutomotive('automotive-private-vehicles', '/api/v1/automotive/vehicles', { vehicles: automotiveVehicles }, 'populated');
addAutomotive('automotive-private-service-types', '/api/v1/automotive/service-types', { types: serviceTypes }, 'populated');
// Select bounded recordings by size; concrete private identities live only in output artifacts.
const selectedVehicleId = automotiveIds.find(id => fs.existsSync(path.join(root, historyRelative, id, 'trips')));
assert.ok(selectedVehicleId, 'Populated automotive recordings required');
const tripDirectory = historyRelative + '/' + selectedVehicleId + '/trips';
const listTripFiles = relative => {
  const directories = observeDirectory(relative);
  const absolute = path.join(root, relative);
  return fs.readdirSync(absolute).sort().filter(name => !name.startsWith('.')).flatMap(name => {
    if (directories.includes(name)) return listTripFiles(relative + '/' + name);
    const file = path.join(absolute, name); assert.equal(fs.realpathSync(file), file);
    const stat = fs.statSync(file);
    return stat.isFile() && /\.ya?ml$/.test(name)
      ? [{ ref: path.relative(path.join(root, tripDirectory), file).split(path.sep).join('/'), size: stat.size }] : [];
  });
};
const tripFiles = listTripFiles(tripDirectory);
assert.ok(tripFiles.length >= 3);
const selectedTripRefs = [];
for (const desiredSize of [600, 16000, 128000]) {
  const selected = tripFiles.filter(file => !selectedTripRefs.includes(file.ref))
    .sort((a, b) => Math.abs(a.size - desiredSize) - Math.abs(b.size - desiredSize) || b.ref.localeCompare(a.ref))[0];
  assert.ok(selected && selected.size <= 256000, 'Selected recording must stay bounded');
  selectedTripRefs.push(selected.ref);
}
sourceContract.automotive = { vehicles: automotiveVehicles, serviceTypes, selectedTrips: [], historyRelative };
for (const [index, ref] of selectedTripRefs.entries()) {
  const relative = historyRelative + '/' + selectedVehicleId + '/trips/' + ref;
  const trip = read(relative); assert.ok(trip && typeof trip === 'object' && !Array.isArray(trip), 'Reviewed selected recording required');
  fixtureFiles['data/' + relative] = trip;
  const samples = Array.isArray(trip.samples) ? trip.samples : [];
  const track = samples.flatMap(sample => {
    const lat = Number(sample.lat), lon = Number(sample.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || lat === 0 && lon === 0) return [];
    return [{ t: sample.t, lat, lon, speed_kph: sample.speed_kph ?? null }];
  });
  let integratedKm = 0;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1], next = samples[i];
    if (!Number.isFinite(previous?.speed_kph) || !Number.isFinite(next?.speed_kph)) continue;
    const hours = (Number(next.t) - Number(previous.t)) / 3600;
    if (Number.isFinite(hours) && hours > 0) integratedKm += (previous.speed_kph + next.speed_kph) / 2 * hours;
  }
  addAutomotive('automotive-private-trip-' + (index + 1), '/api/v1/automotive/vehicles/' + selectedVehicleId + '/trip?file=' + encodeURIComponent(ref),
    { meta: trip.meta || {}, units: trip.units || {}, track, samples,
      derived: { gps_distance_km: trip.meta?.distance_km ?? null,
        integrated_distance_km: integratedKm > 0 ? Number(integratedKm.toFixed(3)) : null,
        track_points: track.length, sample_count: samples.length } }, 'populated');
  sourceContract.automotive.selectedTrips.push({ ref, meta: trip.meta, sampleCount: samples.length,
    trackPointCount: track.length, integratedDistanceKm: integratedKm });
}
const missingTripRef = 'readiness-absent-trip.yml';
observeAbsent(historyRelative + '/' + selectedVehicleId + '/trips/' + missingTripRef);
addAutomotive('automotive-trip-not-found', '/api/v1/automotive/vehicles/' + selectedVehicleId + '/trip?file=' + missingTripRef,
  { error: 'Trip not found: ' + missingTripRef }, 'not-found', 404);
const escapedTripRef = '../../../' + selectedVehicleId + '/vehicle.yml';
addAutomotive('automotive-trip-contained-path-rejection', '/api/v1/automotive/vehicles/' + selectedVehicleId + '/trip?file=' + encodeURIComponent(escapedTripRef),
  { error: 'Trip not found: ' + escapedTripRef }, 'invalid-contained-path', 404);
// Stored Health queries only: no ledger recovery, nutrition reconstruction or writes.
const healthStored = { schema: 'comparator-v1', cases: [] };
const healthSources = ['modules/health/server/api/routers/health.mjs:888-908,1058-1062,1131-1134,1629-1641',
  'modules/health/server/api/presenters/FoodCatalogPresenter.mjs',
  'modules/health/server/application/health/FoodCatalogService.mjs:340-355',
  'modules/health/server/adapters/persistence/yaml/YamlFoodCatalogDatastore.mjs:28-37,76-84,94-105,120-123',
  'modules/health/server/domain/health/entities/FoodCatalogEntry.mjs:53-98,114-153,250-253,272-275,320-322',
  'modules/health/server/domain/health/services/catalogDensity.mjs:162-210',
  'modules/health/server/adapters/persistence/yaml/YamlObservationStore.mjs:364-373,446-475,596-607,622-633,723-735',
  'modules/health/server/domain/nutrition/services/ObservationValue.mjs',
  'modules/health/server/application/health/BudgetService.mjs:195-197',
  'modules/health/server/adapters/persistence/yaml/YamlHealthGoalsDatastore.mjs:14-17'];
const addHealthStored = (id, url, value, branch = 'populated', status = 200) => {
  const c = make(id, url, objectBody(JSON.parse(JSON.stringify(value))));
  c.expected.status = status; c.expectationSource = healthSources; healthStored.cases.push(c);
  branches.push({ caseId: id, branch, populatedGap: branch !== 'populated' });
};
const catalogRelative = resolve('users/' + household.head + '/lifelog/nutrition/food_catalog');
const rawCatalog = read(catalogRelative);
assert.ok(Array.isArray(rawCatalog) && rawCatalog.length, 'Populated saved-food catalog required');
assert.ok(rawCatalog.every(row => typeof row.id === 'string' && row.id && typeof row.lastUsed === 'string' && row.lastUsed
  && typeof row.createdAt === 'string' && row.createdAt), 'Transient catalog UUID/date defaults remain excluded');
const weightedMedian = (observations, value) => {
  const ordered = observations.map(row => ({ value: value(row), weight: row.source === 'upc' ? 3 : 1 })).sort((a, b) => a.value - b.value);
  const total = ordered.reduce((sum, row) => sum + row.weight, 0);
  let cumulative = 0;
  for (const row of ordered) { cumulative += row.weight; if (cumulative * 2 >= total) return row.value; }
};
const projectFood = raw => {
  const usable = (Array.isArray(raw.observations) ? raw.observations : []).filter(row => row && typeof row.kcal === 'number'
    && Number.isFinite(row.kcal) && row.kcal > 0 && typeof row.grams === 'number' && Number.isFinite(row.grams) && row.grams >= 5);
  let derived = null;
  if (usable.length) {
    const density = weightedMedian(usable, row => row.kcal / row.grams), grams = weightedMedian(usable, row => row.grams);
    const chronological = usable.slice().sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''))
      || String(a.logId ?? '').localeCompare(String(b.logId ?? '')));
    let chosen, delta = Infinity;
    for (const row of chronological) { const difference = Math.abs(row.kcal / row.grams - density); if (difference <= delta) { delta = difference; chosen = row; } }
    const factor = grams / chosen.grams, nutrients = { calories: Math.round(chosen.kcal * factor) };
    for (const key of ['protein', 'carbs', 'fat']) if (typeof chosen[key] === 'number' && Number.isFinite(chosen[key])) nutrients[key] = Math.round(chosen[key] * factor * 10) / 10;
    derived = { nutrients, grams: Math.round(grams * 10) / 10, density, count: usable.length };
  }
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  let serving = null;
  if (raw.serving && typeof raw.serving === 'object') {
    const amount = positive(Number(raw.serving.amount ?? raw.serving.size));
    const unit = typeof raw.serving.unit === 'string' && raw.serving.unit.trim() ? raw.serving.unit.trim() : null;
    if (amount === null || unit === null || ['serving', 'servings'].includes(unit.toLowerCase())) {
      const grams = positive(Number(raw.serving.grams)); if (grams) serving = { amount: amount ?? 1, unit: unit ?? 'serving', grams };
    } else serving = { amount, unit, grams: positive(Number(raw.serving.grams)) ?? (['g', 'gram', 'grams'].includes(unit.toLowerCase()) ? amount : null) };
  }
  const baseNutrients = raw.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0 };
  return { id: raw.id, name: raw.name, normalizedName: raw.normalizedName || (raw.name || '').toLowerCase().trim().replace(/\s+/g, ' '),
    nutrients: raw.manualPortion ? raw.manualPortion.nutrients : derived ? { ...baseNutrients, ...derived.nutrients } : baseNutrients,
    canonicalGrams: raw.manualPortion?.grams ?? derived?.grams ?? (typeof raw.baseGrams === 'number' && raw.baseGrams > 0 ? raw.baseGrams : null),
    densityKcalPerGram: raw.manualPortion ? raw.manualPortion.nutrients.calories / raw.manualPortion.grams : derived?.density ?? null,
    observationCount: derived?.count ?? 0, source: raw.source || 'manual', barcodeUpc: raw.barcodeUpc || null,
    useCount: raw.useCount || 1, icon: raw.icon || null, iconOverride: raw.iconOverride || null,
    photoRef: typeof raw.photoRef === 'string' && raw.photoRef ? raw.photoRef : null, serving,
    favorite: raw.favorite === true, lastUsed: raw.lastUsed, createdAt: raw.createdAt };
};
const catalogViews = rawCatalog.map(projectFood), selectedFoodIds = new Set();
const recentFoods = catalogViews.slice().sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).slice(0, 5);
for (const row of recentFoods) selectedFoodIds.add(row.id);
addHealthStored('health-private-catalog-recent', '/api/v1/health/nutrition/catalog/recent?limit=5', { items: recentFoods, count: recentFoods.length });
for (const query of ['chicken', 'protein']) {
  const found = catalogViews.filter(row => row.normalizedName.includes(query)).sort((a, b) => b.useCount - a.useCount).slice(0, 3);
  assert.ok(found.length, 'Populated reviewed catalog search required');
  for (const row of found) selectedFoodIds.add(row.id);
  addHealthStored('health-private-catalog-search-' + query, '/api/v1/health/nutrition/catalog?q=' + query + '&limit=3', { items: found, count: found.length });
}
const chosenDetailIds = new Set(), foodDetails = [];
for (const [kind, predicate] of [['derived', row => row.observationCount >= 3],
  ['label-serving', row => row.serving && (row.barcodeUpc || row.photoRef)], ['fallback', row => row.observationCount === 0]]) {
  const chosen = catalogViews.find(row => !chosenDetailIds.has(row.id) && predicate(row));
  assert.ok(chosen, 'Populated catalog detail branch required: ' + kind);
  chosenDetailIds.add(chosen.id); selectedFoodIds.add(chosen.id); foodDetails.push({ kind, entryId: chosen.id });
  addHealthStored('health-private-catalog-detail-' + kind, '/api/v1/health/nutrition/catalog/' + encodeURIComponent(chosen.id), { entry: chosen });
}
const catalogInputKeys = ['id', 'name', 'normalizedName', 'nutrients', 'baseGrams', 'manualPortion', 'observations', 'source',
  'barcodeUpc', 'useCount', 'favorite', 'icon', 'iconOverride', 'photoRef', 'serving', 'lastUsed', 'createdAt'];
const selectedCatalog = rawCatalog.filter(row => selectedFoodIds.has(row.id)).map(row => Object.fromEntries(catalogInputKeys
  .filter(key => row[key] !== undefined).map(key => [key, row[key]])));
fixtureFiles['data/' + catalogRelative] = selectedCatalog;
const absentFoodId = 'readiness-absent-food'; assert.ok(!rawCatalog.some(row => row.id === absentFoodId));
addHealthStored('health-catalog-food-not-found', '/api/v1/health/nutrition/catalog/' + absentFoodId,
  { error: 'Saved food no longer exists' }, 'not-found', 404);
addHealthStored('health-catalog-missing-query', '/api/v1/health/nutrition/catalog', { error: 'q query param required' }, 'invalid-input', 400);
const goalsRelative = resolve('users/' + household.head + '/apps/health/goals'), healthGoals = read(goalsRelative);
assert.ok(healthGoals && typeof healthGoals === 'object' && !Array.isArray(healthGoals), 'Populated stored goals required');
fixtureFiles['data/' + goalsRelative] = healthGoals;
addHealthStored('health-private-goals', '/api/v1/health/goals', { goals: healthGoals });
const observationRelative = resolve('users/' + household.head + '/lifelog/nutrition/observations');
const hotObservations = read(observationRelative);
assert.ok(Array.isArray(hotObservations) && hotObservations.length, 'Populated hot observations required');
const observationArchiveRelative = 'users/' + household.head + '/lifelog/nutrition/archives/observations';
assert.ok(!fs.existsSync(path.join(root, observationArchiveRelative)), 'Populated observation archive branch needs separate reviewed projection');
observeAbsent(observationArchiveRelative);
const validObservation = row => row && typeof row.id === 'string' && row.id && ['weight', 'upc', 'container', 'density'].includes(row.kind)
  && typeof row.scaleId === 'string' && row.scaleId && typeof row.at === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.at)
  && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && ['open', 'consumed', 'dismissed'].includes(row.status)
  && (row.kind === 'weight' ? Number.isFinite(row.value) && (row.unit == null || typeof row.unit === 'string' && row.unit.length > 0)
    : row.kind === 'density' ? Number.isInteger(row.value) && row.value >= 1 && row.value <= 9 : typeof row.value === 'string' && row.value.length > 0);
assert.ok(hotObservations.every(validObservation), 'Malformed observation row branch needs separate expectations');
const presentObservation = row => ({ id: row.id, kind: row.kind, value: row.value, unit: row.unit ?? null, scaleId: row.scaleId,
  at: row.at, date: row.date, status: row.status, pairedEntryUuid: row.pairedEntryUuid ?? null });
fixtureFiles['data/' + observationRelative] = hotObservations.map(presentObservation);
const selectedObservationDates = new Set(), observationBranches = [];
for (const status of ['open', 'consumed', 'dismissed']) {
  const selected = hotObservations.find(row => row.status === status && !selectedObservationDates.has(row.date));
  assert.ok(selected, 'Distinct populated observation lifecycle day required: ' + status);
  selectedObservationDates.add(selected.date); observationBranches.push({ status, date: selected.date });
  const observations = hotObservations.filter(row => row.date === selected.date).sort((a, b) => a.at.localeCompare(b.at)).map(presentObservation);
  addHealthStored('health-private-observations-' + status, '/api/v1/health/nutrition/observations?date=' + selected.date,
    { observations, date: selected.date, count: observations.length });
}
sourceContract.healthStored = { selectedCatalog, totalSourceCatalogEntries: rawCatalog.length, foodDetails,
  goals: healthGoals, observations: hotObservations.map(presentObservation), observationBranches, archiveAbsent: true };
blockers.push('Health catalog transient hydration defaults/manual override and populated observation archives remain uncovered');
// Finance provider bypasses: omitted refresh and explicit budgetDate read stored YAML only.
// Copy the complete selected period's public fields, not other transaction history.
const financeStored = { schema: 'comparator-v1', cases: [] };
const financeAuth = read(resolve('system/config/auth'));
assert.ok(financeAuth?.roles?.sysadmin?.apps?.includes('*'), 'Loopback sysadmin wildcard permission required for Finance no-token lane');
const financeStoredSources = ['modules/finance/server/api/finance.mjs:50-77',
  'modules/finance/server/application/FinanceApiService.mjs:77-122',
  'modules/finance/server/adapters/persistence/YamlFinanceDatastore.mjs:55-66,110-113,143-152,193-196',
  'modules/finance/server/composition/financeApi.mjs:24-40',
  'backend/src/0_system/utils/FileIO.mjs:70-76,119-124'];
const addFinanceStored = (id, url, body, branch = 'populated') => {
  const c = make(id, url, objectBody(JSON.parse(JSON.stringify(body)))); c.expectationSource = financeStoredSources;
  financeStored.cases.push(c); branches.push({ caseId: id, branch });
};
const publicFields = (row, fields) => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const balanceRelative = resolve(folder + '/finance/account.balances');
const balanceData = read(balanceRelative);
assert.ok(Array.isArray(balanceData?.accountBalances) && balanceData.accountBalances.length > 0, 'Populated stored account balances required');
const accountFields = ['id', 'name', 'type', 'balance', 'currency', 'institution', 'lastUpdated', 'metadata'];
const storedAccounts = balanceData.accountBalances.map(row => publicFields(row, accountFields));
fixtureFiles['data/' + balanceRelative] = { accountBalances: storedAccounts };
addFinanceStored('finance-private-stored-accounts', '/api/v1/finance/accounts', { accounts: storedAccounts, source: 'cache', household: householdId });
const selectedTransactionPeriod = Object.keys(finances?.budgets ?? {}).sort().at(-1);
assert.match(selectedTransactionPeriod ?? '', /^\d{4}-\d{2}-\d{2}$/, 'Safe selected transaction period required');
const transactionRelative = resolve(folder + '/finance/' + selectedTransactionPeriod + '/transactions');
const transactionData = read(transactionRelative);
assert.ok(Array.isArray(transactionData?.transactions) && transactionData.transactions.length > 0, 'Populated selected stored transaction period required');
const transactionFields = ['id', 'date', 'amount', 'description', 'category', 'accountId', 'type', 'tags', 'metadata'];
const storedTransactions = transactionData.transactions.map(row => publicFields(row, transactionFields));
fixtureFiles['data/' + transactionRelative] = { transactions: storedTransactions };
addFinanceStored('finance-private-stored-transactions', '/api/v1/finance/transactions?budgetDate=' + selectedTransactionPeriod,
  { transactions: storedTransactions, count: storedTransactions.length, household: householdId });
const absentTransactionPeriod = '1900-01-01';
assert.ok(!Object.hasOwn(finances.budgets, absentTransactionPeriod));
const absentTransactionRelative = resolve(folder + '/finance/' + absentTransactionPeriod + '/transactions');
assert.equal(read(absentTransactionRelative), null, 'Unknown period must have absent transaction backing');
addFinanceStored('finance-stored-transactions-absent-period', '/api/v1/finance/transactions?budgetDate=' + absentTransactionPeriod,
  { transactions: [], count: 0, household: householdId }, 'empty');
// The production nowMonth composition formats in the domain default LA timezone.
// Derive the month independently with Intl; do not call that product helper.
const financeCurrentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(new Date());
let selectedDayToDay = null, selectedDayToDayPeriod = null, selectedDayToDayMonth = null;
for (const period of Object.keys(finances.budgets).sort().reverse()) {
  const sourceMonths = finances.budgets[period]?.dayToDayBudget;
  if (!sourceMonths) continue;
  const projectedMonths = Object.fromEntries(Object.entries(sourceMonths).map(([month, row]) => [month,
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'transactions'))]));
  fixtureFiles['data/' + folder + '/finance/finances.yml'].budgets[period] ??= {};
  // Complete selected detail snapshots already satisfy the summary reader too.
  fixtureFiles['data/' + folder + '/finance/finances.yml'].budgets[period].dayToDayBudget ??= projectedMonths;
  const month = Object.keys(projectedMonths).filter(value => value <= financeCurrentMonth).sort().at(-1);
  if (!selectedDayToDay && month) {
    selectedDayToDay = projectedMonths[month]; selectedDayToDayPeriod = period; selectedDayToDayMonth = month;
  }
}
assert.ok(selectedDayToDay && Object.keys(selectedDayToDay).length > 0, 'Populated stored day-to-day summary required');
addFinanceStored('finance-private-stored-daytoday', '/api/v1/finance/data/daytoday', selectedDayToDay);
sourceContract.financeStored = { accounts: storedAccounts, selectedTransactionPeriod, transactions: storedTransactions,
  absentTransactionPeriod, financeCurrentMonth, selectedDayToDayPeriod, selectedDayToDayMonth, daytoday: selectedDayToDay };
blockers.push('Finance overview/compiled full data/default provider-date transactions/refresh and unconfigured or invalid household branches remain uncovered');
// Life reads hydrate the selected stored plan in memory; expectations below
// independently spell out serialized field/default contracts, without product helpers.
const lifeStored = { schema: 'comparator-v1', cases: [] };
const lifeSources = ['modules/life/server/api/life.mjs', 'modules/life/server/api/life/identity.mjs',
  'modules/life/server/api/life/plan.mjs', 'modules/life/server/api/life/now.mjs',
  'modules/life/server/application/LifePlanOperations.mjs', 'modules/life/server/application/presenters/lifePlanPresenter.mjs',
  'modules/life/server/adapters/persistence/YamlLifePlanStore.mjs', 'modules/life/server/adapters/persistence/YamlLifeplanMetricsStore.mjs',
  'modules/life/server/adapters/persistence/YamlCeremonyRecordStore.mjs',
  'modules/life/server/application/services/FeedbackService.mjs', 'modules/life/server/application/services/RetroService.mjs',
  'modules/life/server/application/services/DriftService.mjs', 'modules/life/server/application/services/CeremonyService.mjs',
  'modules/life/server/application/services/AlignmentService.mjs', 'modules/life/server/domain/services/CadenceService.mjs',
  'modules/life/server/domain/entities/LifePlan.mjs', 'modules/life/server/domain/entities/Goal.mjs',
  'modules/life/server/domain/entities/Belief.mjs', 'modules/life/server/domain/entities/Value.mjs',
  'modules/life/server/domain/entities/Quality.mjs', 'modules/life/server/domain/entities/Purpose.mjs',
  'modules/life/server/domain/entities/FeedbackEntry.mjs'];
const addLifeStored = (id, url, value, branch = 'populated', status = 200) => {
  const equals = JSON.parse(JSON.stringify(value));
  const required = Object.fromEntries(Object.entries(equals).filter(([, v]) => v !== null).map(([key, v]) => [key, Array.isArray(v) ? 'array' : typeof v]));
  assert.ok(Object.keys(required).length > 0, 'Life responses need nonempty explicit shape');
  const c = make(id, url, { kind: 'json', required, equals });
  c.expected.status = status; c.expectationSource = lifeSources;
  lifeStored.cases.push(c); branches.push({ caseId: id, branch });
};
const lifeRelative = 'users/' + household.head + '/lifeplan.yml', rawLife = read(lifeRelative);
assert.ok(rawLife && Array.isArray(rawLife.goals) && rawLife.goals.length > 0 && rawLife.purpose, 'Populated selected Life plan required');
fixtureFiles['data/' + lifeRelative] = rawLife;
// This concrete plan has no authored nonempty ancillary entity/config branches.
for (const key of ['rules', 'dependencies', 'life_events', 'anti_goals', 'cycles', 'ceremony_records']) {
  assert.ok(!rawLife[key] || Array.isArray(rawLife[key]) && rawLife[key].length === 0, 'Populated ' + key + ' requires separate Life expectations');
}
assert.ok(Object.keys(rawLife.cadence || {}).length === 0 && Object.keys(rawLife.ceremonies || {}).length === 0, 'Custom Life cadence/ceremonies require separate expectations');
const hydrateOr = (row, direct, defaults) => ({ ...publicFields(row, direct),
  ...Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, row[key] || fallback])) });
const lifeGoals = rawLife.goals.map(row => hydrateOr(row, ['id', 'name'], {
  state: 'dream', quality: null, why: null, sacrifice: null, deadline: null, metrics: [], audacity: null,
  milestones: [], state_history: [], dependencies: [], avoids_nightmare: null, nightmare_proximity: null,
  retrospective: null, achieved_date: null, failed_date: null, abandoned_reason: null, paused_reason: null, resume_conditions: null }));
const lifeBeliefs = (rawLife.beliefs || []).map(row => ({ ...hydrateOr(row, ['id', 'if', 'then'], {
  state: 'hypothesized', foundational: false, signals: [], evidence_history: [],
  evidence_quality: { sample_size: 0, observation_span: null, biases_considered: [] }, depends_on: [], state_history: [], origin: null }), confidence: row.confidence ?? 0.5 }));
const lifeValues = (rawLife.values || []).map(row => ({ ...hydrateOr(row, ['id', 'name'], {
  description: null, justified_by: [], conflicts_with: [], alignment: 'aligned', drift_history: [] }), rank: row.rank ?? null }));
const lifeQualities = (rawLife.qualities || []).map(row => {
  assert.ok(!row.rules || row.rules.length === 0, 'Populated quality rules need separate effectiveness expectations');
  return hydrateOr(row, ['id', 'name'], { description: null, principles: [], rules: [],
    grounded_in: { beliefs: [], values: [] }, shadow: null, shadow_state: 'dormant', last_shadow_check: null });
});
const lifeFeedback = (rawLife.feedback || []).map(row => hydrateOr(row, ['date', 'content'], {
  cycle_id: null, type: 'observation', related_goals: [], related_beliefs: [], related_rules: [] }));
assert.ok(lifeFeedback.length > 0, 'Populated stored Life feedback required');
const lifePlan = { purpose: hydrateOr(rawLife.purpose, ['statement'], { adopted: null, last_reviewed: null,
  review_cadence: 'era', notes: null, grounded_in: { beliefs: [], values: [] } }), goals: lifeGoals,
  beliefs: lifeBeliefs, values: lifeValues, qualities: lifeQualities, rules: [], dependencies: [], life_events: [],
  anti_goals: [], cycles: [], ceremony_records: [], feedback: lifeFeedback, cadence: {}, ceremonies: {} };
const metricsRelative = 'users/' + household.head + '/lifeplan-metrics.yml', lifeMetrics = read(metricsRelative);
assert.ok(Array.isArray(lifeMetrics) && lifeMetrics.length > 0 && lifeMetrics.every(row => row && typeof row === 'object' && !Array.isArray(row)), 'Populated stored Life metrics required');
fixtureFiles['data/' + metricsRelative] = lifeMetrics;
const latestLifeMetric = lifeMetrics.at(-1);
// Alignment's briefing response still executes the local ceremony adherence read.
const ceremonyRecordsRelative = 'users/' + household.head + '/ceremony-records.yml';
const lifeCeremonyRecords = read(ceremonyRecordsRelative);
assert.ok(lifeCeremonyRecords === null || Array.isArray(lifeCeremonyRecords), 'Ceremony records must be a reviewed stored array');
if (lifeCeremonyRecords !== null) fixtureFiles['data/' + ceremonyRecordsRelative] = lifeCeremonyRecords;
addLifeStored('life-private-plan', '/api/v1/life/plan', lifePlan);
addLifeStored('life-private-goals', '/api/v1/life/plan/goals', { goals: lifeGoals });
assert.ok(typeof lifeGoals[0].id === 'string' && lifeGoals[0].id);
addLifeStored('life-private-goal-detail', '/api/v1/life/plan/goals/' + encodeURIComponent(lifeGoals[0].id), lifeGoals[0]);
const absentLifeGoal = 'readiness-absent-goal'; assert.ok(!lifeGoals.some(row => row.id === absentLifeGoal));
addLifeStored('life-goal-not-found', '/api/v1/life/plan/goals/' + absentLifeGoal, { error: 'Goal not found' }, 'not-found', 404);
addLifeStored('life-private-beliefs', '/api/v1/life/plan/beliefs', { beliefs: lifeBeliefs });
addLifeStored('life-private-feedback', '/api/v1/life/plan/feedback', { feedback: lifeFeedback });
// Stored FeedbackEntry exposes date; period filtering currently reads timestamp.
// Preserve that source contract rather than manufacturing timestamp/content fields.
assert.ok(lifeFeedback.every(row => row.timestamp === undefined));
addLifeStored('life-feedback-period-timestamp-gap', '/api/v1/life/plan/feedback?start=1900-01-01&end=2100-01-01', { feedback: [] }, 'baseline-semantic-failure');
addLifeStored('life-private-retro', '/api/v1/life/plan/retro', { period: null, feedback: lifeFeedback,
  goalSummary: { total: lifeGoals.length, active: lifeGoals.filter(row => !['achieved', 'failed', 'abandoned'].includes(row.state)).length,
    achieved: lifeGoals.filter(row => row.state === 'achieved').length, failed: lifeGoals.filter(row => row.state === 'failed').length,
    goals: lifeGoals.map(({ id, name, state }) => ({ id, name, state })) },
  beliefSummary: { total: lifeBeliefs.length, confirmed: lifeBeliefs.filter(row => row.state === 'confirmed').length,
    refuted: lifeBeliefs.filter(row => row.state === 'refuted').length, testing: lifeBeliefs.filter(row => row.state === 'testing').length,
    beliefs: lifeBeliefs.map(({ id, state, confidence }) => ({ id, state, confidence })) },
  drift: latestLifeMetric, ruleEffectiveness: [] });
addLifeStored('life-private-drift-latest', '/api/v1/life/now/drift', latestLifeMetric);
addLifeStored('life-private-drift-history', '/api/v1/life/now/drift/history', { history: lifeMetrics });
addLifeStored('life-private-alignment-briefing', '/api/v1/life/now?mode=briefing', {
  briefingContext: { plan: lifePlan, snapshot: latestLifeMetric, recentFeedback: lifeFeedback.slice(-5) } });
const lifeTimezone = household.timezone ?? system.timezone ?? 'America/Los_Angeles';
const lifeLocalDate = new Intl.DateTimeFormat('en-CA', { timeZone: lifeTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const lifeDaySerial = Date.parse(lifeLocalDate + 'T00:00:00Z') / 86400000, lifeEpochSerial = Date.parse('2024-12-30T00:00:00Z') / 86400000;
const lifeCadence = Object.fromEntries([['unit', 1, 'day'], ['cycle', 7, 'week'], ['phase', 30, 'month'], ['season', 90, 'quarter'], ['era', 365, 'year']].map(([level, durationDays, alias]) => {
  const periodIndex = Math.floor((lifeDaySerial - lifeEpochSerial) / durationDays);
  return [level, { periodIndex, periodId: lifeLocalDate.slice(0, 4) + '-' + level[0].toUpperCase() + periodIndex,
    startDate: new Date((lifeEpochSerial + periodIndex * durationDays) * 86400000).toISOString(), durationDays, alias }];
}));
addLifeStored('life-private-cadence', '/api/v1/life/plan/cadence', { config: {}, current: lifeCadence });
addLifeStored('life-private-ceremony-intention', '/api/v1/life/plan/ceremony/unit_intention', {
  type: 'unit_intention', username: household.head, cadencePosition: lifeCadence, periodId: lifeCadence.unit.periodId,
  activeGoals: lifeGoals.filter(row => !['achieved', 'failed', 'abandoned'].includes(row.state)), rules: [] });
addLifeStored('life-ceremony-unknown-type', '/api/v1/life/plan/ceremony/readiness-unknown', { error: 'Unknown ceremony type: readiness-unknown' }, 'invalid-input', 400);
sourceContract.lifeStored = { plan: lifePlan, metrics: lifeMetrics, latestMetric: latestLifeMetric, localDate: lifeLocalDate,
  timezone: lifeTimezone, cadence: lifeCadence, ceremonyRecords: lifeCeremonyRecords,
  feedbackFinding: { status: 'baseline-semantic-failure', dateFieldExpectedCount: lifeFeedback.length, timestampFieldActualCount: 0,
    explanation: 'Backing/entity expose date, while current period filter reads timestamp; comparator equality of empty arrays does not establish correct filtering. Stored content missing remains omitted.' } };
blockers.push('Life custom cadence/ceremonies, populated ancillary entities/rules and displayed ceremony-records, missing/corrupt plans/metrics and other alignment/logaggregate branches remain uncovered; feedback timestamp/content mismatch preserved');
// School governance reads: direct append-only logs and period config fallback.
// No print-service/device activation, curriculum/bank joins, or teacher capability.
const schoolRecords = { schema: 'comparator-v1', cases: [] };
const schoolRecordSources = ['modules/school/server/api/school.mjs:888-898,923-931,999-1005,1019-1029,1370-1374,1421-1425',
  'modules/school/server/application/services/SchoolRecordsQueryService.mjs:25-33',
  'modules/school/server/adapters/persistence/YamlAttestationLog.mjs:24-58',
  'modules/school/server/adapters/persistence/YamlTeacherNotes.mjs:24-58',
  'modules/school/server/adapters/persistence/YamlAcademicPeriodStore.mjs:58-104',
  'modules/school/server/adapters/persistence/YamlPassOverrideStore.mjs:24-46',
  'modules/school/server/adapters/persistence/YamlEnrichmentLog.mjs:24-60',
  'modules/school/server/adapters/progress/ConfiguredSchoolLearningDirectory.mjs:65-87',
  'modules/school/server/domain/progress/learningProgress.mjs:122-149',
  'modules/school/server/composition/schoolApi.mjs:15-65'];
const addSchoolRecord = (id, url, value, branch = 'populated', status = 200, extraHeaders = {}) => {
  const serialized = JSON.parse(JSON.stringify(value));
  const body = Array.isArray(serialized) ? { kind: 'json-array', exact: serialized } : objectBody(serialized);
  const c = make(id, url, body, extraHeaders); c.expected.status = status;
  c.expectationSource = schoolRecordSources; schoolRecords.cases.push(c); branches.push({ caseId: id, branch });
};
const schoolAttestationsRelative = folder + '/school/records/attestations.yml', schoolAttestationData = read(schoolAttestationsRelative);
const schoolNotesRelative = folder + '/school/records/teacher-notes.yml', schoolNotesData = read(schoolNotesRelative);
for (const [relative, data] of [[schoolAttestationsRelative, schoolAttestationData], [schoolNotesRelative, schoolNotesData]]) {
  assert.ok(Array.isArray(data?.entries) && data.entries.length > 0, 'Populated School record backing required');
  assert.ok(data.entries.every(row => row && typeof row === 'object' && !Array.isArray(row) && typeof row.id === 'string' && typeof row.learnerId === 'string'), 'Malformed School log needs separate expectations');
  fixtureFiles['data/' + relative] = { entries: data.entries };
}
const independentActiveRecords = entries => {
  const withdrawn = new Set(entries.filter(row => row.kind === 'retraction').map(row => row.retracts));
  return entries.filter(row => row.kind !== 'retraction' && !withdrawn.has(row.id));
};
const activeAttestations = independentActiveRecords(schoolAttestationData.entries), activeTeacherNotes = independentActiveRecords(schoolNotesData.entries);
assert.ok(activeAttestations.length > 0 && activeTeacherNotes.length > 0, 'Populated active School log branches required');
// Current selected log has no withdrawn entries; the annotated false branch is
// tested independently, while a populated retraction branch remains uncovered.
assert.ok(schoolAttestationData.entries.every(row => row.kind !== 'retraction'), 'Populated School retractions need separate expectations');
const annotatedAttestations = schoolAttestationData.entries.map(row => ({ ...row, retracted: false }));
addSchoolRecord('school-private-attestations', '/api/v1/school/attestations', { entries: activeAttestations });
addSchoolRecord('school-private-attestations-annotated', '/api/v1/school/attestations?includeRetracted=1', { entries: annotatedAttestations });
addSchoolRecord('school-private-teacher-notes', '/api/v1/school/teacher-notes', { entries: activeTeacherNotes });
const absentSchoolLearner = 'readiness-absent-learner';
assert.ok(!schoolNotesData.entries.some(row => row.learnerId === absentSchoolLearner) && !profiles.some(row => row.id === absentSchoolLearner));
addSchoolRecord('school-teacher-notes-unknown-learner', '/api/v1/school/teacher-notes?learnerId=' + absentSchoolLearner, { entries: [] }, 'empty-filter');
addSchoolRecord('school-record-invalid-learner-query', '/api/v1/school/attestations?learnerId=first&learnerId=second', { error: 'query value must be text' }, 'invalid-input', 400);
const storedPeriodRelative = folder + '/school/plans/periods.yml', storedPeriods = read(storedPeriodRelative);
assert.ok(storedPeriods === null, 'Stored School period promotion needs separate expectations');
const rawConfiguredPeriods = school.progress?.academicPeriods ?? school.academicPeriods;
assert.ok(Array.isArray(rawConfiguredPeriods) && rawConfiguredPeriods.length > 0, 'Populated configured School period fallback required');
const schoolPeriods = rawConfiguredPeriods.map(row => {
  assert.ok(['periodId', 'kind', 'label', 'startsAt', 'endsAt'].every(key => typeof row[key] === 'string' && row[key]));
  assert.ok(row.schema === undefined || row.schema === 'school.academic-period/v1');
  assert.ok(new Date(row.startsAt).toISOString() === row.startsAt && new Date(row.endsAt).toISOString() === row.endsAt && row.startsAt < row.endsAt);
  return { schema: 'school.academic-period/v1', ...publicFields(row, ['periodId', 'kind', 'label', 'startsAt', 'endsAt']),
    ...(row.parentPeriodId ? { parentPeriodId: String(row.parentPeriodId) } : {}) };
});
assert.equal(new Set(schoolPeriods.map(row => row.periodId)).size, schoolPeriods.length);
fixtureFiles['data/' + folder + '/school/school.yml'].progress = { academicPeriods: rawConfiguredPeriods };
addSchoolRecord('school-private-periods-config-fallback', '/api/v1/school/periods', schoolPeriods, 'populated', 200, { 'cache-control': 'no-store' });
addSchoolRecord('school-periods-history-absent', '/api/v1/school/periods-meta', { historyLength: 0 }, 'empty-history');
const schoolOverrideRelative = folder + '/school/plans/pass-overrides.yml', schoolEnrichmentRelative = folder + '/school/records/enrichment.yml';
assert.ok(read(schoolOverrideRelative) === null && read(schoolEnrichmentRelative) === null, 'Populated School overrides/enrichment need separate expectations');
addSchoolRecord('school-enrichment-absent', '/api/v1/school/enrichment', { entries: [] }, 'empty-absent');
sourceContract.schoolRecords = { attestations: schoolAttestationData.entries, activeAttestations, annotatedAttestations,
  teacherNotes: schoolNotesData.entries, activeTeacherNotes, configuredPeriods: schoolPeriods,
  storedPeriodsAbsent: true, periodHistoryLength: 0, passOverridesAbsent: true, enrichmentAbsent: true, absentSchoolLearner };
blockers.push('School record retractions/corrupt logs, promoted period backing/history, populated overrides/enrichment and print/media-backed branches remain uncovered');
let pianoStored = null, schoolStored = null, fitnessStored = null, languageStored = null, rawUTF8Files = [], rawBinaryFiles = [], fixtureDirectories = [], metadataDirectories = [];
if (options['--piano-stored'] === 'true') {
  const pianoOutput = path.join(output, 'piano'); fs.mkdirSync(pianoOutput, { mode: 0o700 });
  const projected = spawnSync('/usr/bin/python3', [fileURLToPath(new URL('./project-piano-fixture.py', import.meta.url)), root, pianoOutput], { encoding: 'utf8', timeout: 75000, maxBuffer: 1024 * 1024 });
  assert.equal(projected.status, 0, 'Independent Piano projection failed: ' + projected.stderr);
  const plan = JSON.parse(fs.readFileSync(path.join(pianoOutput, 'piano-caseplan-private.json')));
  for (const [destination, value] of Object.entries(plan.fixtureDelta.files)) {
    assert.ok(!Object.hasOwn(fixtureFiles, destination), 'Piano JSON projection collision'); fixtureFiles[destination] = value;
  }
  rawUTF8Files = plan.fixtureDelta.rawUTF8Files.map(({ destination, sourceFile, sha256, byteLength, encoding }) => ({ destination, sha256, byteLength, encoding, base64: fs.readFileSync(sourceFile).toString('base64') }));
  validateRawFixtures({ fixtureFiles, rawUTF8Files });
  inputs.push(...plan.backingInputs);
  for (const row of plan.backingDirectories) { const stat = fs.statSync(row.path); inputs.push({ path: row.path, kind: 'directory', entries: row.names, dev: stat.dev, ino: stat.ino }); }
  branches.push(...plan.cases.map(row => ({ caseId: row.case.id, branch: row.branch })));
  sourceContract.pianoStored = { baselineFindings: plan.sourceBaselineFindings, gaps: plan.gaps };
  pianoStored = { schema: 'comparator-v1', cases: plan.cases.map(row => row.case) };
}
if (options['--school-packet']) {
  const packet = JSON.parse(fs.readFileSync(options['--school-packet']));
  const school = applySchoolPacket(packet, fixtureFiles, root);
  rawUTF8Files.push(...school.rawUTF8Files); rawBinaryFiles = school.rawBinaryFiles;
  validateRawFixtures({ fixtureFiles, rawUTF8Files, rawBinaryFiles });
  inputs.push(...school.inputs); schoolStored = school.manifest;
  sourceContract.schoolStored = school.contract;
  branches.push(...packet.cases.map(row => ({ caseId: row.id, branch: row.branch })));
}
if (options['--fitness-packet']) {
  const packet = JSON.parse(fs.readFileSync(options['--fitness-packet']));
  const fitness = applyFitnessPacket(packet, fixtureFiles, root);
  rawUTF8Files.push(...fitness.rawUTF8Files); fixtureDirectories = fitness.fixtureDirectories; metadataDirectories = fitness.metadataDirectories;
  validateRawFixtures({fixtureFiles,rawUTF8Files,rawBinaryFiles}); inputs.push(...fitness.inputs); fitnessStored = fitness.manifest;
  sourceContract.fitnessStored = fitness.contract; branches.push(...packet.cases.map(row=>({caseId:row.id,branch:row.branch})));
}
if (options['--language-packet']) {
  const packet = JSON.parse(fs.readFileSync(options['--language-packet']));
  const language = applyLanguagePacket(packet, fixtureFiles, root, make);
  rawUTF8Files.push(...language.rawUTF8Files); rawBinaryFiles.push(...language.rawBinaryFiles);
  validateRawFixtures({ fixtureFiles, rawUTF8Files, rawBinaryFiles });
  inputs.push(...language.inputs); languageStored = language.manifest; sourceContract.languageStored = language.contract;
  branches.push(...packet.cases.map(row => ({ caseId: row.id, branch: row.branch })));
}
assertBudgetDetailContracts(fixtureFiles['data/' + folder + '/finance/finances.yml'], reconciled.cases);
for (const r of inputs) {
  if (r.absent) {
    assert.ok(!fs.existsSync(r.path), 'Absent backing file appeared');
    continue;
  }
  const stat = fs.statSync(r.path);
  assert.equal(stat.dev, r.dev);
  assert.equal(stat.ino, r.ino);
  if (r.kind === 'directory') assert.deepEqual(fs.readdirSync(r.path).sort(), r.entries, 'Backing directory changed during projection');
  else if (r.kind === 'directory-identity') assert.ok(stat.isDirectory());
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
    fixtureFiles, ...(rawUTF8Files.length ? { rawUTF8Files } : {}), ...(rawBinaryFiles.length ? { rawBinaryFiles } : {}), ...(fixtureDirectories.length ? {fixtureDirectories} : {}), ...(metadataDirectories.length ? {metadataDirectories} : {})
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
  'extended-readonly-expectations.json': extended,
  'reconciled-readonly-expectations.json': reconciled,
  'feedback-readonly-expectations.json': feedback,
  'calendar-readonly-expectations.json': calendar,
  'automotive-readonly-expectations.json': automotive,
  'health-stored-readonly-expectations.json': healthStored,
  'finance-stored-readonly-expectations.json': financeStored,
  'life-stored-readonly-expectations.json': lifeStored,
  'school-records-readonly-expectations.json': schoolRecords
};
if (languageStored) artifacts['language-stored-readonly-expectations.json'] = languageStored;
if (fitnessStored) artifacts['fitness-stored-readonly-expectations.json'] = fitnessStored;
if (schoolStored) artifacts['school-stored-readonly-expectations.json'] = schoolStored;
if (pianoStored) artifacts['piano-stored-readonly-expectations.json'] = pianoStored;
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
  reconciledCases: reconciled.cases.length,
  feedbackCases: feedback.cases.length,
  calendarCases: calendar.cases.length,
  automotiveCases: automotive.cases.length,
  healthStoredCases: healthStored.cases.length,
  financeStoredCases: financeStored.cases.length,
  lifeStoredCases: lifeStored.cases.length,
  schoolRecordsCases: schoolRecords.cases.length,
  extendedPopulated: branches.filter(row => extended.cases.some(c => c.id === row.caseId) && row.branch === 'populated').length,
  extendedEmpty: branches.filter(row => extended.cases.some(c => c.id === row.caseId) && row.branch !== 'populated').length,
  pianoBudgetEnabled: enabled,
  blockers,
  scope: 'Source-derived selected projections; independent snapshot'
}) + '\n');
