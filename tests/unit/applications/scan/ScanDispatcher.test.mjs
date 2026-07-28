import { describe, it, expect, vi } from 'vitest';
import { ScanDispatcher } from '#apps/scan/ScanDispatcher.mjs';

const handler = (namespace, impl) => ({ namespace, handle: vi.fn(impl) });

describe('ScanDispatcher', () => {
  it('routes a prefixed code to its namespace handler', async () => {
    const content = handler('content', async () => ({ status: 'ok' }));
    const d = new ScanDispatcher({ handlers: [content] });
    const out = await d.dispatch({ code: 'go:office:plex:1', device: 'kitchen' });
    expect(content.handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'office:plex:1', raw: 'go:office:plex:1', device: 'kitchen' }),
    );
    expect(out).toMatchObject({ status: 'ok', domain: 'content' });
  });

  it('falls back to the reader route when the code says nothing', async () => {
    const nutrition = handler('nutrition', async () => ({ status: 'logged' }));
    const d = new ScanDispatcher({ handlers: [nutrition], routeFallback: { nutribot: 'nutrition' } });
    const out = await d.dispatch({ code: '041260010682', device: 'k', route: 'nutribot' });
    expect(out.domain).toBe('nutrition');
  });

  it('reaches `product` ONLY through the route, never from the code', async () => {
    // A UPC does not say what it is for. `product` is therefore a route-fallback
    // target rather than a shape outcome, which is what keeps behaviour
    // unchanged per reader: the same tin is a food lookup at the fridge and
    // NOTHING on a content-routed reader, exactly as today.
    const product = handler('product', async () => ({ status: 'looked-up' }));
    const content = handler('content', async () => ({ status: 'dispatched' }));
    const d = new ScanDispatcher({
      handlers: [product, content],
      routeFallback: { nutribot: 'product', content: 'content' },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const atFridge = await d.dispatch({ code: '041260010682', device: 'k', route: 'nutribot' });
    expect(atFridge).toMatchObject({ domain: 'product', status: 'looked-up' });

    // Same barcode, no route configured for it: nobody claims it, and the scan
    // does nothing rather than something wrong.
    const unrouted = await d.dispatch({ code: '041260010682', device: 'office', route: 'lounge' });
    expect(unrouted).toMatchObject({ status: 'unknown', domain: null });
    expect(product.handle).toHaveBeenCalledTimes(1);
  });

  it('does not let the reader route override a shape-resolved ISBN', async () => {
    // An ISBN is identifiable FROM THE CODE ITSELF — that is the whole test for
    // what shape may claim — so an ISBN scanned at the fridge is still a book,
    // not a food. This is the same principle as a prefixed code: what the code
    // says beats where it was scanned, or one sticker means different things in
    // different rooms.
    const nutrition = handler('nutrition', async () => ({ status: 'logged' }));
    const book = handler('book', async () => ({ status: 'shelved' }));
    const d = new ScanDispatcher({
      handlers: [nutrition, book], routeFallback: { nutribot: 'nutrition' },
    });
    const out = await d.dispatch({ code: '9780306406157', device: 'k', route: 'nutribot' });
    expect(out).toMatchObject({ domain: 'book', status: 'shelved' });
    expect(nutrition.handle).not.toHaveBeenCalled();
  });

  it('does not let the reader route override a prefixed code', async () => {
    const school = handler('school', async () => ({ status: 'printed' }));
    const nutrition = handler('nutrition', async () => ({ status: 'logged' }));
    const d = new ScanDispatcher({
      handlers: [school, nutrition], routeFallback: { nutribot: 'nutrition' },
    });
    const out = await d.dispatch({ code: 'sch:a7f3k2', device: 'k', route: 'nutribot' });
    expect(out.domain).toBe('school');
    expect(nutrition.handle).not.toHaveBeenCalled();
  });

  it('routes a colon-free legacy command via the reader route', async () => {
    const content = handler('content', async () => ({ status: 'dispatched' }));
    const d = new ScanDispatcher({ handlers: [content], routeFallback: { content: 'content' } });
    const out = await d.dispatch({ code: 'pause', device: 'office', route: 'content' });
    expect(out.domain).toBe('content');
    expect(content.handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'pause', form: 'unknown' }),
    );
  });

  it('returns an explicit unknown outcome rather than falling through', async () => {
    const d = new ScanDispatcher({ handlers: [] });
    const out = await d.dispatch({ code: '!!!', device: 'k' });
    expect(out).toMatchObject({ status: 'unknown', domain: null, physical: 'none', printed: false });
    expect(out.message).toBeTruthy();
  });

  it('returns unknown when a namespace resolves but has no registered handler', async () => {
    const d = new ScanDispatcher({ handlers: [] });
    const out = await d.dispatch({ code: 'sch:abc', device: 'k' });
    expect(out.status).toBe('unknown');
  });

  it('never returns undefined for arbitrary input', async () => {
    const d = new ScanDispatcher({ handlers: [] });
    for (const code of ['', '   ', ':::', 'go:', '9', 'ct:', null, undefined]) {
      const out = await d.dispatch({ code, device: 'k' });
      expect(out).toBeDefined();
      expect(out.status).toBeTruthy();
    }
  });

  it('converts a handler throw into a failed outcome, not a rejection', async () => {
    const boom = handler('content', async () => { throw new Error('nope'); });
    const d = new ScanDispatcher({ handlers: [boom] });
    const out = await d.dispatch({ code: 'go:a:b', device: 'k' });
    expect(out.status).toBe('failed');
    expect(out.message).toContain('nope');
  });
});

