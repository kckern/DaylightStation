import { describe, it, expect } from '@jest/globals';
import { NewsReporterService } from '#apps/newsreporter/NewsReporterService.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

/* ---------- fakes ---------- */

const captureLogger = () => {
  const events = [];
  const mk = () => ({
    events,
    info: (e, d) => events.push({ e, d }),
    debug: (e, d) => events.push({ e, d }),
    warn: (e, d) => events.push({ e, d }),
    error: (e, d) => events.push({ e, d }),
    child: () => mk(),
  });
  const root = mk();
  root.events = events;
  return root;
};

const fixedClock = (iso) => ({ now: () => new Date(iso) });

// configService returning a fixed reporter config map.
const fakeConfig = (map, household = {}) => ({
  getHouseholdAppConfig: (hid, app) => {
    if (app === 'newsreporter') return map;
    if (app === 'household') return household;
    return undefined;
  },
});

// source registry: create() returns a source built from a per-type factory.
const fakeSourceRegistry = (factory) => ({
  created: [],
  create(type, cfg) {
    const src = factory(type, cfg);
    this.created.push({ type, cfg });
    return src;
  },
});

const fakeSinkRegistry = (factory) => ({
  created: [],
  create(type, cfg) {
    const sink = factory(type, cfg);
    this.created.push({ type, cfg });
    return sink;
  },
});

const fakeHistory = () => {
  const records = [];
  return { records, record: async (reporterId, runResult) => { records.push({ reporterId, runResult }); } };
};

const okConsolidator = (sections) => ({
  calls: [],
  consolidate: async function (args) { this.calls.push(args); return { sections }; },
});

const CFG_BASE = {
  enabled: true,
  consolidate: { prompt: 'P', model: 'm' },
  sources: [{ type: 'http', id: 'matches', url: 'http://x?d={{yesterday}}' }],
  sinks: [{ type: 'printer', printer: 'upstairs', template: { header: 'H' } }],
};

const baseDeps = (overrides = {}) => ({
  configService: fakeConfig({ rep: CFG_BASE }),
  sourceRegistry: fakeSourceRegistry(() => ({ gather: async () => ({ items: [{ a: 1 }], meta: {} }) })),
  consolidator: okConsolidator([{ type: 'heading', text: 'Scores' }]),
  sinkRegistry: fakeSinkRegistry(() => ({ emit: async () => ({ status: 'ok' }) })),
  history: fakeHistory(),
  logger: captureLogger(),
  clock: fixedClock('2026-06-21T13:50:00.000Z'),
  ...overrides,
});

/* ---------- tests ---------- */

