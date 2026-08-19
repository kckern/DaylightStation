/**
 * scanDispatch — the WIRING test.
 *
 * Phase 1's criterion is ZERO behaviour change, so these tests are written
 * against the five paths `app.mjs` used to hold inline, and they assert the
 * arguments each collaborator receives rather than the outcome the dispatcher
 * returns. An Outcome that reads correctly while `refreshPrompt` was called with
 * the wrong scale is exactly the regression this file exists to catch.
 *
 * Collaborators are fakes, not mocks of the modules under them: `routeNutribotScan`
 * and `parseScanCode` are the REAL implementations, driven through a fake
 * `ApplyScanToComposition`. Stubbing the decision would test the wiring against a
 * copy of the decision instead of the decision itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScanDispatch, SCAN_ROUTE_FALLBACK, errText } from '#composition/modules/scanDispatch.mjs';
import { swallowNotice } from '#apps/nutribot/lib/routeNutribotScan.mjs';

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn(function child() { return this; }),
});

/** Event names a fake logger saw at one level, in order. */
const eventNames = (logger, level) => logger[level].mock.calls.map((c) => c[0]);

/**
 * The dependency bag by itself, WITHOUT constructing anything.
 *
 * `harness` builds this and then calls the factory, which is what every
 * behaviour test below wants. The seam tests want the bag on its own, so they
 * can delete one key from it and watch the factory refuse — see
 * `the composition seam`.
 */
function makeDeps(over = {}) {
  const barcodeLogger = makeLogger();
  const dispatcherLogger = makeLogger();

  const schoolLifecycle = over.schoolLifecycle ?? {
    handlesCode: (code) => typeof code === 'string' && code.startsWith('sch:'),
    handleScan: vi.fn(async () => ({ ok: true })),
  };
  const schoolCalcResultImporter = over.schoolCalcResultImporter ?? {
    execute: vi.fn(async () => ({ status: 'accepted' })),
  };

  const triggerDispatchService = { handleEvent: vi.fn(async () => ({ ok: true })) };
  const refreshPrompt = vi.fn(async () => {});
  const armCommitFor = vi.fn();
  const execute = vi.fn(async () => ({ ok: true }));

  const deps = {
    schoolLifecycle,
    schoolCalcResultImporter,
    triggerDispatchService,
    relayInstances: {
      'content-barcode': { route: 'content' },
      'nutribot-upc': { route: 'nutribot', scale_id: 'kitchen-food-scale' },
      'nutribot-noscale': { route: 'nutribot' },
    },
    relayConfig: {},
    applyScanToComposition: { execute: vi.fn(() => ({ handled: false })) },
    getScaleNutribotBridge: () => ({ refreshPrompt, armCommitFor }),
    getLogFoodFromUPC: () => ({ execute }),
    configService: {
      getSystemConfig: () => ({ nutribot: { telegram: { bot_id: '777' } } }),
      getHeadOfHousehold: () => 'test-user',
    },
    userIdentityService: { resolvePlatformId: () => '4242' },
    screenNames: ['living-room', 'portal', 'office'],
    logger: dispatcherLogger,
    barcodeLogger,
    ...over,
  };

  return { deps, barcodeLogger, dispatcherLogger, refreshPrompt, armCommitFor, execute };
}

function harness(over = {}) {
  const { deps, barcodeLogger, dispatcherLogger, refreshPrompt, armCommitFor, execute } = makeDeps(over);
  return {
    ...deps,
    barcodeLogger,
    dispatcherLogger,
    refreshPrompt,
    armCommitFor,
    execute,
    scanDispatch: createScanDispatch(deps),
  };
}

/** A relay payload exactly as `createBarcodeRelay` builds it. */
const relayScan = (over = {}) => ({
  source: 'barcode-relay',
  device: 'content-barcode',
  route: 'content',
  code: 'office:plex:1',
  ts: '2026-07-28 09:15:00',
  ...over,
});