// ---- Task 5: claim is not success ----
describe('claim is not success', () => {
  it('stops at a handler that claims but refuses, without a route fallback', async () => {
    const nutrition = handler('nutrition', async () => ({
      status: 'refused', claimed: true, ok: false, message: 'unknown container "teapot"',
    }));
    const product = handler('product', async () => ({ status: 'logged' }));
    const d = new ScanDispatcher({
      handlers: [nutrition, product], routeFallback: { nutribot: 'product' },
    });
    const out = await d.dispatch({ code: 'ct:teapot', device: 'k', route: 'nutribot' });
    expect(out.status).toBe('refused');
    expect(out.message).toContain('teapot');
    expect(product.handle).not.toHaveBeenCalled();
  });

  it('does not fall back when a handler declines without claiming', async () => {
    const content = handler('content', async () => ({ status: 'declined', claimed: false }));
    const d = new ScanDispatcher({ handlers: [content] });
    const out = await d.dispatch({ code: 'go:nope', device: 'k' });
    expect(out.status).toBe('declined');
  });

  it('lets a caller tell refusal from success WITHOUT knowing any domain vocabulary', async () => {
    // `status` is free-form per domain, so a generic caller — composition
    // picking a feedback channel — cannot read it. `ok` is the one field that
    // means the same thing everywhere. It defaults to TRUE so that a handler
    // which refuses has to say so explicitly, rather than a diligent handler
    // being distinguishable from a careless one only by accident.
    const d = new ScanDispatcher({
      handlers: [
        { namespace: 'nutrition', handle: async () => ({ status: 'refused', ok: false }) },
        { namespace: 'school', handle: async () => ({ status: 'printed' }) },
        { namespace: 'content', handle: async () => { throw new Error('nope'); } },
      ],
      logger: silent,
    });
    expect((await d.dispatch({ code: 'ct:teapot' })).ok).toBe(false);
    expect((await d.dispatch({ code: 'sch:a7f3k2' })).ok).toBe(true);
    // The two outcomes the dispatcher itself produces are not successes either.
    expect((await d.dispatch({ code: 'go:a:b' })).ok).toBe(false); // handler threw
    expect((await d.dispatch({ code: 'gibberish' })).ok).toBe(false); // nothing claimed it
    expect((await d.dispatch({ code: '9780306406157' })).ok).toBe(false); // no book handler
  });
});

