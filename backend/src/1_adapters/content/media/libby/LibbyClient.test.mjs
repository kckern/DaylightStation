import { describe, expect, it, vi } from 'vitest';
import { LibbyClient } from './LibbyClient.mjs';

const loan = {
  id: '9999999', cardId: '123456789', websiteId: '12', title: 'A Test Book', subtitle: 'A Test Subtitle',
  firstCreatorName: 'A. Author', description: 'A test description.',
  expireDate: '2099-10-01T00:00:00Z', type: { id: 'audiobook' },
  formats: [{ id: 'audiobook-overdrive', fulfillmentType: 'bifocal' }],
  covers: { cover510Wide: { href: 'https://img.example.test/cover.jpg' } },
};

const openbook = {
  title: 'A Test Book', creator: [{ role: 'narrator', name: 'N. Reader' }],
  nav: { toc: [{ title: 'Chapter One', path: '{PART-A}Part01.mp3#10' }] },
  spine: [
    { path: '{PART-A}Part01.mp3', 'media-type': 'audio/mpeg', 'audio-duration': 61.5, '-odread-file-bytes': 1234, '-odread-spine-position': 0, '-odread-original-path': '{PART-A}Part01.mp3' },
    { path: '{PART-B}Part02.mp3', 'media-type': 'audio/mpeg', 'audio-duration': 42, '-odread-file-bytes': 900, '-odread-spine-position': 1, '-odread-original-path': '{PART-B}Part02.mp3' },
  ],
};

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body == null ? null : JSON.stringify(body), { status, headers });
}

function clientFixture({ loan: loanOverrides = {} } = {}) {
  const calls = [];
  const activeLoan = { ...loan, ...loanOverrides };
  const fetch = vi.fn(async (url, options = {}) => {
    calls.push(url);
    if (url.endsWith('/chip/sync')) return response({ result: 'synchronized', loans: [activeLoan] });
    if (url.includes('/open/audiobook/')) return response({
      message: 'signed-message',
      urls: { web: 'https://dewey-fixture.listen.libbyapp.com/book/', openbook: 'https://dewey-fixture.listen.libbyapp.com/book/openbook.json' },
    });
    if (options.method === 'HEAD') return response(null, { headers: { 'set-cookie': 'session=opaque; Path=/; Secure' } });
    if (url.endsWith('/openbook.json')) return response(openbook);
    throw new Error(`unexpected request ${url}`);
  });
  const client = new LibbyClient({
    fetch,
    credentials: { getSnapshot: () => ({ token: 'test-token', generation: 'g1' }) },
    apiBase: 'https://sentry.libbyapp.com/',
    allowedHosts: ['sentry.libbyapp.com', '.listen.libbyapp.com'],
  });
  return { client, calls };
}