describe('createScanDispatch — construction', () => {
  it('registers a handler for every namespace its route fallback names', () => {
    const { scanDispatch } = harness();
    for (const namespace of Object.values(SCAN_ROUTE_FALLBACK)) {
      expect(scanDispatch.namespaces).toContain(namespace);
    }
  });

  it('registers all five domains, including the two with no route fallback', () => {
    // `school` and `command` are reachable ONLY through a parsed prefix, so the
    // fallback assertion above cannot see them. Dropping either registration is
    // otherwise a silent `no handler registered for "school"` at the kiosk.
    expect(harness().scanDispatch.namespaces)
      .toEqual(['content', 'command', 'school', 'nutrition', 'product']);
  });

  it('throws when a route falls back to a namespace with no handler', () => {
    // The failure this guards: no parse EVER yields `product`, so a misspelled
    // key here stops UPC food logging house-wide with nothing in the logs.
    expect(() => harness({ routeFallback: { nutribot: 'produce' } }))
      .toThrow(/route "nutribot" falls back to "produce"/);
  });

  it('accepts the production fallback map unchanged', () => {
    expect(SCAN_ROUTE_FALLBACK).toEqual({ nutribot: 'product', content: 'content' });
    expect(() => harness()).not.toThrow();
  });

  it('reports a configured screen whose name shadows a registry prefix', () => {
    // `go:plex:1` for a screen named `go` would resolve as a PREFIXED content
    // code with body `plex:1` — the screen silently dropped.
    const h = harness({ screenNames: ['living-room', 'go'] });
    expect(h.scanDispatch.screenCollisions).toEqual(['go']);
    expect(eventNames(h.barcodeLogger, 'error')).toContain('scan.leading_segment.shadows_tag');
  });

  it('reports a screen named after a LEGACY nutrition tag', () => {
    // The half this commit made dangerous: step 2 is route-independent, so
    // `dl:plex:1` now resolves to nutrition on a CONTENT reader too, where it is
    // swallowed. Before this commit the fridge grammar was consulted only on a
    // nutribot-routed reader and a `dl`-named screen still worked everywhere else.
    const h = harness({ screenNames: ['living-room', 'dl'] });
    expect(h.scanDispatch.screenCollisions).toEqual(['dl']);
    expect(eventNames(h.barcodeLogger, 'error')).toContain('scan.leading_segment.shadows_tag');
  });

  it('covers every tag in both halves of the registry', () => {
    const h = harness({ screenNames: ['go', 'cmd', 'nut', 'sch', 'dl', 'ct', 'rs'] });
    expect(h.scanDispatch.screenCollisions.sort())
      .toEqual(['cmd', 'ct', 'dl', 'go', 'nut', 'rs', 'sch']);
  });

  it('checks COMMAND names too, since a command also leads a legacy code', () => {
    // `volume:30` is `<tag>:<rest>` to the same single split, so the command list
    // is as much a source of leading segments as the screen list.
    const h = harness({ commandNames: ['pause', 'nut'] });
    expect(h.scanDispatch.screenCollisions).toEqual(['nut']);
  });

  it('checks the REAL command list by default, and it is clean today', async () => {
    const { KNOWN_COMMANDS } = await import('#domains/barcode/BarcodeCommandMap.mjs');
    const { PREFIX_REGISTRY, LEGACY_NUTRITION_TAGS } = await import('#domains/scan/ScanCode.mjs');
    const tags = new Set([...Object.keys(PREFIX_REGISTRY), ...LEGACY_NUTRITION_TAGS]);
    expect(KNOWN_COMMANDS.filter((c) => tags.has(c))).toEqual([]);
    // Not injected by app.mjs — the default is the live constant, so a command
    // added later is checked without anyone remembering to wire it. The DEFAULT
    // itself is not observable while the real list is clean (`[]` would look the
    // same); the assertion above is what bites the day it stops being clean, and
    // the injected case below is what proves the union works at all.
    expect(harness().scanDispatch.screenCollisions).toEqual([]);
  });

  it('reports nothing for the screens configured today', () => {
    const h = harness();
    expect(h.scanDispatch.screenCollisions).toEqual([]);
    expect(h.barcodeLogger.error).not.toHaveBeenCalled();
  });

  it('still BOOTS when the logger it reports the collision on is broken', () => {
    // The guard is only as non-fatal as the line that reports it. A bare
    // `logger.error(...)` here turns "the log sink is down" into "the station
    // does not boot" — and does it at STARTUP, which is the one place a throw
    // takes everything else in the house with it.
    const broken = { error: () => { throw new Error('sink closed'); } };
    expect(() => harness({ barcodeLogger: broken, screenNames: ['go'] })).not.toThrow();
    expect(harness({ barcodeLogger: broken, screenNames: ['go'] }).scanDispatch.screenCollisions)
      .toEqual(['go']);
  });
});