// ---- Step 6: adversarial ----

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** The keys every Outcome carries, whatever the domain and whatever the handler returned. */
const DEFAULT_KEYS = ['status', 'ok', 'domain', 'message', 'physical', 'printed', 'effect'];

/** A logger whose methods EXIST but throw — the shape a real transport takes when it is down. */
const brokenLogger = {
  debug: () => { throw new Error('logger down'); },
  info: () => { throw new Error('logger down'); },
  warn: () => { throw new Error('logger down'); },
  error: () => { throw new Error('logger down'); },
};

describe('ScanDispatcher — prototype-chain safety', () => {
  const INHERITED = [
    'constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty',
    'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__',
  ];

  it('does not resolve an inherited member as a route fallback', async () => {
    // The bug Task 1 shipped, in a new place. `routeFallback` is indexed by a
    // value that comes from device config, and every object literal inherits
    // Object.prototype — so `route: 'constructor'` would resolve to a Function
    // and `route: '__proto__'` to an object, both of which then go looking for
    // a handler under a non-string namespace. An unregistered route must read
    // as no fallback, full stop.
    const d = new ScanDispatcher({
      handlers: [], routeFallback: { nutribot: 'nutrition' }, logger: silent,
    });
    for (const route of INHERITED) {
      const out = await d.dispatch({ code: 'greenbeans', device: 'k', route });
      expect(out).toMatchObject({ status: 'unknown', domain: null });
    }
  });

  it('does not resolve an inherited member as a handler namespace', async () => {
    // `#handlers` is a Map, so this is safe for a different reason than the
    // route map: Map lookup is own-entry only and has no prototype chain to
    // walk. The test exists so that swapping it for a plain object — an easy
    // "simplification" — fails loudly instead of reintroducing the hazard.
    const content = { namespace: 'content', handle: vi.fn(async () => ({ status: 'ok' })) };
    const d = new ScanDispatcher({
      handlers: [content],
      routeFallback: Object.fromEntries(INHERITED.map((n) => [`r-${n}`, n])),
      logger: silent,
    });
    for (const name of INHERITED) {
      const out = await d.dispatch({ code: 'greenbeans', device: 'k', route: `r-${name}` });
      // The route DOES resolve to that namespace string — that part is just
      // config. What must not happen is a Function off Object.prototype being
      // called as a handler.
      expect(out).toMatchObject({ status: 'unknown', domain: name });
      expect(content.handle).not.toHaveBeenCalled();
    }
  });

  it('ignores a non-string route rather than stringifying it into the lookup', async () => {
    // The single-element ARRAY is the one that bites in practice, and it is why
    // the type guard is not redundant with the null-prototype map: property
    // lookup coerces its key, and `String(['nutribot']) === 'nutribot'`. Express
    // hands you `req.query.route` as an array the moment a query param repeats
    // (`?route=nutribot&route=x`), so a malformed or replayed request would
    // otherwise pick up a fallback the reader was never configured for.
    const nutrition = handler('nutrition', async () => ({ status: 'logged' }));
    const d = new ScanDispatcher({
      handlers: [nutrition], routeFallback: { nutribot: 'nutrition' }, logger: silent,
    });
    const routes = [
      ['nutribot'], ['nutribot', 'content'], {}, [], 42, true, () => {}, Symbol('nutribot'),
    ];
    for (const route of routes) {
      const out = await d.dispatch({ code: 'greenbeans', device: 'k', route });
      expect(out.domain).toBe(null);
    }
    expect(nutrition.handle).not.toHaveBeenCalled();
  });

  it('ignores a non-string fallback namespace, so a config typo means no fallback', async () => {
    const d = new ScanDispatcher({
      handlers: [], routeFallback: { a: null, b: '', c: 42, d: {} }, logger: silent,
    });
    for (const route of ['a', 'b', 'c', 'd'])
      expect((await d.dispatch({ code: 'greenbeans', route })).domain).toBe(null);
  });

  it('survives a routeFallback that is not an object at all', () => {
    for (const junk of [null, undefined, 'nutrition', 42, []])
      expect(() => new ScanDispatcher({ handlers: [], routeFallback: junk })).not.toThrow();
  });
});

