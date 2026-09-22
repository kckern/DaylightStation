import { describe, expect, it, vi } from 'vitest';
import { LibraryMediaBootstrapService } from './LibraryMediaBootstrapService.mjs';

const input = { webUrl: 'https://fixture.listen.libbyapp.com/book/', message: 'm=opaque', operationId: 'libby-bootstrap-abcdef' };
const spine = { title: 'Book', subtitle: null, author: null, narrator: null, duration: 60,
  parts: [{ key: 'part-1', index: 0, title: 'Part 1', duration: 60, contentLength: null,
    mimeType: 'audio/mpeg', upstreamUrl: 'https://fixture.listen.libbyapp.com/book/1.mp3', headers: {} }] };

describe('LibraryMediaBootstrapService', () => {
  it('maps the structural gateway port to an opened immutable spine', async () => {
    const bootstrapLoan = vi.fn(async () => spine);
    const signal = new AbortController().signal;
    const result = await new LibraryMediaBootstrapService({ bootstrapGateway: { bootstrapLoan } }).open(input, { signal });
    expect(bootstrapLoan).toHaveBeenCalledWith(input, { signal });
    expect(result).toEqual({ kind: 'opened', ...spine });
    expect(Object.isFrozen(result.parts[0])).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/cookie|token|storage/i);
  });

  it.each([['BOOTSTRAP_TIMEOUT', 'timeout'], ['BOOTSTRAP_BUSY', 'busy'], ['BOOTSTRAP_ABORTED', 'aborted'],
    ['BOOTSTRAP_UNSUPPORTED', 'unsupported'], ['BOOTSTRAP_INVALID_RESPONSE', 'upstream_error'], ['UNEXPECTED', 'upstream_error']])('categorizes %s without leaking detail', async (code, kind) => {
    const service = new LibraryMediaBootstrapService({ bootstrapGateway: { bootstrapLoan: async () => { throw Object.assign(new Error('secret'), { code }); } } });
    expect(await service.open(input)).toEqual({ kind });
  });

  it('rejects extra gateway capabilities even for a structurally valid port', async () => {
    const service = new LibraryMediaBootstrapService({ bootstrapGateway: { bootstrapLoan: async () => ({ ...spine, storage: 'secret' }) } });
    expect(await service.open(input)).toEqual({ kind: 'upstream_error' });
  });

  it('never forwards an unrelated input field', async () => {
    const bootstrapLoan = vi.fn();
    const service = new LibraryMediaBootstrapService({ bootstrapGateway: { bootstrapLoan } });
    expect(await service.open({ ...input, token: 'secret' })).toEqual({ kind: 'invalid_request' });
    expect(bootstrapLoan).not.toHaveBeenCalled();
  });
});