describe('createScanDispatch — the composition seam', () => {
  /**
   * THE UNTESTABLE CALL SITE.
   *
   * Every test above drives this factory with its own harness, so all of them
   * pass whatever `app.mjs` does. `app.mjs` is a composition root no unit test
   * can import — nothing in this repository references `createApp`'s barcode
   * wiring — so a deleted or misspelled line in
   * `createScanDispatch({ ..., screenNames: barcodeScreenNames, ... })` is
   * invisible to the whole test tree.
   *
   * The factory therefore checks its OWN inputs and refuses to build, which
   * turns that class of mistake into a boot failure rather than a live gap.
   * These tests are what make that refusal falsifiable. Each one corresponds to
   * a line that could go missing from the call site.
   */
  const REQUIRED = [
    'schoolLifecycle', 'schoolCalcResultImporter', 'triggerDispatchService', 'relayInstances', 'relayConfig',
    'applyScanToComposition', 'getScaleNutribotBridge', 'getLogFoodFromUPC',
    'configService', 'userIdentityService', 'screenNames', 'logger', 'barcodeLogger',
  ];

  const depsWithout = (...keys) => {
    const { deps } = makeDeps();
    for (const key of keys) delete deps[key];
    return deps;
  };
  const depsWith = (over) => makeDeps(over).deps;

  it('builds from the full production-shaped bag', () => {
    expect(() => createScanDispatch(depsWith({}))).not.toThrow();
  });

  it.each(REQUIRED)('refuses to build when `%s` is missing from the call site', (key) => {
    expect(() => createScanDispatch(depsWithout(key)))
      .toThrow(new RegExp(`missing: [^;]*\\b${key}\\b`));
  });

  it('names EVERY missing dependency, not just the first one it meets', () => {
    // One boot, one fix. Reporting only the head of the list turns a two-line
    // deletion into two restarts.
    const call = () => createScanDispatch(depsWithout('screenNames', 'logger'));
    expect(call).toThrow(/screenNames/);
    expect(call).toThrow(/logger/);
  });

  it('refuses an empty call entirely', () => {
    expect(() => createScanDispatch()).toThrow(/scanDispatch: /);
  });

  it('takes an EMPTY screen list as an answer, and its absence as a question', () => {
    // The whole reason `screenNames` is required rather than defaulted: `[]` is
    // a legitimate value (a household with no screens configured) and used to be
    // indistinguishable from a dropped argument. Passing `[]` costs one
    // character and says which one you meant.
    expect(() => createScanDispatch(depsWith({ screenNames: [] }))).not.toThrow();
    expect(() => createScanDispatch(depsWithout('screenNames'))).toThrow(/missing: /);
  });

  it('refuses a screen list that is not an array', () => {
    // A bare string is the shape a one-screen household invites. It has a
    // `length` and iterates, so it reaches the collision check and contributes
    // its CHARACTERS — no tag is one character long, so the guard reports
    // nothing and looks healthy.
    expect(() => createScanDispatch(depsWith({ screenNames: 'living-room' })))
      .toThrow(/malformed: [^;]*screenNames/);
  });

  it('refuses a command list that is not an array', () => {
    expect(() => createScanDispatch(depsWith({ commandNames: 'pause' })))
      .toThrow(/malformed: [^;]*commandNames/);
  });

  it('refuses a misspelled key instead of ignoring it', () => {
    // `relayInstance` (singular) is not required, so the missing-key check alone
    // would let it through: `relayInstances` would silently be `{}`, every
    // reader would lose its `scale_id`, and every fridge scan in the house would
    // be swallowed. The unknown-key check is the only thing that catches a
    // misspelled OPTIONAL argument.
    const deps = depsWithout('relayInstances');
    deps.relayInstance = { 'nutribot-upc': { route: 'nutribot' } };
    const call = () => createScanDispatch(deps);
    expect(call).toThrow(/unknown: [^;]*relayInstance\b/);
    expect(call).toThrow(/missing: [^;]*relayInstances\b/);
  });

  it('accepts the two keys `app.mjs` deliberately does NOT pass', () => {
    // `commandNames` defaults to the live constant and `routeFallback` to the
    // production map. Both are parameters only so a test can drive them.
    expect(() => createScanDispatch(depsWithout('commandNames', 'routeFallback'))).not.toThrow();
    expect(() => createScanDispatch(depsWith({ commandNames: ['pause'] }))).not.toThrow();
    expect(() => createScanDispatch(depsWith({ routeFallback: { content: 'content' } }))).not.toThrow();
  });

  it('accepts null optional product entry points, but not their absence', () => {
    // All three are legitimately null. `null` is a WIRED answer; an absent key
    // is not, because omission at the app.mjs seam is otherwise invisible.
    expect(() => createScanDispatch(depsWith({ schoolLifecycle: null }))).not.toThrow();
    expect(() => createScanDispatch(depsWith({ schoolCalcResultImporter: null }))).not.toThrow();
    expect(() => createScanDispatch(depsWith({ applyScanToComposition: null }))).not.toThrow();
    expect(() => createScanDispatch(depsWithout('schoolLifecycle'))).toThrow(/missing: /);
    expect(() => createScanDispatch(depsWithout('schoolCalcResultImporter'))).toThrow(/missing: /);
    expect(() => createScanDispatch(depsWithout('applyScanToComposition'))).toThrow(/missing: /);
  });

  it('refuses a malformed SchoolCalc result importer at boot', () => {
    expect(() => createScanDispatch(depsWith({ schoolCalcResultImporter: {} })))
      .toThrow(/malformed: [^;]*schoolCalcResultImporter/);
  });

  it('refuses a trigger service that cannot take an event', () => {
    // Content and command are four scans in five. A trigger service with no
    // `handleEvent` fails every one of them at dispatch time instead of at boot.
    expect(() => createScanDispatch(depsWith({ triggerDispatchService: {} })))
      .toThrow(/malformed: [^;]*triggerDispatchService/);
  });

  it('refuses a late-bound getter that is not callable', () => {
    // These two are read at scan time, so a non-function is a TypeError inside a
    // handler — reported as a FAILED scan, attributed to the domain, months of
    // logs away from the line that is actually wrong.
    expect(() => createScanDispatch(depsWith({ getLogFoodFromUPC: { execute() {} } })))
      .toThrow(/malformed: [^;]*getLogFoodFromUPC/);
    expect(() => createScanDispatch(depsWith({ getScaleNutribotBridge: null })))
      .toThrow(/malformed: [^;]*getScaleNutribotBridge/);
  });

  it('refuses a NULL reader map, and tolerates a badly-typed one', () => {
    // `relayInstances[device]` would throw on every scan from `handleScan`,
    // outside the dispatcher's never-reject guard, so null is refused.
    expect(() => createScanDispatch(depsWith({ relayInstances: null })))
      .toThrow(/malformed: [^;]*relayInstances/);
    // Its CONTENT is somebody's YAML. A mistyped `relays:` block leaves every
    // reader without a `scale_id` — bad, and still not worth refusing to boot
    // the house over, which is the call this codebase already made for the
    // nutriscan table.
    expect(() => createScanDispatch(depsWith({ relayInstances: 'nutribot-upc' }))).not.toThrow();
  });

  it('refuses a bag that is not an object at all', () => {
    expect(() => createScanDispatch('screenNames')).toThrow(/scanDispatch: dependencies/);
    expect(() => createScanDispatch(null)).toThrow(/scanDispatch: dependencies/);
  });

  it('checks the bag BEFORE it acts on any of it', () => {
    // Ordering, pinned: the dependency check runs ahead of the route-fallback
    // assertion, so a missing argument is reported as the missing argument
    // rather than as whatever the first consumer of it happens to complain
    // about. Both errors are true here; only one of them is the diagnosis.
    const deps = depsWithout('screenNames');
    deps.routeFallback = { nutribot: 'produce' };
    expect(() => createScanDispatch(deps)).toThrow(/missing: [^;]*screenNames/);
  });

  it('reads only OWN keys, so a dep named after an inherited member is unknown', () => {
    // `'constructor' in DEP_CONTRACT` is true for any object literal, which
    // would make `constructor:` a recognised dependency name. The same
    // prototype hazard `PREFIX_REGISTRY` and `toRouteMap` are hardened against.
    const deps = depsWith({});
    deps.constructor = 'nonsense';
    expect(() => createScanDispatch(deps)).toThrow(/unknown: [^;]*constructor/);
  });

  it('reads OWN keys of the bag, not whatever its prototype carries', () => {
    // The other direction of the same rule. `for...in` walks the chain, so a bag
    // built on a prototype would have that prototype's names reported as unknown
    // dependencies and refuse to boot over something the caller never wrote.
    const bag = Object.assign(Object.create({ inheritedNoise: true }), depsWith({}));
    expect(() => createScanDispatch(bag)).not.toThrow();
  });
});