describe('ScanDispatcher — handler registration', () => {
  it('throws on a duplicate namespace rather than silently last-wins', () => {
    // Two handlers claiming `nutrition` is never intentional; it is a wiring
    // bug in the composition root. Last-wins would route every fridge scan to
    // whichever module happened to be listed second.
    const a = { namespace: 'nutrition', handle: async () => ({}) };
    const b = { namespace: 'nutrition', handle: async () => ({}) };
    expect(() => new ScanDispatcher({ handlers: [a, b] })).toThrow(/duplicate/i);
  });

  it('throws on a malformed handler at construction, not at scan time', () => {
    // Boot-time is the only place this is cheap to notice. At scan time it
    // surfaces as a mystery `unknown` on a kiosk, hours later.
    const bad = [
      [{ handle: async () => ({}) }],
      [{ namespace: '', handle: async () => ({}) }],
      [{ namespace: 42, handle: async () => ({}) }],
      [{ namespace: 'content' }],
      [{ namespace: 'content', handle: 'nope' }],
      [null],
    ];
    for (const handlers of bad) expect(() => new ScanDispatcher({ handlers })).toThrow();
  });

  it('names itself when `handlers` is not a list at all', async () => {
    // Every other registration error carries a curated `ScanDispatcher: …`
    // message. A bare `handlers is not iterable` from the for-of makes a
    // composition-root typo look like an internal fault.
    for (const handlers of [{}, 'content', 42, true]) {
      expect(() => new ScanDispatcher({ handlers })).toThrow(/^ScanDispatcher: /);
    }
    // null/undefined mean "none", not a mistake.
    expect(() => new ScanDispatcher({ handlers: undefined })).not.toThrow();
  });

  it('constructs with no arguments at all', async () => {
    const d = new ScanDispatcher();
    expect(d.namespaces).toEqual([]);
    expect((await d.dispatch()).status).toBe('unknown');
  });

  it('exposes the registered namespaces', () => {
    const d = new ScanDispatcher({
      handlers: [
        { namespace: 'content', handle: async () => ({}) },
        { namespace: 'school', handle: async () => ({}) },
      ],
    });
    expect(d.namespaces).toEqual(['content', 'school']);
  });
});

