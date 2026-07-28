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
    const out = await d.dispatch({ code: 'greenbeans', device: 'k', route: 'nutribot' });
    expect(out.domain).toBe('nutrition');
  });

  it('does not let the reader route override a shape-resolved barcode', async () => {
    // The plan's draft of the test above used `041260010682` as its "says
    // nothing" fixture, which was true before shape detection existed. It is
    // not any more, and the design doc is explicit that step 5 is a "last
    // resort for anything STILL UNRESOLVED" and that a bare UPC "goes to the
    // product lookup exactly as today". So the route must NOT reclaim it.
    //
    // This is the same principle as a prefixed code: what the code says beats
    // where it was scanned, or one sticker means different things in different
    // rooms. It matters most for `book` — an ISBN scanned at the fridge is
    // still a book, not a food.
    const nutrition = handler('nutrition', async () => ({ status: 'logged' }));
    const product = handler('product', async () => ({ status: 'looked-up' }));
    const book = handler('book', async () => ({ status: 'shelved' }));
    const d = new ScanDispatcher({
      handlers: [nutrition, product, book], routeFallback: { nutribot: 'nutrition' },
    });
    const upc = await d.dispatch({ code: '041260010682', device: 'k', route: 'nutribot' });
    expect(upc.domain).toBe('product');
    const isbn = await d.dispatch({ code: '9780306406157', device: 'k', route: 'nutribot' });
    expect(isbn.domain).toBe('book');
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
});