describe('errText — the shared rejection reader', () => {
  // Every `.catch` in this module, and the one in `app.mjs`'s `onScan`, reads a
  // rejection through this function. It runs INSIDE a catch callback, where a
  // throw is an unhandled rejection nothing can catch.
  it('reads an Error the ordinary way', () => {
    expect(errText(new Error('printer offline'))).toBe('printer offline');
  });

  it('answers a null rejection with an empty string', () => {
    expect(errText(null)).toBe('');
    expect(errText(undefined)).toBe('');
  });

  it('keeps a bare thrown string, which carries no `message` at all', () => {
    expect(errText('nope')).toBe('nope');
  });

  it('stringifies a non-string message', () => {
    expect(errText({ message: 42 })).toBe('42');
  });

  it('survives a value whose `message` getter throws', () => {
    expect(errText({ get message() { throw new Error('hostile'); } })).toBe('');
  });

  it('survives a value that cannot be stringified', () => {
    // A null-prototype object has no `toString`, so `String(err)` throws — after
    // the `?? err` fallback has already chosen it.
    expect(errText(Object.create(null))).toBe('');
  });
});

describe('school — first and route-independent', () => {
  it('routes a SchoolCalc result QR to the common importer and never to the action-token console', async () => {
    const h = harness();
    const out = await h.scanDispatch.handleScan(relayScan({ code: 'sch:r1:ABC234' }));
    await Promise.resolve();
    expect(h.schoolCalcResultImporter.execute).toHaveBeenCalledWith({
      record: 'sch:r1:ABC234', transport: 'qr',
    });
    expect(h.schoolLifecycle.handleScan).not.toHaveBeenCalled();
    expect(out).toMatchObject({ domain: 'school', status: 'dispatched', effect: { transport: 'qr' } });
  });

  it('fails closed when a result QR arrives while SchoolCalc is disabled', async () => {
    const h = harness({ schoolCalcResultImporter: null });
    const out = await h.scanDispatch.handleScan(relayScan({ code: 'sch:r1:ABC234' }));
    expect(out).toMatchObject({ domain: 'school', status: 'unwired', ok: false });
    expect(h.schoolLifecycle.handleScan).not.toHaveBeenCalled();
  });

  it('logs a rejected QR import without creating an unhandled rejection', async () => {
    const schoolCalcResultImporter = {
      execute: vi.fn(async () => { throw new Error('bad result'); }),
    };
    const h = harness({ schoolCalcResultImporter });
    await h.scanDispatch.handleScan(relayScan({ code: 'sch:r1:ABC234' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.barcodeLogger.warn).toHaveBeenCalledWith('barcode_relay.schoolcalc.result.failed', {
      device: 'content-barcode', error: 'bad result',
    });
  });

  it('hands the FULL raw code to the school console on a content reader', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({ code: 'sch:A7F3K2' }));
    expect(h.schoolLifecycle.handleScan).toHaveBeenCalledWith({
      code: 'sch:A7F3K2', device: 'content-barcode',
    });
    expect(h.schoolCalcResultImporter.execute).not.toHaveBeenCalled();
    expect(h.triggerDispatchService.handleEvent).not.toHaveBeenCalled();
  });

  it('does the same on a nutribot reader, and never reaches the UPC lookup', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'sch:A7F3K2',
    }));
    expect(h.schoolLifecycle.handleScan).toHaveBeenCalledWith({
      code: 'sch:A7F3K2', device: 'nutribot-upc',
    });
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.applyScanToComposition.execute).not.toHaveBeenCalled();
  });

  it('logs the school dispatch failure on the barcode channel, and does not reject', async () => {
    const schoolLifecycle = {
      handlesCode: () => true,
      handleScan: vi.fn(async () => { throw new Error('printer offline'); }),
    };
    const h = harness({ schoolLifecycle });
    await h.scanDispatch.handleScan(relayScan({ code: 'sch:A7F3K2' }));
    await Promise.resolve();
    expect(h.barcodeLogger.warn).toHaveBeenCalledWith('barcode_relay.school.dispatch.failed', {
      device: 'content-barcode', error: 'printer offline',
    });
  });

  it('honours a lifecycle that DECLINES a code it was offered', async () => {
    // `handlesCode` is the guard, not the `sch:` prefix — the two agree today
    // (`isSchoolToken` is `startsWith('sch:')`) and this is what keeps them
    // separable if school ever narrows what it claims.
    const handleScan = vi.fn(async () => ({ ok: true }));
    const h = harness({ schoolLifecycle: { handlesCode: () => false, handleScan } });
    const out = await h.scanDispatch.handleScan(relayScan({ code: 'sch:A7F3K2' }));
    expect(handleScan).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
  });

  it('claims nothing when the console is unwired', async () => {
    // `handlesCode: () => true` DELIBERATELY. The real inert lifecycle returns
    // false for both, which lets the first half of the guard short-circuit and
    // makes the `handleScan` half unfalsifiable — the guard would ship green with
    // that check deleted, and then TypeError on the day something returns a
    // handlesCode without a handler.
    const h = harness({ schoolLifecycle: { handlesCode: () => true, handleScan: null } });
    const out = await h.scanDispatch.handleScan(relayScan({ code: 'sch:A7F3K2' }));
    expect(out.ok).toBe(false);
    expect(out.domain).toBe('school');
    expect(out.status).toBe('unwired');
    expect(h.triggerDispatchService.handleEvent).not.toHaveBeenCalled();
  });
});

