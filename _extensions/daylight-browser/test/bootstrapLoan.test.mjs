import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bootstrapLoan, captureInitialPlaybackWindow, readBookMap } from '../src/operations/libby/bootstrapLoan.mjs';
import { validateInput, allowsRequest, installPolicy } from '../src/operations/libby/securityPolicy.mjs';
import { createBrowserPool } from '../src/browserPool.mjs';

const input = { webUrl: 'https://dewey-fixture.listen.libbyapp.com/book/', message: 'm=a%2Bb&x=1', operationId: 'op-1' };
const book = () => ({ title: 'Fixture book', subtitle: 'Subtitle', creator: [{ role: 'author', name: 'Author' }, { role: 'narrator', name: 'Reader' }], spine: [
  { path: 'a.mp3?signature=private', 'media-type': 'audio/mpeg', 'audio-duration': 10.5, '-odread-file-bytes': 100, '-odread-original-path': '{PART-A}Part01.mp3' },
  { path: 'b.mp3', 'media-type': 'audio/mpeg', 'audio-duration': 20, '-odread-file-bytes': 200 },
] });

function initialWindowFixture({ totals = [100, 200], delays = [0, 5], response = {}, failCdpMethod,
  failPageClose = false, requestDuringPageClose = false, onClick } = {}) {
  const state = { route: null, clicked: [], continued: [], aborted: [], probes: [], cancels: 0,
    requestListeners: new Set(), listenerRemovals: 0, cdpEvents: new Map(), cdpRequests: new Map(),
    cdpCommands: [], cdpEnabled: false, cdpDisabled: false, cdpDetached: false, pageCloses: 0,
    order: [], pausedRequestIds: new Set(), cdpDeliveries: [], networkEscapes: 0 };
  const page = {
    close: async () => {
      state.order.push('page.close');
      state.pageCloses += 1;
      if (requestDuringPageClose) await emitPaused('during-close', 'https://foreign.invalid/during-close.mp3', 'Media');
      if (failPageClose) throw new Error('private close failure');
      state.pausedRequestIds.clear();
    },
    on(event, handler) { if (event === 'request') state.requestListeners.add(handler); },
    off(event, handler) { if (event === 'request' && state.requestListeners.delete(handler)) state.listenerRemovals += 1; },
    getByRole(role, { name } = {}) {
      if (role !== 'button') throw new Error('unexpected role');
      const controls = [{
        isVisible: async () => true, isEnabled: async () => true,
        click: async () => {
          state.clicked.push(String(name));
          if (onClick) return onClick();
          await emitPaused('shell-0', 'https://dewey-fixture.listen.libbyapp.com/official/0?cmpt=opaque', 'Media');
          totals.forEach((_, index) => setTimeout(() => emitPaused(`cdn-${index}`, `https://audioclips.cdn.overdrive.com/signed/${index}`, 'Media'), delays[index]));
        },
      }];
      return { all: async () => controls, first: () => controls[0] };
    },
  };
  const context = {
    route: async (_glob, handler) => { state.route = handler; },
    unroute: async () => { throw new Error('media phase must retain context route'); },
    newCDPSession: async () => ({
      on: (event, handler) => state.cdpEvents.set(event, handler),
      off: (event, handler) => { if (state.cdpEvents.get(event) === handler) state.cdpEvents.delete(event); },
      send: async (method, params = {}) => {
        state.order.push(method);
        state.cdpCommands.push({ method, params });
        if (method === failCdpMethod) throw new Error('private CDP failure');
        if (method === 'Fetch.enable') {
          state.cdpEnabled = true;
          state.cdpPatterns = params.patterns;
        }
        if (method === 'Fetch.disable') {
          state.cdpDisabled = true;
          state.networkEscapes += state.pausedRequestIds.size;
          state.pausedRequestIds.clear();
        }
        const request = state.cdpRequests.get(params.requestId);
        if (method === 'Fetch.continueRequest' && request) { state.continued.push(request.url); state.pausedRequestIds.delete(params.requestId); }
        if (method === 'Fetch.failRequest' && request) { state.aborted.push(request.url); state.pausedRequestIds.delete(params.requestId); }
      },
      detach: async () => { state.order.push('cdp.detach'); state.cdpDetached = true; },
    }),
  };
  async function emit(url, resourceType) {
    await state.route({ request: () => ({ url: () => url, method: () => 'GET', resourceType: () => resourceType }),
      continue: async () => { state.continued.push(url); }, abort: async () => { state.aborted.push(url); } });
  }
  function emitRequest(url, resourceType, method = 'GET') {
    const request = { url: () => url, method: () => method, resourceType: () => resourceType };
    for (const handler of state.requestListeners) handler(request);
  }
  async function emitPaused(requestId, url, resourceType = 'Media', method = 'GET') {
    const intercepted = state.cdpPatterns?.some(pattern => (!pattern.resourceType || pattern.resourceType === resourceType));
    if (!intercepted) return;
    const handler = state.cdpEvents.get('Fetch.requestPaused');
    if (!handler) return;
    const event = { requestId, request: { url, method }, resourceType };
    state.cdpDeliveries.push(event);
    state.cdpRequests.set(requestId, event.request);
    state.pausedRequestIds.add(requestId);
    await handler(event);
  }
  const fetch = async (url, options) => {
    state.probes.push({ url, options, pageClosed: state.pageCloses > 0 });
    const index = Number(new URL(url).pathname.split('/').at(-1));
    const total = totals[index];
    return {
      status: response.status ?? 206,
      headers: new Headers({ 'content-type': response.contentType ?? 'audio/mpeg',
        ...(response.omitContentRange ? {} : { 'content-range': `bytes 0-0/${total}` }) }),
      body: { cancel: async () => { state.cancels += 1; } },
    };
  };
  const phaseController = {
    beginMediaPhase() { state.order.push('policy.media'); state.policyPhase = 'media'; },
    endMediaPhase() { state.order.push('policy.closed'); state.policyPhase = 'closed'; },
  };
  return { page, context, state, fetch, emit, emitRequest, emitPaused, phaseController };
}

