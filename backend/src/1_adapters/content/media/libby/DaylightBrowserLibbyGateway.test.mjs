import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaylightBrowserLibbyGateway } from './DaylightBrowserLibbyGateway.mjs';

const input = { webUrl: 'https://fixture.listen.libbyapp.com/book/', message: 'm=opaque', operationId: 'libby-bootstrap-abcdef' };
const spine = () => ({ title: 'Book', subtitle: null, author: null, narrator: null, duration: 60,
  parts: [{ key: 'part-1-mp3', index: 0, title: 'Part 1', duration: 60, contentLength: 1200,
    mimeType: 'audio/mpeg', upstreamUrl: 'https://audioclips.cdn.overdrive.com/signed/part-1', headers: {} }] });
const fixture = (fetch, options = {}) => new DaylightBrowserLibbyGateway({ baseUrl: 'http://daylight-browser:3000', fetch, ...options });

afterEach(() => vi.useRealTimers());
describe('DaylightBrowserLibbyGateway', () => {
  it('posts only the typed capability to the exact private endpoint', async () => {
    const fetch = vi.fn(async () => Response.json(spine()));
    const result = await fixture(fetch).bootstrapLoan(input);
    expect(fetch).toHaveBeenCalledWith('http://daylight-browser:3000/v1/operations/libby.bootstrap-loan', expect.objectContaining({
      method: 'POST', body: JSON.stringify(input), redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: expect.any(AbortSignal),
    }));
    expect(result).toEqual(spine());
    expect(JSON.stringify(result)).not.toMatch(/cookie|token|storage/i);
  });

  it.each(['https://daylight-browser:3000', 'http://public.example', 'http://8.8.8.8', 'http://169.254.169.254',
    'http://daylight-browser:3000/path', 'http://daylight-browser:3000/?x=1', 'http://daylight-browser:3000/#fragment',
    'http://user:password@daylight-browser:3000', 'file:///tmp/browser', 'invalid'])('rejects unsafe base %s', baseUrl => {
    expect(() => fixture(vi.fn(), { baseUrl })).toThrow('private HTTP');
  });

  it.each(['http://127.0.0.1:3000', 'http://10.0.0.2:3000', 'http://172.16.0.2:3000', 'http://192.168.0.2:3000', 'http://[::1]:3000'])('accepts private literal %s', async baseUrl => {
    const fetch = vi.fn(async () => Response.json(spine()));
    await fixture(fetch, { baseUrl }).bootstrapLoan(input);
    expect(fetch.mock.calls[0][0]).toBe(`${baseUrl}/v1/operations/libby.bootstrap-loan`);
  });

  it.each([{ ...input, token: 'jwt-secret' }, { ...input, message: 'x'.repeat(32769) }, { ...input, webUrl: 'https://evil.test/' },
    { ...input, webUrl: 'https://fixture.listen.libbyapp.com/book/?secret=1' }, { ...input, message: '?m=x' },
    { ...input, operationId: 'bad/id' }])('rejects invalid input before any I/O', async value => {
    const fetch = vi.fn();
    await expect(fixture(fetch).bootstrapLoan(value)).rejects.toMatchObject({ code: 'BOOTSTRAP_INVALID_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    value => ({ ...value, cookies: ['secret'] }),
    value => ({ ...value, parts: [{ ...value.parts[0], token: 'secret' }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], headers: { Cookie: 'secret' } }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], encryption: true }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], mimeType: 'audio/mp4' }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], index: 3 }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], upstreamUrl: 'https://evil.test/a.mp3' }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], upstreamUrl: 'https://sibling.audioclips.cdn.overdrive.com/a.mp3' }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], upstreamUrl: 'https://audioclips.cdn.overdrive.com:444/a.mp3' }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], duration: -1 }] }),
    value => ({ ...value, parts: [{ ...value.parts[0], key: 'invalid/key' }] }),
    value => ({ ...value, parts: Array(1001).fill(value.parts[0]) }),
    value => ({ ...value, parts: [value.parts[0], { ...value.parts[0], index: 1 }] }),
    value => ({ ...value, title: 'x'.repeat(4097) }),
  ])('rejects malformed or extra response capabilities', async mutate => {
    await expect(fixture(async () => Response.json(mutate(spine()))).bootstrapLoan(input))
      .rejects.toMatchObject({ code: 'BOOTSTRAP_INVALID_RESPONSE' });
  });

  it.each([
    () => new Response('secret', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{secret', { headers: { 'content-type': 'application/json' } }),
    () => new Response(' ', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } }),
    () => new Response(' '.repeat(1048577), { headers: { 'content-type': 'application/json' } }),
  ])('bounds and validates JSON bodies', async reply => {
    await expect(fixture(async () => reply()).bootstrapLoan(input)).rejects.toMatchObject({ code: 'BOOTSTRAP_INVALID_RESPONSE' });
  });

  it.each([[302, 'BOOTSTRAP_UNAVAILABLE'], [409, 'BOOTSTRAP_BUSY'], [422, 'BOOTSTRAP_UNSUPPORTED'], [504, 'BOOTSTRAP_TIMEOUT']])('maps status %s without exposing bodies', async (status, code) => {
    const error = await fixture(async () => new Response('jwt-secret cookie secret-url', { status })).bootstrapLoan(input).catch(error => error);
    expect(error.code).toBe(code);
    expect(String(error)).not.toMatch(/jwt-secret|cookie|secret-url/);
    expect(error.cause).toBeUndefined();
  });

  it('redacts network error detail', async () => {
    const error = await fixture(async () => { throw new Error('jwt-secret signed-url'); }).bootstrapLoan(input).catch(error => error);
    expect(error.code).toBe('BOOTSTRAP_UNAVAILABLE');
    expect(String(error)).not.toMatch(/jwt-secret|signed-url/);
  });

  it('enforces a deadline even when fetch ignores its abort signal', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    const result = fixture(fetch, { timeoutMs: 25 }).bootstrapLoan(input).catch(error => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ code: 'BOOTSTRAP_TIMEOUT' });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('default gateway deadline outlives the sidecar HTTP budget', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise(() => {}));
    const result = fixture(fetch).bootstrapLoan(input).catch(error => error);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toMatchObject({ code: 'BOOTSTRAP_TIMEOUT' });
    expect(() => fixture(fetch, { timeoutMs: 90_001 })).toThrow('bounded deadline');
  });

  it('bounds a stalled response body and cancels it on deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const result = fixture(async () => new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } }), { timeoutMs: 25 })
      .bootstrapLoan(input).catch(error => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ code: 'BOOTSTRAP_TIMEOUT' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('honors both an already aborted and an in-flight caller signal', async () => {
    const first = new AbortController(); first.abort();
    const fetch = vi.fn(() => new Promise(() => {}));
    await expect(fixture(fetch).bootstrapLoan(input, { signal: first.signal })).rejects.toMatchObject({ code: 'BOOTSTRAP_ABORTED' });
    expect(fetch).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = fixture(fetch).bootstrapLoan(input, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'BOOTSTRAP_ABORTED' });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