describe('nutrition — the nutriscan path', () => {
  it('applies a fridge-sheet code to the scale the reader is bound to', async () => {
    const applyScanToComposition = {
      execute: vi.fn(() => ({ handled: true, ok: true, kind: 'density', level: 4 })),
    };
    const h = harness({ applyScanToComposition });
    const out = await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'dl:4',
    }));

    expect(applyScanToComposition.execute).toHaveBeenCalledWith({
      scaleId: 'kitchen-food-scale', code: 'dl:4',
    });
    // ACK on the message the user is already looking at; no notice on success.
    expect(h.refreshPrompt).toHaveBeenCalledWith('kitchen-food-scale', null);
    expect(out).toMatchObject({ domain: 'nutrition', ok: true });
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.barcodeLogger.info).toHaveBeenCalledWith('barcode_relay.nutriscan', {
      device: 'nutribot-upc', scaleId: 'kitchen-food-scale', kind: 'density', ok: true, error: null,
    });
  });

  // The bridge finalises an entry after a LULL in input. A scan arrives on this
  // path and not on the event bus, so unless the clock is restarted from here the
  // entry closes 25s after the last WEIGHT — with a density or tare scanned in
  // the meantime landing on an already-closed log (the 12:31 incident).
  it('restarts the bridge quiet-commit clock for an applied scan', async () => {
    const applyScanToComposition = {
      execute: vi.fn(() => ({ handled: true, ok: true, kind: 'density', level: 4 })),
    };
    const h = harness({ applyScanToComposition });
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'dl:4',
    }));
    expect(h.armCommitFor).toHaveBeenCalledWith('kitchen-food-scale');
  });

  // A refusal restarts it too: the person is mid-gesture and about to rescan.
  // Restarting too eagerly only delays a commit the next lull makes anyway;
  // not restarting closes the entry under the hand still filling it in.
  it('restarts the quiet-commit clock for a refused scan as well', async () => {
    const applyScanToComposition = {
      execute: vi.fn(() => ({
        handled: true, ok: false, kind: 'container', error: 'UNKNOWN_CONTAINER', id: 'teapot',
      })),
    };
    const h = harness({ applyScanToComposition });
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'ct:teapot',
    }));
    expect(h.armCommitFor).toHaveBeenCalledWith('kitchen-food-scale');
  });

  // The bridge is LATE-BOUND and only exists when the head of household and bot
  // id resolve, so an absent one (or an older one without the hook) must leave
  // the scan itself unharmed rather than throwing out of the handler.
  it('survives a bridge that is absent or has no armCommitFor', async () => {
    const applyScanToComposition = {
      execute: vi.fn(() => ({ handled: true, ok: true, kind: 'density', level: 4 })),
    };
    for (const getScaleNutribotBridge of [() => null, () => ({ refreshPrompt: async () => {} })]) {
      const h = harness({ applyScanToComposition, getScaleNutribotBridge });
      const out = await h.scanDispatch.handleScan(relayScan({
        device: 'nutribot-upc', route: 'nutribot', code: 'dl:4',
      }));
      expect(out).toMatchObject({ domain: 'nutrition', ok: true });
    }
  });

  it('strips the `nut:` prefix before handing the body to the fridge grammar', async () => {
    const applyScanToComposition = {
      execute: vi.fn(() => ({ handled: true, ok: true, kind: 'density', level: 4 })),
    };
    const h = harness({ applyScanToComposition });
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'nut:dl:4',
    }));
    expect(applyScanToComposition.execute).toHaveBeenCalledWith({
      scaleId: 'kitchen-food-scale', code: 'dl:4',
    });
  });

  it('carries the refusal reason onto the live prompt', async () => {
    const applyScanToComposition = {
      execute: vi.fn(() => ({
        handled: true, ok: false, kind: 'container', error: 'UNKNOWN_CONTAINER', id: 'teapot',
      })),
    };
    const h = harness({ applyScanToComposition });
    const out = await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'ct:teapot',
    }));

    expect(h.refreshPrompt).toHaveBeenCalledWith(
      'kitchen-food-scale', 'unknown container "teapot" — not tared',
    );
    // `ok` is the ONLY field a generic caller can read — `status` is each
    // domain's private vocabulary — so a refusal that reports `ok: true` is
    // indistinguishable from a success everywhere outside this domain.
    expect(out).toMatchObject({ domain: 'nutrition', ok: false });
    expect(h.barcodeLogger.info).toHaveBeenCalledWith('barcode_relay.nutriscan', {
      device: 'nutribot-upc', scaleId: 'kitchen-food-scale', kind: 'container',
      ok: false, error: 'UNKNOWN_CONTAINER',
    });
    // Claim is not success: a refusal must NOT fall through to a product lookup.
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('refuses a malformed fridge-sheet code instead of looking it up as a product', async () => {
    // BEHAVIOUR DELTA, deliberate and inherited from the dispatcher's
    // claim-is-not-success rule: `dl:99` used to fall through to
    // `getLogFoodFromUPC` because `routeNutribotScan` answers `upc` for anything
    // the grammar cannot read. A namespaced code now dead-ends in its own domain,
    // which is what stops a typo being answered with a nonsense food.
    const applyScanToComposition = { execute: vi.fn(() => ({ handled: false })) };
    const h = harness({ applyScanToComposition });
    const out = await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'dl:99',
    }));

    expect(applyScanToComposition.execute).toHaveBeenCalledWith({
      scaleId: 'kitchen-food-scale', code: 'dl:99',
    });
    expect(h.execute).not.toHaveBeenCalled();
    expect(out).toMatchObject({ domain: 'nutrition', ok: false });
  });

  it('never downgrades a repeated swallow to debug', async () => {
    // `makeLogger` gives this fake no `sampled` method, so `emitSampled` falls
    // back to `warn` — the same defensive shape `emit` already uses for a
    // logger missing a level. Every repeat lands there too, not on `debug`:
    // `debug` is never shipped to the log store, so demoting repeats to it
    // was deletion, not suppression. See `emitSampled`'s docstring.
    const h = harness();
    const scan = relayScan({ device: 'nutribot-noscale', route: 'nutribot', code: 'dl:4' });
    const first = await h.scanDispatch.handleScan(scan);
    await h.scanDispatch.handleScan(scan);
    await h.scanDispatch.handleScan(scan);

    // A swallowed scan did NOT do what it was for, whatever `status` calls it.
    expect(first).toMatchObject({ domain: 'nutrition', ok: false });

    const warns = h.barcodeLogger.warn.mock.calls
      .filter((c) => c[0] === 'barcode_relay.nutriscan.no_scale_id');
    const debugs = h.barcodeLogger.debug.mock.calls
      .filter((c) => c[0] === 'barcode_relay.nutriscan.no_scale_id');
    expect(warns).toHaveLength(3);
    expect(debugs).toHaveLength(0);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('ACKs a swallowed fridge code on the live prompt, not just in the logs', async () => {
    // THE test the design names as the one that would have caught the silent
    // failure: a correct `swallowNotice` builder that nobody calls fixes
    // nothing. This drives the swallow branch and asserts `refreshPrompt` was
    // actually invoked, pinned to the SAME builder rather than a duplicated
    // literal, so the wiring and the notice text can't drift apart unnoticed.
    const h = harness({ applyScanToComposition: null });
    const out = await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'dl:140',
    }));

    expect(h.refreshPrompt).toHaveBeenCalledTimes(1);
    expect(h.refreshPrompt).toHaveBeenCalledWith(
      'kitchen-food-scale', swallowNotice('nutriscan-disabled'),
    );
    const [, notice] = h.refreshPrompt.mock.calls[0];
    expect(notice).toEqual(expect.any(String));
    expect(notice.length).toBeGreaterThan(0);
    expect(out).toMatchObject({ domain: 'nutrition', ok: false });
  });

  it('does not let a rejected prompt edit turn a silent refusal into a thrown one', async () => {
    // Pins the fire-and-forget `.catch` on the swallow branch's ACK — the same
    // shape the nutriscan branch already relies on. A `refreshPrompt` that
    // rejects (Telegram down, bad chat id, whatever) must not surface as a
    // rejected `handleScan`, and the swallow outcome must still come back
    // exactly as if the ACK had never been attempted.
    const refreshPrompt = vi.fn(() => Promise.reject(new Error('telegram down')));
    const h = harness({
      applyScanToComposition: null,
      getScaleNutribotBridge: () => ({ refreshPrompt }),
    });
    const scan = relayScan({ device: 'nutribot-upc', route: 'nutribot', code: 'dl:140' });

    let out;
    await expect((async () => { out = await h.scanDispatch.handleScan(scan); })()).resolves.toBeUndefined();
    await Promise.resolve();

    expect(refreshPrompt).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ domain: 'nutrition', status: 'swallowed', ok: false });
  });

  it('ACKs a successful nutriscan exactly once, never twice through the swallow path', async () => {
    // The nutriscan and swallow branches are mutually exclusive `if`s that both
    // `return`, so a single scan can only ever ACK once — this pins that
    // invariant explicitly rather than leaving it implicit in the branch shape.
    const applyScanToComposition = {
      execute: vi.fn(() => ({ handled: true, ok: true, kind: 'density', level: 4 })),
    };
    const h = harness({ applyScanToComposition });
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'dl:4',
    }));
    expect(h.refreshPrompt).toHaveBeenCalledTimes(1);
    expect(h.refreshPrompt).toHaveBeenCalledWith('kitchen-food-scale', null);
  });

  it('keeps the warn-once memory per dispatch instance, keyed by reason', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-noscale', route: 'nutribot', code: 'dl:4',
    }));
    // A DIFFERENT reason still gets its own first warning.
    const h2 = harness({ applyScanToComposition: null });
    await h2.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'dl:4',
    }));
    expect(eventNames(h2.barcodeLogger, 'warn')).toContain('barcode_relay.nutriscan.config_disabled');
  });
});