const declaredParts = () => [
  { key: 'one', index: 0, contentLength: 100, upstreamUrl: 'https://dewey-fixture.listen.libbyapp.com/book/a.mp3', headers: {} },
  { key: 'two', index: 1, contentLength: 200, upstreamUrl: 'https://dewey-fixture.listen.libbyapp.com/book/b.mp3', headers: {} },
  { key: 'three', index: 2, contentLength: 300, upstreamUrl: 'https://dewey-fixture.listen.libbyapp.com/book/c.mp3', headers: {} },
];
const captureWindow = (fixture, parts = declaredParts(), options = {}) => captureInitialPlaybackWindow(
  fixture.page, fixture.context, parts, input.webUrl, { ...options, phaseController: fixture.phaseController },
);

test('official Play captures and length-maps the contiguous initial playback window', async () => {
  const f = initialWindowFixture();
  const result = await captureWindow(f, declaredParts(), { fetch: f.fetch, timeoutMs: 100, observationMs: 20 });
  assert.deepEqual(result.map(({ key, upstreamUrl, headers }) => [key, upstreamUrl, headers]), [
    ['one', 'https://audioclips.cdn.overdrive.com/signed/0', {}],
    ['two', 'https://audioclips.cdn.overdrive.com/signed/1', {}],
  ]);
  assert.equal(f.state.clicked.length, 1);
  assert.equal(f.state.probes.length, 2);
  assert.equal(f.state.probes.every(probe => probe.pageClosed), true);
  assert.equal(f.state.pageCloses, 1);
  assert.ok(f.state.order.indexOf('page.close') < f.state.order.indexOf('Fetch.disable'));
  assert.ok(f.state.probes.every(({ options }) => options.method === 'GET' && options.redirect === 'manual'
    && options.headers.Range === 'bytes=0-0' && Object.keys(options.headers).length === 1));
  assert.equal(f.state.cancels, 2);
  assert.equal(f.state.cdpEnabled, true);
  assert.ok(f.state.order.indexOf('Fetch.enable') < f.state.order.indexOf('policy.media'));
  assert.ok(f.state.order.indexOf('policy.closed') < f.state.order.indexOf('page.close'));
  assert.deepEqual(f.state.cdpCommands.find(command => command.method === 'Fetch.enable')?.params,
    { patterns: [{ urlPattern: '*', resourceType: 'Media', requestStage: 'Request' }] });
  assert.equal(f.state.cdpDisabled, true);
  assert.equal(f.state.cdpDetached, true);
  assert.equal(f.state.cdpEvents.size, 0);
  assert.deepEqual(f.state.continued, [
    'https://dewey-fixture.listen.libbyapp.com/official/0?cmpt=opaque',
    'https://audioclips.cdn.overdrive.com/signed/0',
    'https://audioclips.cdn.overdrive.com/signed/1',
  ]);
});

test('a resumed single-part window preserves original identity while reindexing for transport', async () => {
  const f = initialWindowFixture({ totals: [200], delays: [0] });
  const result = await captureWindow(f, declaredParts(), { fetch: f.fetch, timeoutMs: 100, observationMs: 10 });
  assert.deepEqual(result, [{
    key: 'two', index: 0, contentLength: 200,
    upstreamUrl: 'https://audioclips.cdn.overdrive.com/signed/0', headers: {},
  }]);
});