describe('LibbyClient', () => {
  describe('browser bootstrap fallback', () => {
    const input = { cardId: '123456789', titleId: '9999999' };
    const browserSpine = () => ({ kind: 'opened', title: 'Book', subtitle: null, author: null, narrator: 'N. Reader', duration: 61.5,
      parts: [{ key: 'part-a-part01-mp3', index: 0, title: 'Part 1', duration: 61.5, contentLength: 1234,
        mimeType: 'audio/mpeg', upstreamUrl: 'https://audioclips.cdn.overdrive.com/signed/part1', headers: {} }] });
    function fixture({ urls = { web: 'https://dewey-fixture.listen.libbyapp.com/book/' }, result = browserSpine(), loanOverrides = {} } = {}) {
      const open = vi.fn(async () => result);
      const fetch = vi.fn(async (url, options) => {
        if (url.endsWith('/chip/sync')) return response({ loans: [{ ...loan, ...loanOverrides }] });
        if (url.includes('/open/audiobook/')) return response({ urls, message: 'm=signed' });
        if (options.method === 'HEAD') return response(null);
        if (url.endsWith('/openbook.json')) return response(openbook);
        throw new Error('Unexpected provider request');
      });
      const client = new LibbyClient({ fetch, credentials: { getSnapshot: () => ({ token: 'jwt-secret' }) },
        allowedHosts: ['.listen.libbyapp.com'], bootstrapService: { open } });
      return { client, fetch, open };
    }

    it('opens the modern web/message response with only a generated capability operation', async () => {
      const { client, fetch, open } = fixture();
      const result = await client.openLoan(input);
      expect(result).toMatchObject({ title: loan.title, narrator: 'N. Reader', parts: [{ key: 'part-a-part01-mp3', duration: 61.5, mimeType: 'audio/mpeg', headers: {} }] });
      expect(fetch).toHaveBeenCalledTimes(2);
      const capability = open.mock.calls[0][0];
      expect(Object.keys(capability).sort()).toEqual(['message', 'operationId', 'webUrl']);
      expect(capability).toMatchObject({ webUrl: 'https://dewey-fixture.listen.libbyapp.com/book/', message: 'm=signed' });
      expect(capability.operationId).toMatch(/^libby-bootstrap-[0-9a-f-]{36}$/);
      expect(JSON.stringify(capability)).not.toMatch(/jwt-secret|123456789|9999999|auth|cookie/);
      await client.openLoan(input);
      expect(open.mock.calls[1][0].operationId).not.toBe(capability.operationId);
    });

    it('prefers a supplied valid legacy openbook and never starts the browser', async () => {
      const { client, open } = fixture({ urls: { web: 'https://dewey-fixture.listen.libbyapp.com/book/', openbook: 'https://dewey-fixture.listen.libbyapp.com/openbook.json' } });
      expect((await client.openLoan(input)).parts).toHaveLength(2);
      expect(open).not.toHaveBeenCalled();
    });

    it.each([undefined, null, ''])('preserves browser metadata when optional sync metadata is %j', async missing => {
      const result = { ...browserSpine(), subtitle: 'Browser subtitle', author: 'Browser author' };
      result.parts[0].title = 'Opening chapter';
      const { client } = fixture({ result, loanOverrides: { title: missing, subtitle: missing, firstCreatorName: missing } });
      expect(await client.openLoan(input)).toMatchObject({ title: 'Book', subtitle: 'Browser subtitle', author: 'Browser author',
        narrator: 'N. Reader', parts: [{ title: 'Opening chapter', key: 'part-a-part01-mp3' }] });
    });

    it('keeps nonempty sync metadata ahead of browser metadata', async () => {
      const { client } = fixture({ result: { ...browserSpine(), subtitle: 'Browser subtitle', author: 'Browser author' } });
      expect(await client.openLoan(input)).toMatchObject({ title: 'A Test Book', subtitle: 'A Test Subtitle', author: 'A. Author' });
    });

    it('keeps the generic part title when the normalized browser title is empty', async () => {
      const result = browserSpine(); result.parts[0].title = '';
      const { client } = fixture({ result });
      expect((await client.openLoan(input)).parts[0].title).toBe('Part 1');
    });

    it.each([null, '', ' ', {}, 'https://evil.test/openbook.json'])('rejects explicitly malformed openbook %j without fallback', async openbook => {
      const { client, open } = fixture({ urls: { web: 'https://dewey-fixture.listen.libbyapp.com/book/', openbook } });
      await expect(client.openLoan(input)).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
    });

    it.each(['upstream_error', 'timeout', 'busy', 'unsupported'])('fails closed on browser category %s', async kind => {
      const { client } = fixture({ result: { kind } });
      await expect(client.openLoan(input)).rejects.toMatchObject({ code: kind === 'unsupported' ? 'LIBBY_UNSUPPORTED_FULFILLMENT' : 'LIBBY_PROVIDER_FAILED' });
    });

    it('redacts unexpected errors thrown by the injected port', async () => {
      const { client, open } = fixture();
      open.mockRejectedValue(new Error('secret capability'));
      const error = await client.openLoan(input).catch(error => error);
      expect(error.code).toBe('LIBBY_PROVIDER_FAILED');
      expect(error.message).not.toContain('secret');
    });

    it.each([
      value => ({ ...value, parts: [] }),
      value => ({ ...value, parts: [{ ...value.parts[0], encryption: true }] }),
      value => ({ ...value, license: 'drm' }),
      value => ({ ...value, parts: [{ ...value.parts[0], mimeType: 'audio/mp4' }] }),
      value => ({ ...value, parts: [{ ...value.parts[0], upstreamUrl: 'https://evil.test/1.mp3' }] }),
      value => ({ ...value, parts: [{ ...value.parts[0], upstreamUrl: 'https://sibling.audioclips.cdn.overdrive.com/1.mp3' }] }),
      value => ({ ...value, parts: [{ ...value.parts[0], upstreamUrl: 'https://user:secret@dewey-fixture.listen.libbyapp.com/1.mp3' }] }),
      value => ({ ...value, parts: [{ ...value.parts[0], headers: { Cookie: 'secret' } }] }),
      value => ({ ...value, parts: [{ ...value.parts[0], index: 8 }] }),
      value => ({ ...value, parts: [value.parts[0], { ...value.parts[0], index: 1 }] }),
    ])('rejects malformed browser results before lease fulfillment', async mutate => {
      const { client } = fixture({ result: mutate(browserSpine()) });
      await expect(client.openLoan(input)).rejects.toThrow();
    });

    it('preserves the part key across renewed URL signatures', async () => {
      const { client, open } = fixture();
      const first = await client.openLoan(input);
      const next = browserSpine(); next.parts[0].upstreamUrl += '-renewed';
      open.mockResolvedValue(next);
      const second = await client.openLoan(input);
      expect(second.parts[0].key).toBe(first.parts[0].key);
      expect(second.parts[0].upstreamUrl).not.toBe(first.parts[0].upstreamUrl);
    });
  });

  describe('cover gateway', () => {
    const input = { cardId: '123456789', titleId: '9999999' };
    function fixture({ coverUrl = 'https://img3.od-cdn.com/a.jpg', replies = [], loanOverrides = {} } = {}) {
      const fetch = vi.fn(async (url) => url.endsWith('/chip/sync')
        ? response({ loans: [{ ...loan, ...loanOverrides, covers: { cover510Wide: { href: coverUrl } } }] })
        : replies.shift());
      const client = new LibbyClient({ fetch, credentials: { getSnapshot: () => ({ token: 'secret' }) }, coverAllowedHosts: ['.od-cdn.com'] });
      return { client, fetch };
    }
    function tracked(body = 'image', options = {}) {
      const result = new Response(body, options);
      const cancel = vi.spyOn(result.body, 'cancel');
      return { result, cancel };
    }

    it.each(['http://img3.od-cdn.com/a.jpg', 'https://img3.od-cdn.com.evil.test/a.jpg', 'https://img3.od-cdn.com:444/a.jpg', 'https://user:secret@img3.od-cdn.com/a.jpg', 'not a url', null])('rejects cover target %s', async (coverUrl) => {
      const { client, fetch } = fixture({ coverUrl });
      await expect(client.openCover(input)).rejects.toMatchObject({ code: 'LIBBY_ORIGIN_REJECTED' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each(['http://img3.od-cdn.com/a.jpg', 'https://img3.od-cdn.com.evil.test/a.jpg', 'https://img3.od-cdn.com:444/a.jpg'])('cancels redirects to forbidden target %s', async (location) => {
      const { result, cancel } = tracked('redirect', { status: 302, headers: { location } });
      const { client, fetch } = fixture({ replies: [result] });
      await expect(client.openCover(input)).rejects.toMatchObject({ code: 'LIBBY_ORIGIN_REJECTED' });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('follows three redirects without sending account credentials or provider cookies to image origins', async () => {
      const redirects = ['/b.jpg', 'https://img4.od-cdn.com/c.jpg', '/d.jpg'].map((location) => tracked('redirect', { status: 302, headers: { location, 'set-cookie': 'session=private' } }));
      const { client, fetch } = fixture({ replies: [...redirects.map(({ result }) => result), new Response('image', { headers: { 'content-type': 'image/jpeg', 'content-length': '5' } })] });
      const result = await client.openCover(input);
      expect(Object.keys(result).sort()).toEqual(['body', 'cleanup', 'contentLength', 'contentType']);
      expect(result.contentType).toBe('image/jpeg');
      expect(result.contentLength).toBe('5');
      expect(await new Response(result.body).text()).toBe('image');
      expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
      for (const [, options] of fetch.mock.calls.slice(1)) {
        expect(options.redirect).toBe('manual');
        expect(new Headers(options.headers).has('authorization')).toBe(false);
        expect(new Headers(options.headers).has('cookie')).toBe(false);
      }
      for (const { cancel } of redirects) expect(cancel).toHaveBeenCalledTimes(1);
      result.cleanup();
      expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    });

    it.each([
      ['gzip', '99', null], ['br', '99', null], ['deflate', '99', null],
      ['identity', '6', '6'], [' IDENTITY ', '6', '6'], [null, '6', '6'],
    ])('normalizes Content-Length for fetched artwork with encoding %s', async (encoding, providerLength, expectedLength) => {
      // Native fetch exposes decoded bytes but retains the encoded response headers.
      const headers = { 'content-type': 'image/svg+xml', 'content-length': providerLength };
      if (encoding) headers['content-encoding'] = encoding;
      const { client } = fixture({ replies: [new Response('<svg/>', { headers })] });
      const result = await client.openCover(input);
      try {
        expect(result.contentLength).toBe(expectedLength);
        expect(result.contentType).toBe('image/svg+xml');
        expect(await new Response(result.body).text()).toBe('<svg/>');
      } finally {
        await result.cleanup();
      }
    });

    it('cancels the fourth redirect without fetching a fifth image target', async () => {
      const redirects = Array.from({ length: 4 }, () => tracked('redirect', { status: 302, headers: { location: '/next.jpg' } }));
      const { client, fetch } = fixture({ replies: redirects.map(({ result }) => result) });
      await expect(client.openCover(input)).rejects.toMatchObject({ code: 'LIBBY_PROVIDER_FAILED' });
      expect(fetch).toHaveBeenCalledTimes(5);
      for (const { cancel } of redirects) expect(cancel).toHaveBeenCalledTimes(1);
    });

    it.each([{ status: 200, headers: { 'content-type': 'text/html' } }, { status: 502 }, { status: 302 }])('cancels a rejected provider response %j', async (options) => {
      const { result, cancel } = tracked('invalid', options);
      const { client } = fixture({ replies: [result] });
      await expect(client.openCover(input)).rejects.toMatchObject({ code: 'LIBBY_PROVIDER_FAILED' });
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('cancels an abandoned image and aborts the provider request on cleanup', async () => {
      const { result, cancel } = tracked('image', { headers: { 'content-type': 'image/png' } });
      const { client, fetch } = fixture({ replies: [result] });
      const opened = await client.openCover(input);
      await opened.cleanup();
      await opened.cleanup();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    });

    it('passes cancellation to entitlement lookup and cancels a response arriving after abort', async () => {
      const controller = new AbortController();
      const { result, cancel } = tracked('image', { headers: { 'content-type': 'image/png' } });
      const { client, fetch } = fixture();
      fetch.mockImplementationOnce(async (_url, options) => {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        return response({ loans: [ { ...loan, covers: { cover510Wide: { href: 'https://img3.od-cdn.com/a.jpg' } } } ] });
      }).mockImplementationOnce(async () => { controller.abort(); return result; });
      await expect(client.openCover({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('rejects expired loans before fetching artwork', async () => {
      const { client, fetch } = fixture({ loanOverrides: { expireDate: '2000-01-01' } });
      await expect(client.openCover(input)).rejects.toMatchObject({ code: 'LIBBY_LOAN_EXPIRED' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('matches an explicit open-link pair to an active audiobook and normalizes its parts', async () => {
    const fetch = vi.fn(async (url, options = {}) => {
      if (url.endsWith('/chip/sync')) return response({ result: 'synchronized', loans: [loan] });
      if (url.includes('/open/audiobook/card/123456789/title/9999999')) return response({
        message: 'signed-message',
        urls: { web: 'https://dewey-fixture.listen.libbyapp.com/book/', openbook: 'https://dewey-fixture.listen.libbyapp.com/book/openbook.json' },
      });
      if (options.method === 'HEAD') return response(null, { headers: { 'set-cookie': 'session=opaque; Path=/; Secure' } });
      if (url.endsWith('/openbook.json')) return response(openbook);
      throw new Error(`unexpected request ${url}`);
    });
    const client = new LibbyClient({
      fetch,
      credentials: { getSnapshot: () => ({ token: 'jwt-secret', generation: 'g1' }) },
      apiBase: 'https://sentry.libbyapp.com/',
      allowedHosts: ['sentry.libbyapp.com', '.listen.libbyapp.com'],
    });

    const result = await client.openLoan({ cardId: '123456789', titleId: '9999999' });

    expect(result).toMatchObject({
      title: 'A Test Book', subtitle: 'A Test Subtitle', author: 'A. Author', narrator: 'N. Reader',
      description: 'A test description.', expiresAt: Date.parse(loan.expireDate),
    });
    expect(result).not.toHaveProperty('websiteId');
    expect(result).not.toHaveProperty('coverUrl');
    expect(result).not.toHaveProperty('thumbnail');
    expect(result.parts.map((part) => ({ key: part.key, duration: part.duration, contentLength: part.contentLength }))).toEqual([
      { key: 'part-a-part01-mp3', duration: 61.5, contentLength: 1234 },
      { key: 'part-b-part02-mp3', duration: 42, contentLength: 900 },
    ]);
    expect(result.parts[0].upstreamUrl).toBe('https://dewey-fixture.listen.libbyapp.com/book/%7BPART-A%7DPart01.mp3');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-secret');
  });

  it('translates the matched synchronized audiobook into an active loan', async () => {
    const { client } = clientFixture();

    const result = await client.getActiveLoan({ cardId: '123456789', titleId: '9999999' });

    expect(result).toEqual({
      cardId: '123456789', titleId: '9999999', websiteId: '12', title: 'A Test Book',
      subtitle: 'A Test Subtitle', author: 'A. Author', description: 'A test description.',
      coverUrl: 'https://img.example.test/cover.jpg', expiresAt: Date.parse(loan.expireDate),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('opens the matched loan with its synchronized website_id', async () => {
    const { client, calls } = clientFixture({ loan: { websiteId: '12' } });

    await client.openLoan({ cardId: '123456789', titleId: '9999999' });

    const openUrl = calls.find((url) => url.includes('/open/audiobook/'));
    expect(new URL(openUrl).searchParams.get('website_id')).toBe('12');
  });

  it('uses the OpenBook title when synchronized loan metadata has no title', async () => {
    const { client } = clientFixture({ loan: { title: undefined } });

    const result = await client.openLoan({ cardId: '123456789', titleId: '9999999' });

    expect(result.title).toBe('A Test Book');
  });

  it.each(['web', 'openbook'])('rejects missing %s fulfillment identity before requesting a synthetic URL', async (missing) => {
    const urls = { web: 'https://fixture.listen.libbyapp.com/book/', openbook: 'https://fixture.listen.libbyapp.com/book/openbook.json' };
    delete urls[missing];
    const fetch = vi.fn(async (url) => url.endsWith('/chip/sync')
      ? response({ loans: [loan] })
      : response({ message: 'fixture-message', urls }));
    const client = new LibbyClient({ fetch, credentials: { getSnapshot: () => ({ token: 'fixture-token' }) }, allowedHosts: ['.listen.libbyapp.com'] });
    await expect(client.openLoan({ cardId: '123456789', titleId: '9999999' }))
      .rejects.toMatchObject({ code: 'LIBBY_UNSUPPORTED_FULFILLMENT' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['web', 'openbook'].flatMap(field => [
    'not a url', 'undefined', '/openbook.json', '//fixture.listen.libbyapp.com/openbook.json',
    'http://fixture.listen.libbyapp.com/book/', 'https://evil.example/book/',
    'https://fixture.listen.libbyapp.com:444/book/', 'https://user:secret@fixture.listen.libbyapp.com/book/',
  ].map(value => [field, value])))('rejects malformed or forbidden %s identity %s before fulfillment requests', async (field, value) => {
    const urls = { web: 'https://fixture.listen.libbyapp.com/book/', openbook: 'https://fixture.listen.libbyapp.com/book/openbook.json', [field]: value };
    const fetch = vi.fn(async (url) => url.endsWith('/chip/sync')
      ? response({ loans: [loan] })
      : response({ message: 'fixture-message', urls }));
    const client = new LibbyClient({ fetch, credentials: { getSnapshot: () => ({ token: 'fixture-token' }) }, allowedHosts: ['.listen.libbyapp.com'] });
    await expect(client.openLoan({ cardId: '123456789', titleId: '9999999' }))
      .rejects.toMatchObject({ code: 'LIBBY_ORIGIN_REJECTED' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, '', {}, []])('rejects invalid websiteId %p before opening', async (websiteId) => {
    const { client, calls } = clientFixture({ loan: { websiteId } });

    await expect(client.openLoan({ cardId: '123456789', titleId: '9999999' }))
      .rejects.toMatchObject({ code: 'LIBBY_PROVIDER_FAILED' });
    expect(calls.some((url) => url.includes('/open/audiobook/'))).toBe(false);
  });

  it('rejects a loan absent from the authenticated active-loan state', async () => {
    const client = new LibbyClient({
      fetch: async () => response({ result: 'synchronized', loans: [loan] }),
      credentials: { getSnapshot: () => ({ token: 'secret', generation: 'g1' }) },
      apiBase: 'https://sentry.libbyapp.com/', allowedHosts: ['sentry.libbyapp.com'],
    });
    await expect(client.openLoan({ cardId: '123456789', titleId: 'not-active' })).rejects.toMatchObject({ code: 'LIBBY_LOAN_NOT_FOUND' });
  });

  it('rejects provider-controlled URLs outside the closed origin policy', async () => {
    const fetch = vi.fn(async (url) => {
      if (url.endsWith('/chip/sync')) return response({ loans: [loan] });
      return response({ message: 'x', urls: { web: 'https://evil.example/book/', openbook: 'https://evil.example/openbook.json' } });
    });
    const client = new LibbyClient({
      fetch, credentials: { getSnapshot: () => ({ token: 'secret', generation: 'g1' }) },
      apiBase: 'https://sentry.libbyapp.com/', allowedHosts: ['sentry.libbyapp.com', 'listen.libbyapp.com'],
    });
    await expect(client.openLoan({ cardId: '123456789', titleId: '9999999' })).rejects.toMatchObject({ code: 'LIBBY_ORIGIN_REJECTED' });
  });

  it('never follows provider redirects or non-default HTTPS ports', async () => {
    const redirectedFetch = vi.fn(async (url) => url.endsWith('/chip/sync')
      ? new Response(null, { status: 302, headers: { location: 'https://evil.example/sync' } })
      : response({ loans: [] }));
    const redirected = new LibbyClient({
      fetch: redirectedFetch, credentials: { getSnapshot: () => ({ token: 'secret' }) },
      apiBase: 'https://sentry.libbyapp.com/', allowedHosts: ['.listen.libbyapp.com'],
    });
    await expect(redirected.sync()).rejects.toMatchObject({ code: 'LIBBY_PROVIDER_FAILED' });
    expect(redirectedFetch).toHaveBeenCalledTimes(1);
    await expect(new LibbyClient({
      fetch: vi.fn(), credentials: { getSnapshot: () => ({ token: 'secret' }) },
      apiBase: 'https://sentry.libbyapp.com:444/',
    }).sync()).rejects.toMatchObject({ code: 'LIBBY_ORIGIN_REJECTED' });
  });

  it('rejects non-MP3 or license-controlled spine entries', async () => {
    const encrypted = { ...openbook, spine: [{ ...openbook.spine[0], 'media-type': 'application/vnd.apple.mpegurl', encryption: { scheme: 'drm' } }] };
    const fetch = vi.fn(async (url, options = {}) => {
      if (url.endsWith('/chip/sync')) return response({ loans: [loan] });
      if (url.includes('/open/audiobook/')) return response({ message: 'x', urls: { web: 'https://listen.libbyapp.com/book/', openbook: 'https://listen.libbyapp.com/book/openbook.json' } });
      if (options.method === 'HEAD') return response(null);
      return response(encrypted);
    });
    const client = new LibbyClient({ fetch, credentials: { getSnapshot: () => ({ token: 'secret', generation: 'g1' }) }, apiBase: 'https://sentry.libbyapp.com/', allowedHosts: ['sentry.libbyapp.com', 'listen.libbyapp.com'] });
    await expect(client.openLoan({ cardId: '123456789', titleId: '9999999' })).rejects.toMatchObject({ code: 'LIBBY_UNSUPPORTED_FULFILLMENT' });
  });
});