describe('NewsReporterService', () => {
  it('throws EntityNotFoundError for an unknown reporter id', async () => {
    const svc = new NewsReporterService(baseDeps());
    await expect(svc.run('nope')).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('throws EntityNotFoundError when the reporter is disabled', async () => {
    const deps = baseDeps({ configService: fakeConfig({ rep: { ...CFG_BASE, enabled: false } }) });
    const svc = new NewsReporterService(deps);
    await expect(svc.run('rep')).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('normal run → ok, calls sink.emit once, records ok history', async () => {
    const emits = [];
    const deps = baseDeps({
      sinkRegistry: fakeSinkRegistry(() => ({ emit: async (s, c, ctx) => { emits.push({ s, c, ctx }); return { status: 'ok' }; } })),
    });
    const svc = new NewsReporterService(deps);
    const result = await svc.run('rep');
    expect(result.status).toBe('ok');
    expect(emits).toHaveLength(1);
    expect(deps.history.records).toHaveLength(1);
    expect(deps.history.records[0].runResult.status).toBe('ok');
    expect(deps.consolidator.calls).toHaveLength(1);
  });

  it('all sources empty → empty, consolidator NOT called, no sink.emit', async () => {
    const emits = [];
    const consolidator = okConsolidator([{ type: 'heading', text: 'X' }]);
    const deps = baseDeps({
      sourceRegistry: fakeSourceRegistry(() => ({ gather: async () => ({ items: [], meta: {} }) })),
      consolidator,
      sinkRegistry: fakeSinkRegistry(() => ({ emit: async () => { emits.push(1); return { status: 'ok' }; } })),
    });
    const svc = new NewsReporterService(deps);
    const result = await svc.run('rep');
    expect(result.status).toBe('empty');
    expect(consolidator.calls).toHaveLength(0);
    expect(emits).toHaveLength(0);
    expect(deps.history.records[0].runResult.status).toBe('empty');
  });

  it('a source that throws → error, no emit, records error', async () => {
    const emits = [];
    const deps = baseDeps({
      sourceRegistry: fakeSourceRegistry(() => ({ gather: async () => { throw new Error('fetch boom'); } })),
      sinkRegistry: fakeSinkRegistry(() => ({ emit: async () => { emits.push(1); return { status: 'ok' }; } })),
    });
    const svc = new NewsReporterService(deps);
    const result = await svc.run('rep');
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
    expect(emits).toHaveLength(0);
    expect(deps.history.records[0].runResult.status).toBe('error');
  });

  it('consolidator returning empty sections → empty', async () => {
    const deps = baseDeps({ consolidator: okConsolidator([]) });
    const svc = new NewsReporterService(deps);
    const result = await svc.run('rep');
    expect(result.status).toBe('empty');
  });

  it('one sink throws + one ok → ok, both attempted', async () => {
    let i = 0;
    const attempts = [];
    const deps = baseDeps({
      configService: fakeConfig({
        rep: { ...CFG_BASE, sinks: [
          { type: 'printer', printer: 'a' },
          { type: 'printer', printer: 'b' },
        ] },
      }),
      sinkRegistry: fakeSinkRegistry(() => {
        const idx = i++;
        return { emit: async () => { attempts.push(idx); if (idx === 0) throw new Error('printer down'); return { status: 'ok' }; } };
      }),
    });
    const svc = new NewsReporterService(deps);
    const result = await svc.run('rep');
    expect(result.status).toBe('ok');
    expect(attempts).toEqual([0, 1]);
    expect(result.sinkResults).toHaveLength(2);
    expect(result.sinkResults[0].status).toBe('error');
    expect(result.sinkResults[1].status).toBe('ok');
  });

  it('all sinks throw → error', async () => {
    const deps = baseDeps({
      sinkRegistry: fakeSinkRegistry(() => ({ emit: async () => { throw new Error('down'); } })),
    });
    const svc = new NewsReporterService(deps);
    const result = await svc.run('rep');
    expect(result.status).toBe('error');
  });

  it('dryRun → returns sections + preview, sink receives ctx.dryRun true', async () => {
    let receivedCtx = null;
    const deps = baseDeps({
      sinkRegistry: fakeSinkRegistry(() => ({
        emit: async (s, c, ctx) => { receivedCtx = ctx; return { status: 'ok', detail: { preview: 'PREVIEW_TEXT' } }; },
      })),
    });
    const svc = new NewsReporterService(deps);
    const result = await svc.run('rep', { dryRun: true });
    expect(receivedCtx.dryRun).toBe(true);
    expect(result.sections).toEqual([{ type: 'heading', text: 'Scores' }]);
    expect(result.preview).toBe('PREVIEW_TEXT');
  });

  it('overrides.date → ctx.referenceDate resolves placeholders against that day', async () => {
    let gatheredCfg = null;
    const deps = baseDeps({
      sourceRegistry: fakeSourceRegistry((type, cfg) => ({
        gather: async ({ config }) => { gatheredCfg = config; return { items: [{ a: 1 }], meta: {} }; },
      })),
    });
    const svc = new NewsReporterService(deps);
    // date override 2026-06-20 → {{yesterday}} = 2026-06-19
    await svc.run('rep', { date: '2026-06-20' });
    expect(gatheredCfg.url).toBe('http://x?d=2026-06-19');
  });

  it('force bypasses empty-skip and runs consolidate + emit even when sources empty', async () => {
    const consolidator = okConsolidator([{ type: 'heading', text: 'X' }]);
    const emits = [];
    const deps = baseDeps({
      sourceRegistry: fakeSourceRegistry(() => ({ gather: async () => ({ items: [], meta: {} }) })),
      consolidator,
      sinkRegistry: fakeSinkRegistry(() => ({ emit: async () => { emits.push(1); return { status: 'ok' }; } })),
    });
    const svc = new NewsReporterService(deps);
    const result = await svc.run('rep', { force: true });
    expect(result.status).toBe('ok');
    expect(consolidator.calls).toHaveLength(1);
    expect(emits).toHaveLength(1);
  });
});