describe('ScanDispatcher — the handler cannot corrupt the Outcome', () => {
  it('does not let a handler spoof the domain it answered for', async () => {
    // Attribution is the dispatcher's to assign. A content handler reporting
    // `domain: 'school'` would make the caller print a worksheet for a scan
    // school never saw — and would make every log line untrustworthy.
    const liar = {
      namespace: 'content',
      handle: async () => ({ status: 'ok', domain: 'school', physical: 'worksheet' }),
    };
    const d = new ScanDispatcher({ handlers: [liar], logger: silent });
    const out = await d.dispatch({ code: 'go:a:b' });
    expect(out.domain).toBe('content');
    // Everything else it returns still wins — only attribution is reserved.
    expect(out.physical).toBe('worksheet');
  });

  it('cannot spoof the domain on the failure path either', async () => {
    const liar = {
      namespace: 'content',
      handle: async () => { const e = new Error('x'); e.domain = 'school'; throw e; },
    };
    const d = new ScanDispatcher({ handlers: [liar], logger: silent });
    expect((await d.dispatch({ code: 'go:a:b' })).domain).toBe('content');
  });

  it('treats a non-object return as no fields, leaving the defaults intact', async () => {
    // `undefined` is what an async function with no `return` produces, and it
    // is the likeliest of these in practice. A string is the nastiest: it
    // spreads to {0:'o',1:'k'} and would decorate the Outcome with numeric keys.
    for (const bad of [undefined, null, 'ok', 42, true, ['ok'], Symbol('ok')]) {
      const d = new ScanDispatcher({
        handlers: [{ namespace: 'content', handle: async () => bad }], logger: silent,
      });
      const out = await d.dispatch({ code: 'go:a:b' });
      expect(out).toEqual({
        status: 'unknown', ok: true, domain: 'content', message: '',
        physical: 'none', printed: false, effect: null,
      });
    }
  });

  it('accepts a null-prototype partial outcome', async () => {
    const d = new ScanDispatcher({
      handlers: [{
        namespace: 'content',
        handle: async () => Object.assign(Object.create(null), { status: 'ok' }),
      }],
      logger: silent,
    });
    expect((await d.dispatch({ code: 'go:a:b' })).status).toBe('ok');
  });

  it('returns a fresh Outcome each time, so one caller cannot poison the next', async () => {
    const d = new ScanDispatcher({ handlers: [], logger: silent });
    const a = await d.dispatch({ code: '!!!' });
    a.status = 'mutated';
    a.effect = { evil: true };
    const b = await d.dispatch({ code: '!!!' });
    expect(b.status).toBe('unknown');
    expect(b.effect).toBe(null);
  });

  it('never lets a handler mutate state shared with the next dispatch', async () => {
    // The handler args are built fresh per dispatch (`{...parsed, device, route}`
    // over a fresh parse), so a handler that scribbles on its argument — which
    // is easy to do accidentally, e.g. normalising `body` in place — cannot
    // reach the next scan. Read the body BEFORE the mutation, or the handler
    // clobbers the very object the assertion is inspecting.
    const bodies = [];
    const args = [];
    const d = new ScanDispatcher({
      handlers: [{
        namespace: 'content',
        handle: async (a) => {
          bodies.push(a.body);
          args.push(a);
          a.body = 'CLOBBERED';
          a.namespace = 'school';
          return { status: 'ok' };
        },
      }],
      logger: silent,
    });
    const first = await d.dispatch({ code: 'go:a:b', device: 'k' });
    const second = await d.dispatch({ code: 'go:a:b', device: 'k' });
    expect(bodies).toEqual(['a:b', 'a:b']);
    expect(args[0]).not.toBe(args[1]);
    // Nor can it retroactively change how the dispatcher attributed the scan.
    expect(first.domain).toBe('content');
    expect(second.domain).toBe('content');
  });
});

