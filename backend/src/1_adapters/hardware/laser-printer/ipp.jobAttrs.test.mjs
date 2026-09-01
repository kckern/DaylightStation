import { describe, expect, it } from 'vitest';
import { OPS, baseAttrs, encodeRequest, jobAttrsRequest } from './ipp.mjs';

describe('Get-Job-Attributes request', () => {
  it('exposes the operation code', () => {
    expect(OPS.GET_JOB_ATTRIBUTES).toBe(0x0009);
  });

  it('appends an integer job-id after the standard preamble', () => {
    const attrs = jobAttrsRequest('ipp://p:631/ipp/print', { user: 'daylight', jobId: 42 });
    const base = baseAttrs('ipp://p:631/ipp/print', 'daylight');
    expect(attrs.slice(0, base.length)).toEqual(base);
    const last = attrs[attrs.length - 1];
    expect(last.name).toBe('job-id');
    expect(last.value).toBe(42);
    expect(last.tag).toBe(0x21); // INTEGER
  });

  it('encodes to a well-formed IPP request', () => {
    const body = encodeRequest(
      OPS.GET_JOB_ATTRIBUTES,
      jobAttrsRequest('ipp://p:631/ipp/print', { user: 'daylight', jobId: 42 }),
      null, 7,
    );
    expect(body.readUInt8(0)).toBe(1);              // IPP major
    expect(body.readUInt16BE(2)).toBe(0x0009);      // operation
    expect(body.readUInt32BE(4)).toBe(7);           // request id
    expect(body.includes(Buffer.from('job-id'))).toBe(true);
    expect(body[body.length - 1]).toBe(0x03);       // END tag
  });

  it('refuses a non-integer job id rather than encoding nonsense', () => {
    expect(() => jobAttrsRequest('ipp://p:631/ipp/print', { user: 'u', jobId: null }))
      .toThrow(/job-id/);
  });
});