describe('product — the UPC path', () => {
  const upcScan = () => relayScan({ device: 'nutribot-upc', route: 'nutribot', code: '041260010682' });

  it('logs a bare UPC through the nutribot use case', async () => {
    const resolvePlatformId = vi.fn(() => '4242');
    const h = harness({ userIdentityService: { resolvePlatformId } });
    await h.scanDispatch.handleScan(upcScan());
    expect(h.execute).toHaveBeenCalledWith({
      userId: 'test-user',
      conversationId: 'telegram:b777_c4242',
      upc: '041260010682',
      messageId: null,
    });
    // The PLATFORM argument, pinned. The comment above this derivation records a
    // production outage — a conversation id that reached UPCGateway and then died
    // at delivery — and resolving the wrong platform's id rebuilds it exactly:
    // well-formed, wrong, and silent until Telegram rejects it.
    expect(resolvePlatformId).toHaveBeenCalledWith('telegram', 'test-user');
  });

  it('prefers the relay instance user over the relay-wide one over the household head', async () => {
    const relayInstances = {
      'nutribot-upc': { route: 'nutribot', nutribot: { user_id: 'per-relay' } },
    };
    const h = harness({ relayInstances, relayConfig: { nutribot: { user_id: 'relay-wide' } } });
    await h.scanDispatch.handleScan(upcScan());
    expect(h.execute.mock.calls[0][0].userId).toBe('per-relay');

    const h2 = harness({
      relayInstances: { 'nutribot-upc': { route: 'nutribot' } },
      relayConfig: { nutribot: { user_id: 'relay-wide' } },
    });
    await h2.scanDispatch.handleScan(upcScan());
    expect(h2.execute.mock.calls[0][0].userId).toBe('relay-wide');
  });

  it('prefers a configured conversation id over the derived one', async () => {
    const h = harness({
      relayConfig: { nutribot: { conversation_id: 'telegram:b1_c2' } },
      relayInstances: { 'nutribot-upc': { route: 'nutribot' } },
    });
    await h.scanDispatch.handleScan(upcScan());
    expect(h.execute.mock.calls[0][0].conversationId).toBe('telegram:b1_c2');
  });

  it('refuses to dispatch without a user', async () => {
    const h = harness({
      configService: { getSystemConfig: () => ({}), getHeadOfHousehold: () => null },
      relayInstances: { 'nutribot-upc': { route: 'nutribot' } },
    });
    await h.scanDispatch.handleScan(upcScan());
    expect(h.execute).not.toHaveBeenCalled();
    expect(eventNames(h.barcodeLogger, 'warn')).toContain('barcode_relay.nutribot.no_user');
  });

  it('refuses to dispatch without a conversation the adapter can parse', async () => {
    // The old fallback built `nutribot-upc:<userId>`, which reached UPCGateway and
    // then died at delivery with a 400. No address is better than a bad one.
    const h = harness({
      configService: { getSystemConfig: () => ({}), getHeadOfHousehold: () => 'test-user' },
      relayInstances: { 'nutribot-upc': { route: 'nutribot' } },
    });
    await h.scanDispatch.handleScan(upcScan());
    expect(h.execute).not.toHaveBeenCalled();
    expect(eventNames(h.barcodeLogger, 'warn')).toContain('barcode_relay.nutribot.no_conversation');
  });

  it('reports a rejected UPC dispatch without rejecting the scan', async () => {
    const h = harness({ getLogFoodFromUPC: () => ({ execute: async () => { throw new Error('gateway down'); } }) });
    await h.scanDispatch.handleScan(upcScan());
    await Promise.resolve();
    expect(h.barcodeLogger.warn).toHaveBeenCalledWith('barcode_relay.nutribot.dispatch.failed', {
      device: 'nutribot-upc', error: 'gateway down',
    });
  });

  it('does not reach the fridge grammar for a digit-only code', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(upcScan());
    expect(h.applyScanToComposition.execute).not.toHaveBeenCalled();
  });
});