test('a resumed window sorts contiguous original parts and reindexes without changing stable identity', async () => {
  const parts = declaredParts().map((part, index) => ({
    ...part, title: `Original ${index + 1}`, duration: 10 + index,
  }));
  const f = initialWindowFixture({ totals: [300, 200], delays: [0, 5] });
  const result = await captureWindow(f, parts, { fetch: f.fetch, timeoutMs: 100, observationMs: 20 });
  assert.deepEqual(result.map(({ key, index, title, duration, contentLength }) => (
    { key, index, title, duration, contentLength }
  )), [
    { key: 'two', index: 0, title: 'Original 2', duration: 11, contentLength: 200 },
    { key: 'three', index: 1, title: 'Original 3', duration: 12, contentLength: 300 },
  ]);
});

test('a resumed window rejects gaps in the original spine', async () => {
  const parts = [...declaredParts(), {
    key: 'four', index: 3, contentLength: 400,
    upstreamUrl: 'https://dewey-fixture.listen.libbyapp.com/book/d.mp3', headers: {},
  }];
  const f = initialWindowFixture({ totals: [200, 400], delays: [0, 5] });
  await assert.rejects(captureWindow(f, parts,
    { fetch: f.fetch, timeoutMs: 100, observationMs: 20 }), { code: 'BROWSER_UNSUPPORTED_FULFILLMENT' });
});

test('a window beginning at original index zero retains existing identity and transport index', async () => {
  const f = initialWindowFixture({ totals: [100], delays: [0] });
  const result = await captureWindow(f, declaredParts(), { fetch: f.fetch, timeoutMs: 100, observationMs: 10 });
  assert.deepEqual(result.map(({ key, index, contentLength }) => ({ key, index, contentLength })), [
    { key: 'one', index: 0, contentLength: 100 },
  ]);
});

test('unrelated non-media traffic stays outside CDP while allowed media and a foreign redirect remain enforced', async () => {
  const f = initialWindowFixture({ totals: [], onClick: async () => {
    await f.emitPaused('shell', 'https://dewey-fixture.listen.libbyapp.com/official/0?cmpt=opaque', 'Media');
    await f.emitPaused('cdn', 'https://audioclips.cdn.overdrive.com/signed/0', 'Media');
    await f.emitPaused('unrelated', 'https://dewey-fixture.listen.libbyapp.com/_d/activity', 'Other');
    await f.emitPaused('foreign', 'https://foreign.invalid/redirect.mp3', 'Media');
  } });

  assert.equal(allowsRequest({
    url: 'https://dewey-fixture.listen.libbyapp.com/_d/activity', method: 'GET', resourceType: 'other',
    isNavigation: false, isMainFrame: true,
  }, input.webUrl), false, 'the context policy blocks unrelated traffic before egress');

  await assert.rejects(captureWindow(f, declaredParts(),
    { fetch: f.fetch, timeoutMs: 100, observationMs: 10 }), { code: 'BROWSER_UNSUPPORTED_FULFILLMENT' });
  assert.deepEqual(f.state.cdpDeliveries.map(event => event.requestId), ['shell', 'cdn', 'foreign']);
  assert.deepEqual(f.state.continued, [
    'https://dewey-fixture.listen.libbyapp.com/official/0?cmpt=opaque',
    'https://audioclips.cdn.overdrive.com/signed/0',
  ]);
  assert.equal(f.state.aborted.includes('https://foreign.invalid/redirect.mp3'), true);
  assert.equal(f.state.continued.includes('https://foreign.invalid/redirect.mp3'), false);
});

test('capture observes the full bounded window when index one precedes index zero by fifteen seconds', async () => {
  // Milliseconds model seconds here so the real timer contract is exercised without a 20-second unit test.
  const f = initialWindowFixture({ totals: [200, 100], delays: [0, 15] });
  const result = await captureWindow(f, declaredParts(), { fetch: f.fetch, timeoutMs: 30, observationMs: 20 });
  assert.deepEqual(result.map(part => part.index), [0, 1]);
});

test('prefetched index one may arrive before delayed index zero but returns a stable ordered prefix', async () => {
  const f = initialWindowFixture({ totals: [200, 100], delays: [0, 25] });
  const result = await captureWindow(f, declaredParts(), { fetch: f.fetch, timeoutMs: 100, observationMs: 40 });
  assert.deepEqual(result.map(({ index, key }) => [index, key]), [[0, 'one'], [1, 'two']]);
});