describe('ScanDispatcher — the never-fall-through invariant', () => {
  const CODES = [
    'go:office:plex:1', 'cmd:office:volume:30', 'nut:dl:4', 'sch:a7f3k2',
    'dl:4', 'ct:teapot', 'rs:clear', 'living-room:plex:1', '9780306406157',
    '041260010682', 'pause', 'gibberish', ':4', '::', ':', 'go:', 'ct:', '',
    '   ', '\r\n', 'constructor:foo', '__proto__:x', 'NUT:dl:4', '9'.repeat(10000),
    null, undefined, 42, {}, [], () => {}, Symbol('s'), NaN, Infinity, 0n,
  ];
  const ROUTES = [undefined, null, 'content', 'nutribot', 'school', 'nope', '__proto__'];

  it('always resolves to a well-formed Outcome, for every code x route', async () => {
    const kinds = ['worksheet', 'receipt', 'none'];
    const d = new ScanDispatcher({
      handlers: [
        { namespace: 'content', handle: async () => ({ status: 'ok' }) },
        { namespace: 'nutrition', handle: async () => { throw new Error('boom'); } },
        { namespace: 'school', handle: async () => undefined },
        { namespace: 'product', handle: async () => ({ status: 'logged', printed: true }) },
      ],
      routeFallback: { content: 'content', nutribot: 'nutrition', school: 'school' },
      logger: silent,
    });
    for (const code of CODES) {
      for (const route of ROUTES) {
        const out = await d.dispatch({ code, device: 'k', route });
        expect(typeof out.status).toBe('string');
        expect(out.status.length).toBeGreaterThan(0);
        expect(out.domain === null || typeof out.domain === 'string').toBe(true);
        expect(typeof out.message).toBe('string');
        expect(kinds).toContain(out.physical);
        expect(typeof out.printed).toBe('boolean');
        expect(typeof out.ok).toBe('boolean');
        // Every default key is ALWAYS present. A handler may add its own on
        // top (that is what makes `effect` a convention rather than a cage),
        // so this is a superset check, not an equality one — but nothing in
        // the guaranteed set may ever go missing.
        expect(Object.keys(out)).toEqual(expect.arrayContaining(DEFAULT_KEYS));
      }
    }
  });

  it('never rejects, whatever the handler does', async () => {
    const throwers = [
      () => { throw new Error('async boom'); },
      () => { throw 'a bare string'; },           // eslint-disable-line no-throw-literal
      () => { throw null; },                       // eslint-disable-line no-throw-literal
      () => Promise.reject(new Error('rejected')),
      () => { throw { message: 'plain object' }; }, // eslint-disable-line no-throw-literal
    ];
    for (const impl of throwers) {
      const d = new ScanDispatcher({
        handlers: [{ namespace: 'content', handle: impl }], logger: silent,
      });
      const out = await d.dispatch({ code: 'go:a:b' });
      expect(out.status).toBe('failed');
      expect(out.domain).toBe('content');
      expect(out.message).toBeTruthy();
    }
  });

  it('handles a SYNCHRONOUSLY throwing handle(), not just a rejected promise', async () => {
    // `handle` is only contractually async. A non-async function that throws
    // does so before any promise exists, so `await` never sees it — the try
    // block has to wrap the CALL, not just the await.
    const d = new ScanDispatcher({
      handlers: [{ namespace: 'content', handle() { throw new Error('sync boom'); } }],
      logger: silent,
    });
    const out = await d.dispatch({ code: 'go:a:b' });
    expect(out).toMatchObject({ status: 'failed', domain: 'content' });
    expect(out.message).toContain('sync boom');
  });

  it('survives a handler whose RETURN VALUE throws when read', async () => {
    // Found while probing the logger fix. Catching the handler CALL is not
    // enough: the outcome is built by spreading what the handler returned, and
    // a spread invokes getters. A booby-trapped result therefore throws at the
    // `return` statement — after the try has closed — and rejects the dispatch.
    // Exotic, but it is the same class of bug as the logger one: a step that
    // looks like plumbing sits outside the guard.
    //
    // Reporting it as `failed` is the honest answer, because it IS a handler
    // fault — the handler's own return value is what exploded.
    const evil = {
      namespace: 'content',
      handle: async () => ({ get status() { throw new Error('getter boom'); } }),
    };
    const d = new ScanDispatcher({ handlers: [evil], logger: silent });
    const out = await d.dispatch({ code: 'go:a:b', device: 'k' });
    expect(out.status).toBe('failed');
    expect(out.domain).toBe('content');
    expect(out.message).toContain('getter boom');
  });

  it('survives a handler whose THROWN value is unreadable', async () => {
    // The mirror of the return-value case above, and the same trust boundary:
    // a handler's thrown value is no more trustworthy than its returned one.
    // `#failed` is called FROM the catch blocks, so it runs outside every try,
    // and reading `err.message` there is what rejects.
    const cases = [
      ['message getter', () => { throw { get message() { throw new Error('msg boom'); } }; }],
      ['hostile proxy', () => { throw new Proxy({}, { get() { throw new Error('proxy boom'); } }); }],
    ];
    for (const [label, handle] of cases) {
      const d = new ScanDispatcher({ handlers: [{ namespace: 'content', handle }], logger: silent });
      const out = await d.dispatch({ code: 'go:a:b', device: 'k' });
      expect(out, label).toMatchObject({ status: 'failed', domain: 'content', ok: false });
      expect(typeof out.message, label).toBe('string');
    }
  });

  it('survives a hostile proxy as the handler result', async () => {
    const hostile = {
      namespace: 'content',
      handle: async () => new Proxy({}, {
        ownKeys() { throw new Error('proxy boom'); },
        get() { throw new Error('proxy boom'); },
      }),
    };
    const d = new ScanDispatcher({ handlers: [hostile], logger: silent });
    await expect(d.dispatch({ code: 'go:a:b' })).resolves.toMatchObject({
      status: 'failed', domain: 'content',
    });
  });

  it('handles a handler that returns a non-promise', async () => {
    const d = new ScanDispatcher({
      handlers: [{ namespace: 'content', handle: () => ({ status: 'ok' }) }], logger: silent,
    });
    expect((await d.dispatch({ code: 'go:a:b' })).status).toBe('ok');
  });

  it('distinguishes nothing-claimed-it from nobody-is-wired-for-it', async () => {
    // Both are `unknown`, and a caller has to tell them apart WITHOUT parsing
    // prose: the first is a bad sticker, the second is a deployment gap.
    const d = new ScanDispatcher({ handlers: [], logger: silent });
    const unclaimed = await d.dispatch({ code: 'gibberish' });
    const unwired = await d.dispatch({ code: 'sch:a7f3k2' });
    expect(unclaimed).toMatchObject({ status: 'unknown', domain: null });
    expect(unwired).toMatchObject({ status: 'unknown', domain: 'school' });
    expect(unwired.message).toContain('school');
  });
});

