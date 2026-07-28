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
import { createScanDispatch, SCAN_ROUTE_FALLBACK } from '#composition/modules/scanDispatch.mjs';

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn(function child() { return this; }),
});

/** Event names a fake logger saw at one level, in order. */
const eventNames = (logger, level) => logger[level].mock.calls.map((c) => c[0]);

function harness(over = {}) {
  const barcodeLogger = makeLogger();
  const dispatcherLogger = makeLogger();

  const schoolLifecycle = over.schoolLifecycle ?? {
    handlesCode: (code) => typeof code === 'string' && code.startsWith('sch:'),
    handleScan: vi.fn(async () => ({ ok: true })),
  };

  const triggerDispatchService = { handleEvent: vi.fn(async () => ({ ok: true })) };
  const refreshPrompt = vi.fn(async () => {});
  const execute = vi.fn(async () => ({ ok: true }));

  const deps = {
    schoolLifecycle,
    triggerDispatchService,
    relayInstances: {
      'content-barcode': { route: 'content' },
      'nutribot-upc': { route: 'nutribot', scale_id: 'kitchen-food-scale' },
      'nutribot-noscale': { route: 'nutribot' },
    },
    relayConfig: {},
    applyScanToComposition: { execute: vi.fn(() => ({ handled: false })) },
    getScaleNutribotBridge: () => ({ refreshPrompt }),
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

  return {
    ...deps,
    barcodeLogger,
    dispatcherLogger,
    refreshPrompt,
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
    expect(eventNames(h.barcodeLogger, 'error')).toContain('scan.screen_name.shadows_prefix');
  });

  it('reports nothing for the screens configured today', () => {
    const h = harness();
    expect(h.scanDispatch.screenCollisions).toEqual([]);
    expect(h.barcodeLogger.error).not.toHaveBeenCalled();
  });
});

describe('school — first and route-independent', () => {
  it('hands the FULL raw code to the school console on a content reader', async () => {
    const h = harness();
    await h.scanDispatch.handleScan(relayScan({ code: 'sch:A7F3K2' }));
    expect(h.schoolLifecycle.handleScan).toHaveBeenCalledWith({
      code: 'sch:A7F3K2', device: 'content-barcode',
    });
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
    const h = harness({ schoolLifecycle: { handlesCode: () => false, handleScan: null } });
    const out = await h.scanDispatch.handleScan(relayScan({ code: 'sch:A7F3K2' }));
    expect(out.ok).toBe(false);
    expect(out.domain).toBe('school');
    expect(h.triggerDispatchService.handleEvent).not.toHaveBeenCalled();
  });
});

describe('nutrition — the nutriscan path', () => {
  it('applies a fridge-sheet code to the scale the reader is bound to', async () => {
    const applyScanToComposition = {
      execute: vi.fn(() => ({ handled: true, ok: true, kind: 'density', level: 4 })),
    };
    const h = harness({ applyScanToComposition });
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'dl:4',
    }));

    expect(applyScanToComposition.execute).toHaveBeenCalledWith({
      scaleId: 'kitchen-food-scale', code: 'dl:4',
    });
    // ACK on the message the user is already looking at; no notice on success.
    expect(h.refreshPrompt).toHaveBeenCalledWith('kitchen-food-scale', null);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.barcodeLogger.info).toHaveBeenCalledWith('barcode_relay.nutriscan', {
      device: 'nutribot-upc', scaleId: 'kitchen-food-scale', kind: 'density', ok: true, error: null,
    });
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
    await h.scanDispatch.handleScan(relayScan({
      device: 'nutribot-upc', route: 'nutribot', code: 'ct:teapot',
    }));

    expect(h.refreshPrompt).toHaveBeenCalledWith(
      'kitchen-food-scale', 'unknown container "teapot" — not tared',
    );
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

  it('warns ONCE per swallow reason and demotes every repeat to debug', async () => {
    const h = harness();
    const scan = relayScan({ device: 'nutribot-noscale', route: 'nutribot', code: 'dl:4' });
    await h.scanDispatch.handleScan(scan);
    await h.scanDispatch.handleScan(scan);
    await h.scanDispatch.handleScan(scan);

    const warns = h.barcodeLogger.warn.mock.calls
      .filter((c) => c[0] === 'barcode_relay.nutriscan.no_scale_id');
    const debugs = h.barcodeLogger.debug.mock.calls
      .filter((c) => c[0] === 'barcode_relay.nutriscan.no_scale_id');
    expect(warns).toHaveLength(1);
    expect(warns[0][1]).toMatchObject({ hint: 'further occurrences log at debug' });
    expect(debugs).toHaveLength(2);
    expect(h.execute).not.toHaveBeenCalled();
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
    const h = harness();
    await h.scanDispatch.handleScan(upcScan());
    expect(h.execute).toHaveBeenCalledWith({
      userId: 'test-user',
      conversationId: 'telegram:b777_c4242',
      upc: '041260010682',
      messageId: null,
    });
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

  it('survives a relay payload with no device at all', async () => {
    // `TriggerEvent.create` THROWS on a missing location. The dispatcher's guard
    // covers it because the event is built INSIDE the handler.
    const h = harness();
    await expect(h.scanDispatch.handleScan({ code: 'office:plex:1', route: 'content' }))
      .resolves.toMatchObject({ status: 'failed', ok: false, domain: 'content' });
  });
});