test('hard capture deadline returns a collected prefix but remains a timeout when none arrived', async () => {
  const captured = initialWindowFixture({ totals: [100], delays: [0] });
  const result = await captureWindow(captured, declaredParts(), { fetch: captured.fetch, timeoutMs: 15, observationMs: 100 });
  assert.deepEqual(result.map(part => part.index), [0]);

  const empty = initialWindowFixture({ totals: [] });
  await assert.rejects(captureWindow(empty, declaredParts(),
    { fetch: empty.fetch, timeoutMs: 15, observationMs: 100 }), { code: 'BROWSER_TIMEOUT' });
});

test('capture rejects unmatched, ambiguous, and duplicate length mappings', async () => {
  const cases = [
    { totals: [999], parts: declaredParts() },
    { totals: [100], parts: declaredParts().map((part, index) => index === 1 ? { ...part, contentLength: 100 } : part) },
    { totals: [100, 100], parts: declaredParts() },
  ];
  for (const { totals, parts } of cases) {
    const f = initialWindowFixture({ totals, delays: totals.map(() => 0) });
    await assert.rejects(captureWindow(f, parts,
      { fetch: f.fetch, timeoutMs: 100, observationMs: 10 }), { code: 'BROWSER_UNSUPPORTED_FULFILLMENT' });
  }
});

test('capture rejects foreign media before egress and malformed range validation responses', async () => {
  for (const response of [{ status: 200 }, { contentType: 'text/html' }, { omitContentRange: true }]) {
    const f = initialWindowFixture({ totals: [100], response });
    await assert.rejects(captureWindow(f, declaredParts(),
      { fetch: f.fetch, timeoutMs: 100, observationMs: 10 }), { code: 'BROWSER_UNSUPPORTED_FULFILLMENT' });
  }
  const f = initialWindowFixture({ totals: [] });
  const pending = captureWindow(f, declaredParts(), { fetch: f.fetch, timeoutMs: 100, observationMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 0));
  await f.emitPaused('foreign-redirect', 'https://evil.test/audio.mp3', 'Media');
  await assert.rejects(pending, { code: 'BROWSER_UNSUPPORTED_FULFILLMENT' });
  assert.equal(f.state.aborted.includes('https://evil.test/audio.mp3'), true);
  assert.equal(f.state.continued.includes('https://evil.test/audio.mp3'), false);
  assert.equal(f.state.cdpEvents.size, 0);
  assert.equal(f.state.cdpDisabled, true);
  assert.equal(f.state.cdpDetached, true);
});

test('CDP media phase fails non-GET, malformed, and wrong-origin media requests before egress', async () => {
  const cases = [
    { url: 'https://dewey-fixture.listen.libbyapp.com/official/0', type: 'Media', method: 'POST' },
    { url: 'not a URL', type: 'Media', method: 'GET' },
    { url: 'https://another.listen.libbyapp.com/official/0', type: 'Media', method: 'GET' },
    { url: 'https://user:pass@audioclips.cdn.overdrive.com/signed/0', type: 'Media', method: 'GET' },
  ];
  for (const [index, value] of cases.entries()) {
    const f = initialWindowFixture({ totals: [] });
    const pending = captureWindow(f, declaredParts(), { fetch: f.fetch, timeoutMs: 100, observationMs: 10 });
    await new Promise(resolve => setImmediate(resolve));
    await f.emitPaused(`blocked-${index}`, value.url, value.type, value.method);
    await assert.rejects(pending, { code: 'BROWSER_UNSUPPORTED_FULFILLMENT' });
    assert.equal(f.state.continued.includes(value.url), false);
    assert.equal(f.state.aborted.includes(value.url), true);
  }
});