describe('ScanDispatcher — logging and pass-through', () => {
  it('tolerates a missing or partial logger', async () => {
    for (const logger of [null, undefined, {}, { warn: null }, 'nope']) {
      const d = new ScanDispatcher({ handlers: [], logger });
      expect((await d.dispatch({ code: '!!!' })).status).toBe('unknown');
    }
  });

  it('survives a logger that throws, on every path', async () => {
    // Checking that a log method EXISTS is not the same as checking it
    // BEHAVES. Three paths fail for three different structural reasons:
    //
    //   A unclaimed  — the warn emit sits outside any try at all
    //   B no-handler — likewise
    //   C success    — the debug emit sits INSIDE the try that decides the
    //                  outcome, so a logger fault is caught by the handler's
    //                  own catch. Even with a well-behaved `error` emit that
    //                  would downgrade a SUCCESSFUL scan to `failed`; with a
    //                  broken one the second throw escapes entirely.
    //
    // The default `console` hides all of this, because Node's console swallows
    // write errors — so it would first appear in production wiring, where
    // composition injects a real structured logger.
    const ok = { namespace: 'content', handle: async () => ({ status: 'dispatched' }) };
    const d = new ScanDispatcher({ handlers: [ok], logger: brokenLogger });

    await expect(d.dispatch({ code: '!!!', device: 'k' }))
      .resolves.toMatchObject({ status: 'unknown' });
    await expect(d.dispatch({ code: 'sch:abc', device: 'k' }))
      .resolves.toMatchObject({ status: 'unknown' });
    await expect(d.dispatch({ code: 'go:a:b', device: 'k' }))
      .resolves.toMatchObject({ status: 'dispatched' });
  });

  it('still reports a handler failure when the logger is also broken', async () => {
    // Both the handler and the observability channel are down, which is
    // precisely when the caller most needs the Outcome to be truthful: it must
    // still learn that the handler failed AND why. Losing the message here
    // would leave a user staring at a scanner that did nothing, with no trace
    // anywhere of the reason.
    const boom = { namespace: 'content', handle: async () => { throw new Error('nope'); } };
    const d = new ScanDispatcher({ handlers: [boom], logger: brokenLogger });
    const out = await d.dispatch({ code: 'go:a:b', device: 'k' });
    expect(out.status).toBe('failed');
    expect(out.message).toContain('nope');
  });

  it('does not let a broken logger corrupt an otherwise good Outcome', async () => {
    // Not just "does not reject": the Outcome must be byte-for-byte what a
    // working logger would have produced. A dispatcher that cannot log is
    // still a dispatcher.
    const impl = async () => ({ status: 'printed', physical: 'worksheet', printed: true });
    const withGood = new ScanDispatcher({
      handlers: [{ namespace: 'school', handle: impl }], logger: silent,
    });
    const withBroken = new ScanDispatcher({
      handlers: [{ namespace: 'school', handle: impl }], logger: brokenLogger,
    });
    expect(await withBroken.dispatch({ code: 'sch:a7f3k2', device: 'k' }))
      .toEqual(await withGood.dispatch({ code: 'sch:a7f3k2', device: 'k' }));
  });

  it('logs the unclaimed, unwired and thrown paths', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const d = new ScanDispatcher({
      handlers: [{ namespace: 'content', handle: async () => { throw new Error('x'); } }],
      logger,
    });
    await d.dispatch({ code: 'gibberish', device: 'k' });
    await d.dispatch({ code: 'sch:a', device: 'k' });
    await d.dispatch({ code: 'go:a:b', device: 'k' });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toMatchObject({ namespace: 'content', device: 'k' });
  });

  it('logs the status it actually returned, reading each field exactly once', async () => {
    // The log must never disagree with what the caller got, or debugging a
    // production scan means reasoning about which of two readings won. The
    // spread materialises every getter ONCE; logging then reads the merged
    // plain object rather than re-entering the handler's result. An unstable
    // getter is the cheapest way to prove the read happens once and only once.
    let reads = 0;
    const drifting = {
      namespace: 'content',
      handle: async () => ({ get status() { reads += 1; return reads === 1 ? 'ok' : 'DRIFTED'; } }),
    };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const d = new ScanDispatcher({ handlers: [drifting], logger });
    const out = await d.dispatch({ code: 'go:a:b', device: 'k' });
    expect(out.status).toBe('ok');
    expect(logger.debug).toHaveBeenCalledWith('scan-handled', expect.objectContaining({
      status: 'ok',
    }));
    expect(reads).toBe(1);
  });

  it('passes device and route through to the handler untouched', async () => {
    const school = { namespace: 'school', handle: vi.fn(async () => ({ status: 'printed' })) };
    const d = new ScanDispatcher({ handlers: [school], logger: silent });
    await d.dispatch({ code: '  sch:a7f3k2\r\n', device: 'kitchen', route: 'school' });
    expect(school.handle).toHaveBeenCalledWith({
      namespace: 'school', body: 'a7f3k2', raw: 'sch:a7f3k2', form: 'prefixed',
      device: 'kitchen', route: 'school',
    });
  });

  it('does not trim the body — that is the handler\'s job, deliberately', async () => {
    // Carry-forward from Task 3: `trim()` cleans the outer edges of the input,
    // so a space that is leading in the bare form is INTERIOR in the prefixed
    // form and survives. Trimming here would silently change what `go:` means
    // for every domain at once, which is exactly the coupling ScanCode's body
    // convention exists to prevent. Pinned so the next reader sees it is a
    // decision, not an oversight.
    const content = { namespace: 'content', handle: vi.fn(async () => ({ status: 'ok' })) };
    const d = new ScanDispatcher({ handlers: [content], logger: silent });
    await d.dispatch({ code: 'go: living-room:plex:1' });
    expect(content.handle).toHaveBeenCalledWith(
      expect.objectContaining({ body: ' living-room:plex:1' }),
    );
  });

  it('is reusable and stateless across dispatches', async () => {
    const content = { namespace: 'content', handle: vi.fn(async () => ({ status: 'ok' })) };
    const d = new ScanDispatcher({ handlers: [content], logger: silent });
    const outs = await Promise.all([
      d.dispatch({ code: 'go:a' }), d.dispatch({ code: '!!!' }), d.dispatch({ code: 'go:b' }),
    ]);
    expect(outs.map((o) => o.status)).toEqual(['ok', 'unknown', 'ok']);
  });
});
