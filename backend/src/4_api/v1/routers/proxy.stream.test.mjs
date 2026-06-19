import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteHlsPlaylist, isBlockedStreamHost, safeStreamFetch } from './proxy.mjs';

// Minimal fake Response factory for the injectable fetchFn.
function fakeResponse({ status = 200, location, body = 'ok' } = {}) {
  const headers = new Map();
  if (location !== undefined) headers.set('location', location);
  return {
    status,
    body,
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
  };
}

test('rewrites relative + absolute segment/variant URIs through the proxy', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=1',
    'sub/variant.m3u8',
    '#EXTINF:6,',
    'https://cdn.x/seg1.ts',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.x/key"',
  ].join('\n');
  const out = rewriteHlsPlaylist(playlist, 'https://cdn.x/live/index.m3u8', 'soccerfull');
  assert.match(out, /\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Flive%2Fsub%2Fvariant\.m3u8&profile=soccerfull/);
  assert.match(out, /\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Fseg1\.ts&profile=soccerfull/);
  assert.match(out, /URI="\/api\/v1\/proxy\/stream\?src=https%3A%2F%2Fcdn\.x%2Fkey&profile=soccerfull"/);
  assert.match(out, /#EXTINF:6,/);
});

test('SSRF guard blocks internal hosts, allows public', () => {
  assert.equal(isBlockedStreamHost('localhost'), true);
  assert.equal(isBlockedStreamHost('127.0.0.1'), true);
  assert.equal(isBlockedStreamHost('10.0.0.5'), true);
  assert.equal(isBlockedStreamHost('192.168.1.9'), true);
  assert.equal(isBlockedStreamHost('foo.local'), true);
  assert.equal(isBlockedStreamHost('cdn.soccerfull.net'), false);
});

test('safeStreamFetch blocks a redirect to an internal host', async () => {
  let calls = 0;
  const fetchFn = async (url) => {
    calls++;
    // First (allowed public) hop 302-redirects to a private IP.
    return fakeResponse({ status: 302, location: 'http://10.0.0.5/x' });
  };
  await assert.rejects(
    () => safeStreamFetch('https://cdn.x/live.m3u8', { fetchFn }),
    (err) => {
      assert.equal(err.code, 'STREAM_BLOCKED_HOST');
      assert.equal(err.host, '10.0.0.5');
      assert.equal(err.via, 'redirect');
      // Confirm the guard was the cause.
      assert.equal(isBlockedStreamHost(err.host), true);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test('safeStreamFetch blocks a redirect to the cloud metadata endpoint', async () => {
  const fetchFn = async () =>
    fakeResponse({ status: 307, location: 'http://169.254.169.254/latest/meta-data/' });
  await assert.rejects(
    () => safeStreamFetch('https://cdn.x/live.m3u8', { fetchFn }),
    (err) => err.code === 'STREAM_BLOCKED_HOST' && err.host === '169.254.169.254'
  );
});

test('safeStreamFetch follows a redirect to a public host and returns the final response', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (urls.length === 1) {
      return fakeResponse({ status: 302, location: 'https://cdn2.x/final.m3u8' });
    }
    return fakeResponse({ status: 200, body: 'FINAL' });
  };
  const resp = await safeStreamFetch('https://cdn.x/live.m3u8', { fetchFn });
  assert.equal(resp.status, 200);
  assert.equal(resp.body, 'FINAL');
  assert.deepEqual(urls, ['https://cdn.x/live.m3u8', 'https://cdn2.x/final.m3u8']);
});

test('safeStreamFetch resolves a relative Location against the current URL', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (urls.length === 1) {
      return fakeResponse({ status: 301, location: '/cdn/final.m3u8' });
    }
    return fakeResponse({ status: 200, body: 'REL' });
  };
  const resp = await safeStreamFetch('https://cdn.x/live/index.m3u8', { fetchFn });
  assert.equal(resp.body, 'REL');
  assert.deepEqual(urls, ['https://cdn.x/live/index.m3u8', 'https://cdn.x/cdn/final.m3u8']);
});

test('safeStreamFetch throws after exceeding the redirect hop cap', async () => {
  let n = 0;
  const fetchFn = async () => {
    n++;
    // Always redirect to a fresh public host → infinite loop, capped by maxRedirects.
    return fakeResponse({ status: 302, location: `https://cdn${n}.public.net/next` });
  };
  await assert.rejects(
    () => safeStreamFetch('https://cdn0.public.net/start', { fetchFn, maxRedirects: 3 }),
    (err) => err.code === 'STREAM_TOO_MANY_REDIRECTS'
  );
  // maxRedirects=3 → hops 0..3 inclusive = 4 fetch attempts before throwing.
  assert.equal(n, 4);
});

test('safeStreamFetch returns a non-redirect response without extra fetches', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return fakeResponse({ status: 200, body: 'DIRECT' });
  };
  const resp = await safeStreamFetch('https://cdn.x/seg1.ts', { fetchFn });
  assert.equal(resp.body, 'DIRECT');
  assert.equal(calls, 1);
});