test('CDP enforcement is disabled and detached when capture is aborted', async () => {
  const f = initialWindowFixture({ totals: [] });
  const controller = new AbortController();
  const pending = captureWindow(f, declaredParts(),
    { fetch: f.fetch, signal: controller.signal, timeoutMs: 100, observationMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, { code: 'BROWSER_CANCELLED' });
  assert.equal(f.state.cdpEvents.size, 0);
  assert.equal(f.state.cdpDisabled, true);
  assert.equal(f.state.cdpDetached, true);
});

test('CDP listener failures fail closed and still tear down interception', async () => {
  const f = initialWindowFixture({ totals: [100], failCdpMethod: 'Fetch.continueRequest' });
  await assert.rejects(captureWindow(f, declaredParts(),
    { fetch: f.fetch, timeoutMs: 100, observationMs: 10 }), { code: 'BROWSER_FAILED' });
  assert.equal(f.state.aborted.length > 0, true);
  assert.equal(f.state.cdpEvents.size, 0);
  assert.equal(f.state.cdpDetached, true);
});

test('failed request rejection and failed page close preserve CDP enforcement without network release', async () => {
  const f = initialWindowFixture({ totals: [], failCdpMethod: 'Fetch.failRequest', failPageClose: true,
    requestDuringPageClose: true });
  const pending = captureWindow(f, declaredParts(), { fetch: f.fetch, timeoutMs: 100, observationMs: 10 });
  await new Promise(resolve => setImmediate(resolve));
  await f.emitPaused('foreign-redirect', 'https://foreign.invalid/redirect.mp3', 'Media');
  await assert.rejects(pending, { code: 'BROWSER_FAILED' });
  assert.equal(f.state.continued.length, 1); // the authorized shell request only
  assert.equal(f.state.continued.includes('https://foreign.invalid/redirect.mp3'), false);
  assert.equal(f.state.continued.includes('https://foreign.invalid/during-close.mp3'), false);
  assert.equal(f.state.cdpDisabled, false);
  assert.equal(f.state.cdpDetached, false);
  assert.equal(f.state.cdpEvents.has('Fetch.requestPaused'), true);
  assert.equal(f.state.networkEscapes, 0);
});

test('cancellation while Play later rejects has no process-level unhandled rejection', async () => {
  const controller = new AbortController();
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason?.code || reason?.message || 'unknown');
  process.on('unhandledRejection', onUnhandled);
  try {
    const f = initialWindowFixture({ totals: [], onClick: async () => {
      controller.abort();
      await new Promise(resolve => setImmediate(resolve));
      throw new Error('private click failure');
    } });
    await assert.rejects(captureWindow(f, declaredParts(),
      { fetch: f.fetch, signal: controller.signal, timeoutMs: 100, observationMs: 10 }), { code: 'BROWSER_CANCELLED' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(f.state.pageCloses, 1);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

function fixture(map = book(), { waitFailure, poolTimeoutMs } = {}) {
  const state = { closes: 0, pageEvents: {}, contextEvents: {}, clicked: [], cdpCommands: [], cdpDetached: false,
    initInstalled: false };
  const page = {
    close: async () => { state.pageCloses = (state.pageCloses || 0) + 1; },
    on: (event, callback) => { state.pageEvents[event] = callback; },
    off: (event, callback) => { if (state.pageEvents[event] === callback) delete state.pageEvents[event]; },
    goto: async (url) => {
      assert.equal(state.initInstalled, true, 'worker guard must be installed before provider navigation');
      state.url = url;
      return { ok: () => true };
    },
    waitForFunction: async (fn) => { if (waitFailure) throw waitFailure; if (!vm.runInNewContext(`(${fn.toString()})()`, { window: { BIF: { map } } })) throw Object.assign(new Error('readiness deadline'), { name: 'TimeoutError' }); },
    evaluate: async fn => vm.runInNewContext(`(${fn.toString()})()`, { window: { BIF: { map }, secret: 'do not extract' } }),
    mainFrame: () => page,
    getByRole: (_role, { name }) => {
      const play = String(name).includes('play');
      const controls = Array.from({ length: play ? 1 : map.spine.length }, (_, index) => ({
        isVisible: async () => true, isEnabled: async () => true,
        click: async () => {
          state.clicked.push(play ? 'play' : index);
          if (play) await state.cdpPaused?.({ requestId: 'cdn-0', resourceType: 'Media', request: {
            url: 'https://audioclips.cdn.overdrive.com/signed/0', method: 'GET',
          } });
        },
      }));
      return { all: async () => controls, first: () => controls[0] };
    },
  };
  const context = {
    newPage: async () => page,
    addInitScript: async script => { state.initScript = script; state.initInstalled = true; },
    route: async (_glob, callback) => { state.route = callback; },
    unroute: async () => { throw new Error('operation must retain context route'); },
    routeWebSocket: async (_glob, callback) => { state.socketRoute = callback; },
    on: (event, callback) => { state.contextEvents[event] = callback; },
    newCDPSession: async () => ({
      on: (event, callback) => { if (event === 'Fetch.requestPaused') state.cdpPaused = callback; },
      off: (event, callback) => { if (event === 'Fetch.requestPaused' && state.cdpPaused === callback) delete state.cdpPaused; },
      send: async (method, params = {}) => { state.cdpCommands.push({ method, params }); },
      detach: async () => { state.cdpDetached = true; },
    }),
    close: async () => { state.closes++; },
  };
  const pool = createBrowserPool({ timeoutMs: poolTimeoutMs, launch: async () => ({ newContext: async () => context, close: async () => {} }) });
  return { pool, state, page };
}

test('input only accepts three fields and strict HTTPS listen origins', () => {
  assert.equal(validateInput(input).operationId, 'op-1');
  for (const webUrl of ['https://evil.test/', 'http://listen.libbyapp.com/', 'https://listen.libbyapp.com.evil.test/', 'https://user:pass@listen.libbyapp.com/', 'https://listen.libbyapp.com:444/', 'https://listen.libbyapp.com/#x', 'https://127.0.0.1/', 'https://listen.libbyapp.com/?old=query']) {
    assert.throws(() => validateInput({ ...input, webUrl }), { code: 'BROWSER_ORIGIN_REJECTED' });
  }
  for (const value of [{ ...input, evaluate: 'code' }, { ...input, message: '' }, { ...input, operationId: 'secret\n' }, { ...input, message: 'm=x#fragment' }, { ...input, message: 'a'.repeat(32769) }, null]) {
    assert.throws(() => validateInput(value), { code: 'BROWSER_INVALID_REQUEST' });
  }
});

test('policy allows only shell/static/possession and rejects mutation/media/escapes', () => {
  const request = (path, type = 'fetch', method = 'GET', extra = {}) => ({ url: new URL(path, input.webUrl).href, resourceType: type, method, isNavigation: type === 'document', isMainFrame: true, ...extra });
  for (const value of [request('/book/?m=x', 'document'), request('/_d/bifocal-9.1.0-ha/themes/listen/dewey/theme.js', 'script'), request('/_d/bifocal-9.1.0-ha/themes/listen/dewey/inc/str/en-US.js', 'script'), request('/_d/bifocal-9.1.0-ha/themes/listen/dewey/theme.css', 'stylesheet'), request('/_d/possession?x=1')]) {
    assert.equal(allowsRequest(value, input.webUrl), true);
  }
  for (const value of [request('/_d/activity'), request('/_d/error'), request('/analytics.js', 'script'), request('/report.js', 'script'), request('/book/a.mp3', 'media'), request('/book/a.mp3', 'fetch'), request('/book/', 'document', 'POST'), request('/_d/possession', 'fetch', 'POST'), request('/other/', 'document'), request('/book/', 'document', 'GET', { isMainFrame: false }), request('https://cdn.od-cdn.com/a.mp3'), request('https://evil.test/x.js', 'script'), request('file:///tmp/private'), request('/unknown.json')]) {
    assert.equal(allowsRequest(value, input.webUrl), false, value.url);
  }
});

test('only evidenced bootstrap files are allowed, not arbitrary same-origin scripts or styles', () => {
  for (const [path, resourceType] of [
    ['/collect.js?event=play', 'script'], ['/static/player.js', 'script'], ['/static/player.css', 'stylesheet'],
    ['/_d/bifocal-9.1.0-ha/themes/listen/dewey/collect.js', 'script'],
    ['/_d/bifocal-9.1.0-ha/themes/listen/dewey/theme.js', 'stylesheet'],
    ['/_d/bifocal-9.1.0-ha/themes/listen/dewey/extra.css', 'stylesheet'],
    ['/_d/bifocal-9.1.0-ha/themes/listen/dewey/inc/str/other.js', 'script'],
    ['/_d/bifocal-99.0.0/themes/listen/dewey/theme.js', 'script'],
    ['https://another.listen.libbyapp.com/_d/bifocal-9.1.0-ha/themes/listen/dewey/theme.js', 'script'],
  ]) {
    assert.equal(allowsRequest({ url: new URL(path, input.webUrl).href, resourceType, method: 'GET', isNavigation: false }, input.webUrl), false, path);
  }
});

test('context-wide media phase aborts popup initial navigation before network and closes without a routing gap', async () => {
  const state = { route: null, continued: [], aborted: [], fetched: [], popupCloses: 0, order: [] };
  const mainFrame = {};
  const page = {
    mainFrame: () => mainFrame,
    on: () => {},
  };
  const context = {
    addInitScript: async script => { state.order.push('init'); state.initScript = script; },
    on: (event, handler) => { if (event === 'page') state.pageListener = handler; }, routeWebSocket: async () => {},
    route: async (_glob, handler) => { state.order.push('route'); state.route = handler; },
  };
  const policy = await installPolicy(context, page, input.webUrl);
  assert.deepEqual(state.order.slice(0, 2), ['init', 'route']);
  policy.beginMediaPhase();
  const invoke = async ({ url, method = 'GET', resourceType = 'media', navigation = false, frame = mainFrame }) => {
    await state.route({
      request: () => ({ url: () => url, method: () => method, resourceType: () => resourceType,
        isNavigationRequest: () => navigation, frame: () => frame }),
      continue: async () => { state.continued.push(url); },
      abort: async () => { state.aborted.push(url); },
      fetch: async () => { state.fetched.push(url); throw new Error('network must not start'); },
    });
  };
  await invoke({ url: 'https://foreign.invalid/popup', resourceType: 'document', navigation: true, frame: {} });
  const popup = { close: async () => { state.popupCloses += 1; } };
  state.pageListener(popup);
  await new Promise(resolve => setImmediate(resolve));
  await invoke({ url: 'https://dewey-fixture.listen.libbyapp.com/official/0', resourceType: 'media' });
  assert.deepEqual(state.aborted, ['https://foreign.invalid/popup']);
  assert.deepEqual(state.continued, ['https://dewey-fixture.listen.libbyapp.com/official/0']);
  assert.deepEqual(state.fetched, []);
  assert.equal(state.popupCloses, 1);

  policy.endMediaPhase();
  await invoke({ url: 'https://dewey-fixture.listen.libbyapp.com/official/1', resourceType: 'media' });
  assert.equal(state.aborted.includes('https://dewey-fixture.listen.libbyapp.com/official/1'), true);
  assert.equal(state.continued.includes('https://dewey-fixture.listen.libbyapp.com/official/1'), false);
});

test('pre-navigation init script disables escaping workers and worklet loaders in every realm without changing bootstrap APIs', async () => {
  const state = {};
  const page = { mainFrame: () => ({}), on: () => {} };
  const context = {
    addInitScript: async script => { state.initScript = script; },
    on: () => {}, routeWebSocket: async () => {}, route: async () => {},
  };
  await installPolicy(context, page, input.webUrl);
  const exerciseRealm = () => {
    const nativeFetch = () => 'approved API';
    class BaseAudioContext {}
    Object.defineProperty(BaseAudioContext.prototype, 'audioWorklet', {
      configurable: true, get: () => ({ addModule: () => Promise.resolve() }),
    });
    const nativeWorklet = { addModule: () => Promise.resolve() };
    const CSS = { supports: () => true };
    for (const name of ['paintWorklet', 'layoutWorklet', 'animationWorklet']) {
      Object.defineProperty(CSS, name, { configurable: true, get: () => nativeWorklet });
    }
    const sandbox = { Worker: function NativeWorker() {}, SharedWorker: function NativeSharedWorker() {},
      BaseAudioContext, CSS, fetch: nativeFetch };
    vm.runInNewContext(`(${state.initScript.toString()})()`, sandbox);
    assert.throws(() => new sandbox.Worker('blob:worker'), /disabled/);
    assert.throws(() => new sandbox.SharedWorker('blob:shared-worker'), /disabled/);
    for (const name of ['Worker', 'SharedWorker']) {
      const descriptor = Object.getOwnPropertyDescriptor(sandbox, name);
      assert.equal(descriptor.configurable, false);
      assert.equal(descriptor.writable, false);
    }
    const worklet = new sandbox.BaseAudioContext().audioWorklet;
    assert.throws(() => worklet.addModule('https://foreign.invalid/direct-worklet.js'), /disabled/);
    assert.throws(() => worklet.addModule('blob:static-foreign-import'), /disabled/);
    const audioWorkletDescriptor = Object.getOwnPropertyDescriptor(sandbox.BaseAudioContext.prototype, 'audioWorklet');
    assert.equal(audioWorkletDescriptor.configurable, false);
    assert.equal(Object.getOwnPropertyDescriptor(worklet, 'addModule').configurable, false);
    assert.equal(Object.getOwnPropertyDescriptor(worklet, 'addModule').writable, false);
    for (const name of ['paintWorklet', 'layoutWorklet', 'animationWorklet']) {
      const descriptor = Object.getOwnPropertyDescriptor(sandbox.CSS, name);
      assert.equal(descriptor.configurable, false);
      assert.throws(() => sandbox.CSS[name].addModule(`https://foreign.invalid/${name}.js`), /disabled/);
      assert.throws(() => descriptor.get.call(sandbox.CSS).addModule('blob:static-foreign-import'), /disabled/);
      assert.equal(Object.getOwnPropertyDescriptor(sandbox.CSS[name], 'addModule').writable, false);
    }
    assert.equal(sandbox.CSS.supports(), true);
    assert.equal(sandbox.fetch, nativeFetch);
  };
  exerciseRealm();
  exerciseRealm(); // Models a child-frame realm.
  exerciseRealm(); // Models a popup realm before any popup script executes.
});

test('official map readiness yields ordered MP3 metadata and no extra page state', async () => {
  const f = fixture();
  const responseFor = total => ({ status: 206, headers: new Headers({ 'content-type': 'audio/mpeg', 'content-range': `bytes 0-0/${total}` }), body: { cancel: async () => {} } });
  const run = bootstrapLoan(input, { pool: f.pool, captureOptions: { timeoutMs: 100, observationMs: 10,
    fetch: async url => responseFor(url.endsWith('/0') ? 100 : 200) } });
  await new Promise(resolve => setTimeout(resolve, 0));
  await f.state.route({ request: () => ({ url: () => 'https://dewey-fixture.listen.libbyapp.com/official/0', method: () => 'GET', resourceType: () => 'media',
    frame: () => f.page, isNavigationRequest: () => false }), continue: async () => {}, abort: async () => {} });
  const result = await run;
  assert.equal(f.state.url, 'https://dewey-fixture.listen.libbyapp.com/book/?m=a%2Bb&x=1');
  assert.equal(f.state.closes, 1);
  assert.equal(result.title, 'Fixture book');
  assert.equal(result.author, 'Author');
  assert.equal(result.narrator, 'Reader');
  assert.equal(result.duration, 30.5);
  assert.deepEqual(result.parts.map(({ index, mimeType, key }) => [index, mimeType, key]), [[0, 'audio/mpeg', 'part-a-part01-mp3']]);
  assert.deepEqual(result.parts[0].headers, {});
  assert.equal(result.parts[0].upstreamUrl, 'https://audioclips.cdn.overdrive.com/signed/0');
  assert.deepEqual(f.state.clicked, ['play']);
  assert.deepEqual(result.parts.map(part => part.headers), [{}]);
  assert.equal(JSON.stringify(result).includes('do not extract'), false);
  await f.pool.close();
});

test('pool deadline aborts a stalled capability probe before the slot is reusable', async () => {
  const f = fixture(book(), { poolTimeoutMs: 20 });
  const caller = new AbortController();
  let externalWork = 0;
  let observedPoolSignal;
  let resolveAbort;
  const aborted = new Promise(resolve => { resolveAbort = resolve; });
  const pending = bootstrapLoan(input, { pool: f.pool, signal: caller.signal, captureOptions: {
    timeoutMs: 100, observationMs: 1,
    fetch: async (_url, { signal }) => {
      observedPoolSignal = signal;
      externalWork += 1;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        externalWork -= 1;
        resolveAbort();
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true }));
    },
  } });
  const rejected = assert.rejects(pending, { code: 'BROWSER_TIMEOUT' });
  await aborted;
  await rejected;
  assert.notEqual(observedPoolSignal, caller.signal);
  assert.equal(observedPoolSignal.aborted, true);
  assert.equal(externalWork, 0);
  assert.equal(await f.pool.run(async () => externalWork ? 'overlap' : 'clean'), 'clean');
  await f.pool.close();
});

test('part capabilities must use the authorized shell origin, including listen subdomains', async () => {
  const map = book();
  map.spine[0].path = 'https://another.listen.libbyapp.com/book/a.mp3';
  const f = fixture(map);
  await assert.rejects(bootstrapLoan(input, { pool: f.pool }), { code: 'BROWSER_UNSUPPORTED_FULFILLMENT' });
  assert.equal(f.state.closes, 1);
  await f.pool.close();
});

test('extractor reads only BIF map and preserves DRM flags for rejection', () => {
  const map = book();
  map.encryption = { scheme: 'fixture' };
  map.spine[0].license = { token: 'private' };
  map.secret = 'private';
  const extracted = vm.runInNewContext(`(${readBookMap.toString()})()`, { window: { BIF: { map } } });
  assert.equal(extracted.encryption, true);
  assert.equal(extracted.spine[0].license, true);
  assert.equal('secret' in extracted, false);
  assert.equal(vm.runInNewContext(`(${readBookMap.toString()})()`, { window: { bData: map } }), null);
});

test('non-MP3, encrypted, licensed, empty, malformed, and foreign spines fail closed', async () => {
  const variants = [
    map => { map.spine = []; },
    map => { map.encryption = { scheme: 'drm' }; },
    map => { map.license = { id: 'license' }; },
    map => { map.spine[0].encryption = true; },
    map => { map.spine[0].license = true; },
    map => { map.spine[0]['media-type'] = 'audio/aac'; },
    map => { map.spine[0].path = 'https://evil.test/a.mp3'; },
    map => { map.spine[0]['audio-duration'] = -1; },
    map => { map.spine[0]['-odread-file-bytes'] = 'not bytes'; },
  ];
  for (const change of variants) {
    const map = book(); change(map);
    const f = fixture(map);
    await assert.rejects(bootstrapLoan(input, { pool: f.pool }), { code: map.spine.length ? 'BROWSER_UNSUPPORTED_FULFILLMENT' : 'BROWSER_TIMEOUT' });
    assert.equal(f.state.closes, 1);
    await f.pool.close();
  }
  const f = fixture(book(), { waitFailure: Object.assign(new Error('private query'), { name: 'TimeoutError' }) });
  await assert.rejects(bootstrapLoan(input, { pool: f.pool }), { code: 'BROWSER_TIMEOUT' });
  assert.equal(f.state.closes, 1);
  await f.pool.close();
});