describe('content and command — one shared trigger handler', () => {
  it('builds the TriggerEvent the relay used to build inline', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan());
    const [event] = h.triggerDispatchService.handleEvent.mock.calls[0];
    expect(event.source).toBe('barcode');
    expect(event.location).toBe('content-barcode');
    expect(event.value).toBe('office:plex:1');
    expect(event.meta).toEqual({
      device: 'content-barcode', timestamp: '2026-07-28 09:15:00', transport: 'ws', route: 'content',
    });
  });

  it('passes the BODY, so `go:` and the legacy positional form behave identically', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({ code: 'go:office:plex:1' }));
    expect(h.triggerDispatchService.handleEvent.mock.calls[0][0].value).toBe('office:plex:1');
  });

  it('sends a `cmd:` code through the same handler', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({ code: 'cmd:volume:30' }));
    const [event] = h.triggerDispatchService.handleEvent.mock.calls[0];
    expect(event.value).toBe('volume:30');
    expect(h.triggerDispatchService.handleEvent).toHaveBeenCalledTimes(1);
  });

  it('trims the interior space `go: ` leaves behind', async () => {
    // Untrimmed, BarcodePayload turns that space into a COLON and resolves an
    // EMPTY screen with `living-room` read as the action — wrong, and silent.
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({ code: 'go: living-room:plex:1' }));
    expect(h.triggerDispatchService.handleEvent.mock.calls[0][0].value).toBe('living-room:plex:1');
  });

  it('reports a rejected trigger dispatch without rejecting the scan', async () => {
    const h = harness({
      triggerDispatchService: { handleEvent: async () => { throw new Error('no such screen'); } },
    });
    await h.scanDispatch.handleScan(relayScan());
    await Promise.resolve();
    expect(h.barcodeLogger.warn).toHaveBeenCalledWith('trigger.ingress.barcode.dispatch.failed', {
      error: 'no such screen',
    });
  });
});

