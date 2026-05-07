import { describe, it, expect, vi } from 'vitest';

import { LongitudinalToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/LongitudinalToolFactory.mjs';

// -------------------------------------------------------------------
// query_named_period (F-103.4)
// -------------------------------------------------------------------
//
// Resolves a labeled period from the user's playbook (via
// personalContextLoader.loadPlaybook) and returns aggregated weight
// (weekly_avg), full nutrition days, and full workout list for the
// period's [from, to] range.

function getNamedPeriodTool(factory) {
  return factory.createTools().find(t => t.name === 'query_named_period');
}

function buildPlaybook(periods) {
  return {
    schema_version: 1,
    named_periods: periods,
  };
}

describe('LongitudinalToolFactory.query_named_period', () => {
  // Use a deterministic weight + nutrition + workouts fixture spanning the
  // playbook's fixture-cut-2024 period (2024-02-01 → 2024-04-30).
  function buildPeriodWeightFixture() {
    const out = {};
    let lbs = 200;
    const start = new Date(Date.UTC(2024, 1, 1)); // Feb 1, 2024
    const end = new Date(Date.UTC(2024, 3, 30));  // Apr 30, 2024
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      out[date] = {
        date,
        lbs,
        lbs_adjusted_average: lbs - 0.5,
        fat_percent: 22,
        fat_percent_average: 21.5,
        source: 'consumer-bia',
      };
      lbs -= 0.05;
    }
    return out;
  }

  function buildPeriodNutritionFixture() {
    const out = {};
    const start = new Date(Date.UTC(2024, 1, 1));
    const end = new Date(Date.UTC(2024, 3, 30));
    let i = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      out[date] = {
        calories: 1800 + (i % 5),
        protein: 145,
        carbs: 180,
        fat: 60,
      };
      i++;
    }
    return out;
  }

  function buildPeriodWorkoutsFixture() {
    return {
      '2024-02-15': { workouts: [{ title: 'Tempo Run', type: 'run', duration: 1800, calories: 350, avgHr: 155 }] },
      '2024-03-10': { workouts: [{ title: 'Long Run', type: 'run', duration: 5400, calories: 800, avgHr: 145 }] },
      '2024-04-20': { workouts: [{ title: 'Strength A', type: 'strength', duration: 2400, calories: 220, avgHr: 110 }] },
      // Outside the period — must NOT be returned.
      '2024-05-15': { workouts: [{ title: 'Outside Period Run', type: 'run', duration: 1800, calories: 300, avgHr: 150 }] },
    };
  }

  function makeNamedPeriodFactory(playbookByUser, overrides = {}) {
    const weightFixture = overrides.weightFixture ?? buildPeriodWeightFixture();
    const nutritionFixture = overrides.nutritionFixture ?? buildPeriodNutritionFixture();
    const workoutsFixture = overrides.workoutsFixture ?? buildPeriodWorkoutsFixture();

    const healthStore = {
      loadWeightData: vi.fn(async () => weightFixture),
      loadNutritionData: vi.fn(async () => nutritionFixture),
    };
    const healthService = {
      getHealthForRange: vi.fn(async (userId, from, to) => {
        const out = {};
        for (const [date, value] of Object.entries(workoutsFixture)) {
          if (date >= from && date <= to) out[date] = value;
        }
        return out;
      }),
    };
    const personalContextLoader = {
      loadPlaybook: vi.fn(async (userId) => playbookByUser[userId] ?? null),
    };
    return {
      factory: new LongitudinalToolFactory({ healthStore, healthService, personalContextLoader }),
      healthStore,
      healthService,
      personalContextLoader,
    };
  }

  it('tool definition has correct schema', () => {
    const { factory } = makeNamedPeriodFactory({
      'test-user': buildPlaybook({
        'fixture-cut-2024': {
          from: '2024-02-01',
          to: '2024-04-30',
          description: 'Sample cut period.',
        },
      }),
    });
    const tool = getNamedPeriodTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('query_named_period');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');
    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.name).toBeTruthy();
    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId', 'name']));
  });

  it('query_named_period returns aggregated stats for the named period range', async () => {
    const playbook = buildPlaybook({
      'fixture-cut-2024': {
        from: '2024-02-01',
        to: '2024-04-30',
        description: 'Sample cut period for similar-period tests.',
      },
    });
    const { factory, healthService } = makeNamedPeriodFactory({ 'test-user': playbook });
    const tool = getNamedPeriodTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      name: 'fixture-cut-2024',
    });

    // Period metadata
    expect(result.name).toBe('fixture-cut-2024');
    expect(result.from).toBe('2024-02-01');
    expect(result.to).toBe('2024-04-30');
    expect(typeof result.description).toBe('string');
    expect(result.description.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();

    // Weight: weekly_avg aggregation
    expect(result.weight).toBeTruthy();
    expect(result.weight.aggregation).toBe('weekly_avg');
    expect(Array.isArray(result.weight.rows)).toBe(true);
    expect(result.weight.rows.length).toBeGreaterThan(0);
    for (const row of result.weight.rows) {
      expect(row.period).toMatch(/^\d{4}-W\d{2}$/);
      expect(typeof row.lbs).toBe('number');
    }

    // Nutrition: all days inside the period
    expect(result.nutrition).toBeTruthy();
    expect(Array.isArray(result.nutrition.days)).toBe(true);
    // Feb 1 → Apr 30 = 29 + 31 + 30 = 90 days
    expect(result.nutrition.days.length).toBe(90);
    for (const day of result.nutrition.days) {
      expect(day.date >= '2024-02-01').toBe(true);
      expect(day.date <= '2024-04-30').toBe(true);
    }

    // Workouts: all 3 inside the period (the May 15 one is filtered out)
    expect(Array.isArray(result.workouts)).toBe(true);
    expect(result.workouts.length).toBe(3);
    for (const w of result.workouts) {
      expect(w.date >= '2024-02-01').toBe(true);
      expect(w.date <= '2024-04-30').toBe(true);
    }

    // Verify the underlying healthService was called with the period bounds
    expect(healthService.getHealthForRange).toHaveBeenCalledWith(
      'test-user', '2024-02-01', '2024-04-30',
    );
  });

  it('unknown period name returns { error, name } without throwing', async () => {
    const playbook = buildPlaybook({
      'fixture-cut-2024': { from: '2024-02-01', to: '2024-04-30', description: 'cut' },
    });
    const { factory, healthStore, healthService } = makeNamedPeriodFactory({
      'test-user': playbook,
    });
    const tool = getNamedPeriodTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      name: 'does-not-exist',
    });

    expect(result.name).toBe('does-not-exist');
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/not found/i);

    // Should NOT have invoked the underlying queries.
    expect(healthStore.loadWeightData).not.toHaveBeenCalled();
    expect(healthStore.loadNutritionData).not.toHaveBeenCalled();
    expect(healthService.getHealthForRange).not.toHaveBeenCalled();
  });

  it('respects user-namespaced playbook (different userId, different periods)', async () => {
    // user-A has 'cut-A', user-B has 'cut-B'. Each lookup must isolate.
    const playbookByUser = {
      'user-A': buildPlaybook({
        'cut-A': { from: '2024-02-01', to: '2024-02-29', description: 'A cut' },
      }),
      'user-B': buildPlaybook({
        'cut-B': { from: '2024-03-01', to: '2024-03-31', description: 'B cut' },
      }),
    };
    const { factory, personalContextLoader } = makeNamedPeriodFactory(playbookByUser);
    const tool = getNamedPeriodTool(factory);

    const aResult = await tool.execute({ userId: 'user-A', name: 'cut-A' });
    expect(aResult.error).toBeUndefined();
    expect(aResult.from).toBe('2024-02-01');
    expect(aResult.to).toBe('2024-02-29');

    // user-A doesn't have 'cut-B' — even though user-B does.
    const aMiss = await tool.execute({ userId: 'user-A', name: 'cut-B' });
    expect(aMiss.error).toMatch(/not found/i);

    const bResult = await tool.execute({ userId: 'user-B', name: 'cut-B' });
    expect(bResult.error).toBeUndefined();
    expect(bResult.from).toBe('2024-03-01');
    expect(bResult.to).toBe('2024-03-31');

    expect(personalContextLoader.loadPlaybook).toHaveBeenCalledWith('user-A');
    expect(personalContextLoader.loadPlaybook).toHaveBeenCalledWith('user-B');
  });
});