describe('the reader route — step 5', () => {
  it('sends an unclaimed code on a content reader to the trigger pipeline', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({ code: 'gibberish' }));
    expect(h.triggerDispatchService.handleEvent.mock.calls[0][0].value).toBe('gibberish');
  });

  it('sends a content code on a NUTRIBOT reader to content, not to a UPC lookup', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'go:living-room:plex:594036+shuffle',
    }));
    const [event] = h.triggerDispatchService.handleEvent.mock.calls[0];
    expect(event.value).toBe('living-room:plex:594036+shuffle');
    // The READER's route still rides along in the meta, unchanged — a namespace
    // outranks it for resolution, it is not erased by it.
    expect(event.meta.route).toBe('nutribot');
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('falls back to the reader config, then to content, when the payload omits a route', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: undefined, code: '041260010682',
    }));
    // The relay config says nutribot, so the UPC still reaches the food log.
    expect(h.execute).toHaveBeenCalledTimes(1);

    const h2 = harness();
    await h2.scanDispatch.handleScan(relayScan({ device: 'unknown-reader', route: undefined }));
    const [event] = h2.triggerDispatchService.handleEvent.mock.calls[0];
    expect(event.meta.route).toBe('content');
  });
});

describe('the never-reject invariant, at the wiring layer', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('resolves for every branch, including a code nobody claims', async () => {
    const h = harness();
    const outcomes = await Promise.all([
      h.scanDispatch.handleScan(relayScan({ code: 'sch:A7F3K2' })),
      h.scanDispatch.handleScan(relayScan({ code: 'dl:4', device: 'nutribot-upc', route: 'nutribot' })),
      h.scanDispatch.handleScan(relayScan({ code: '041260010682', device: 'nutribot-upc', route: 'nutribot' })),
      h.scanDispatch.handleScan(relayScan()),
      // An ISBN has no handler in Phase 1, and a bad route has no fallback.
      h.scanDispatch.handleScan(relayScan({ code: '9780306406157' })),
      h.scanDispatch.handleScan(relayScan({ code: '', route: 'unwired' })),
    ]);
    for (const out of outcomes) expect(out).toHaveProperty('ok');
  });

  it('answers a scan even when the dispatcher logger is broken', async () => {
    const broken = {
      debug: () => { throw new Error('sink closed'); },
      info: () => { throw new Error('sink closed'); },
      warn: () => { throw new Error('sink closed'); },
      error: () => { throw new Error('sink closed'); },
    };
    const h = harness({ logger: broken });
    await expect(h.scanDispatch.handleScan(relayScan())).resolves.toHaveProperty('domain', 'content');
  });

  it('reports a collaborator that rejects with a NON-error, without taking the process down', async () => {
    // `err.message` on `Promise.reject(null)` throws INSIDE the catch callback,
    // where nothing catches it — it surfaces as a process-level
    // unhandledRejection. A reporting path that can kill the process is not
    // compatible with a never-reject invariant.
    const seen = [];
    const onRejection = (err) => seen.push(err);
    process.on('unhandledRejection', onRejection);
    try {
      const h = harness({
        triggerDispatchService: { handleEvent: () => Promise.reject(null) },
        schoolLifecycle: { handlesCode: () => true, handleScan: () => Promise.reject(null) },
        getLogFoodFromUPC: () => ({ execute: () => Promise.reject(null) }),
      });
      await h.scanDispatch.handleScan(relayScan());
      await h.scanDispatch.handleScan(relayScan({ code: 'sch:A7F3K2' }));
      await h.scanDispatch.handleScan(relayScan({
        device: 'nutribot-upc', route: 'nutribot', code: '041260010682',
      }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(seen).toEqual([]);
      expect(h.barcodeLogger.warn).toHaveBeenCalledWith(
        'trigger.ingress.barcode.dispatch.failed', { error: '' },
      );
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('survives a relay payload with no device at all', async () => {
    // `TriggerEvent.create` THROWS on a missing location. The dispatcher's guard
    // covers it because the event is built INSIDE the handler.
    const h = harness();
    await expect(h.scanDispatch.handleScan({ code: 'office:plex:1', route: 'content' }))
      .resolves.toMatchObject({ status: 'failed', ok: false, domain: 'content' });
  });
});