// -------------------------------------------------------------------
// read_notes_file (F-102)
// -------------------------------------------------------------------
//
// Reads markdown from data/users/{userId}/lifelog/archives/notes/*.md
// and YAML from data/users/{userId}/lifelog/archives/scans/*.yml.
// Section extraction by markdown anchor. Per-execution cache.

function getReadNotesTool(factory) {
  return factory.createTools().find(t => t.name === 'read_notes_file');
}

describe('LongitudinalToolFactory.read_notes_file', () => {
  // Build a stub archiveScope whose `assertReadable` is a no-op for valid
  // inputs (anything starting with /fake/data/users/{userId}/lifelog/archives/)
  // and throws for inputs that don't match. This isolates the tool's CALL
  // pattern from the scope's whitelist internals (covered by Task 11 tests).
  function makeReadNotesFactory({
    fileContents = {},
    dataRoot = '/fake/data',
    archiveScopeOverride = null,
  } = {}) {
    const fs = {
      readFile: vi.fn(async (absPath /*, encoding */) => {
        if (absPath in fileContents) return fileContents[absPath];
        const err = new Error(`ENOENT: no such file: ${absPath}`);
        err.code = 'ENOENT';
        throw err;
      }),
    };
    const archiveScope = archiveScopeOverride ?? {
      assertReadable: vi.fn((absPath, userId) => {
        const expectedPrefix = `${dataRoot}/users/${userId}/lifelog/archives/`;
        if (typeof absPath !== 'string' || !absPath.startsWith(expectedPrefix)) {
          throw new Error(`HealthArchiveScope: path not readable for user ${userId}: ${absPath}`);
        }
      }),
    };
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
    };
    return {
      factory: new LongitudinalToolFactory({
        healthStore,
        archiveScope,
        fs,
        dataRoot,
      }),
      fs,
      archiveScope,
    };
  }

  const SAMPLE_MD = [
    '# Title',
    '',
    '## Section A',
    'content A',
    '',
    '## Section B',
    'content B',
    '',
    '### Subsection B1',
    'sub content',
    '',
    '## Section C',
    'content C',
    '',
  ].join('\n');

  const SAMPLE_YAML = [
    'date: 2024-01-15',
    'source: bodyspec_dexa',
    'weight_lbs: 175.0',
    'body_fat_percent: 22.0',
  ].join('\n');

  it('tool definition has correct schema', () => {
    const { factory } = makeReadNotesFactory();
    const tool = getReadNotesTool(factory);

    expect(tool).toBeTruthy();
    expect(tool.name).toBe('read_notes_file');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.parameters?.type).toBe('object');
    const props = tool.parameters?.properties || {};
    expect(props.userId).toBeTruthy();
    expect(props.filename).toBeTruthy();
    expect(props.section).toBeTruthy();
    expect(tool.parameters?.required).toEqual(expect.arrayContaining(['userId', 'filename']));
  });

  it('reads full markdown file from notes/', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/notes/strength-plateau.md';
    const { factory, fs, archiveScope } = makeReadNotesFactory({
      fileContents: { [absPath]: SAMPLE_MD },
    });
    const tool = getReadNotesTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      filename: 'notes/strength-plateau.md',
    });

    expect(result.error).toBeUndefined();
    expect(result.filename).toBe('notes/strength-plateau.md');
    expect(result.content).toBe(SAMPLE_MD);
    expect(archiveScope.assertReadable).toHaveBeenCalledWith(absPath, 'test-user');
    expect(fs.readFile).toHaveBeenCalledWith(absPath, 'utf8');
  });

  it('reads YAML file from scans/', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/scans/2024-01-15-dexa.yml';
    const { factory, fs, archiveScope } = makeReadNotesFactory({
      fileContents: { [absPath]: SAMPLE_YAML },
    });
    const tool = getReadNotesTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      filename: 'scans/2024-01-15-dexa.yml',
    });

    expect(result.error).toBeUndefined();
    expect(result.filename).toBe('scans/2024-01-15-dexa.yml');
    expect(result.content).toBe(SAMPLE_YAML);
    expect(archiveScope.assertReadable).toHaveBeenCalledWith(absPath, 'test-user');
    expect(fs.readFile).toHaveBeenCalledWith(absPath, 'utf8');
  });

  it('reads by markdown section anchor — returns content under heading until next heading at same or higher level', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/notes/strength-plateau.md';
    const { factory } = makeReadNotesFactory({
      fileContents: { [absPath]: SAMPLE_MD },
    });
    const tool = getReadNotesTool(factory);

    // Section A: terminated by ## Section B (same level h2).
    const a = await tool.execute({
      userId: 'test-user',
      filename: 'notes/strength-plateau.md',
      section: 'Section A',
    });
    expect(a.error).toBeUndefined();
    expect(a.section).toBe('Section A');
    expect(a.content.trim()).toBe('content A');

    // Section B: includes its h3 subsection but stops at ## Section C.
    const b = await tool.execute({
      userId: 'test-user',
      filename: 'notes/strength-plateau.md',
      section: 'Section B',
    });
    expect(b.error).toBeUndefined();
    expect(b.section).toBe('Section B');
    expect(b.content).toContain('content B');
    expect(b.content).toContain('### Subsection B1');
    expect(b.content).toContain('sub content');
    expect(b.content).not.toContain('Section C');
    expect(b.content).not.toContain('content C');

    // Missing section returns structured error, not throw.
    const missing = await tool.execute({
      userId: 'test-user',
      filename: 'notes/strength-plateau.md',
      section: 'Nonexistent',
    });
    expect(missing.error).toMatch(/section not found/i);
    expect(missing.section).toBe('Nonexistent');
  });

  it('rejects paths outside notes/ and scans/ subtrees', async () => {
    const { factory } = makeReadNotesFactory();
    const tool = getReadNotesTool(factory);

    // playbook is whitelisted for the SCOPE but not by THIS tool's contract.
    const result = await tool.execute({
      userId: 'test-user',
      filename: 'playbook/named_periods.yml',
    });
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/notes\/|scans\//);
  });

  it('rejects path traversal in filename param', async () => {
    const { factory, archiveScope } = makeReadNotesFactory();
    const tool = getReadNotesTool(factory);

    const result = await tool.execute({
      userId: 'test-user',
      filename: '../../../etc/passwd',
    });
    expect(typeof result.error).toBe('string');
    // Traversal must be caught before any read-scope or fs touch.
    expect(archiveScope.assertReadable).not.toHaveBeenCalled();
  });

  it('uses archiveScopeFactory.forUser(userId) when provided (F4-A)', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/notes/file.md';
    const SAMPLE = '# hello\nbody';
    const fs = {
      readFile: vi.fn(async (p) => {
        if (p === absPath) return SAMPLE;
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }),
    };
    const perUserScope = {
      assertReadable: vi.fn(() => {}),
    };
    const archiveScopeFactory = {
      forUser: vi.fn(async () => perUserScope),
    };
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const factory = new LongitudinalToolFactory({
      healthStore,
      archiveScopeFactory,
      fs,
      dataRoot: '/fake/data',
    });
    const tool = factory.createTools().find(t => t.name === 'read_notes_file');

    const result = await tool.execute({
      userId: 'test-user',
      filename: 'notes/file.md',
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toBe(SAMPLE);
    expect(archiveScopeFactory.forUser).toHaveBeenCalledWith('test-user');
    expect(perUserScope.assertReadable).toHaveBeenCalledWith(absPath, 'test-user');
  });

  it('caches the same filename across calls within a single createTools() call', async () => {
    const absPath = '/fake/data/users/test-user/lifelog/archives/notes/strength-plateau.md';
    const fileContents = { [absPath]: SAMPLE_MD };
    const fs = {
      readFile: vi.fn(async (p) => fileContents[p]),
    };
    const archiveScope = {
      assertReadable: vi.fn(() => {}),
    };
    const healthStore = {
      loadWeightData: vi.fn(async () => ({})),
      loadNutritionData: vi.fn(async () => ({})),
    };
    const factory = new LongitudinalToolFactory({
      healthStore, archiveScope, fs, dataRoot: '/fake/data',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'read_notes_file');

    // First call — reads from disk.
    const r1 = await tool.execute({ userId: 'test-user', filename: 'notes/strength-plateau.md' });
    expect(r1.content).toBe(SAMPLE_MD);
    expect(fs.readFile).toHaveBeenCalledTimes(1);

    // Second call — same filename, no section: cache hit.
    const r2 = await tool.execute({ userId: 'test-user', filename: 'notes/strength-plateau.md' });
    expect(r2.content).toBe(SAMPLE_MD);
    expect(fs.readFile).toHaveBeenCalledTimes(1);

    // Different section — different cache key, but section extraction does NOT
    // need a new disk read if implementation caches the raw file too. The
    // contract here is that fs.readFile should not be called again — section
    // extraction is in-memory.
    const r3 = await tool.execute({
      userId: 'test-user', filename: 'notes/strength-plateau.md', section: 'Section A',
    });
    expect(r3.content.trim()).toBe('content A');
    expect(fs.readFile).toHaveBeenCalledTimes(1);

    // A FRESH createTools() call gets a fresh cache.
    const tools2 = factory.createTools();
    const tool2 = tools2.find(t => t.name === 'read_notes_file');
    await tool2.execute({ userId: 'test-user', filename: 'notes/strength-plateau.md' });
    expect(fs.readFile).toHaveBeenCalledTimes(2);
  });
});
