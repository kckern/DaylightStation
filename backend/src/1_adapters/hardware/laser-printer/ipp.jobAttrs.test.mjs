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

    // Locate the job-id attribute's actual position and decode its tag +
    // value structurally, so a regression in encodeRequest's
    // `tag === TAGS.INTEGER ? int32(...) : attr(...)` dispatch (e.g. the
    // request encoding job-id as a KEYWORD/text instead of an INTEGER) fails
    // this test — the ASCII-substring check above cannot catch that, since
    // both branches write the name bytes "job-id" identically.
    const nameIdx = body.indexOf(Buffer.from('job-id', 'utf8'));
    expect(nameIdx).toBeGreaterThan(-1);
    expect(body.readUInt8(nameIdx - 3)).toBe(0x21);        // tag byte: INTEGER
    expect(body.readUInt16BE(nameIdx - 2)).toBe(6);        // name length: "job-id"
    const valueLenOffset = nameIdx + 'job-id'.length;
    expect(body.readUInt16BE(valueLenOffset)).toBe(4);     // value length: int32
    expect(body.readInt32BE(valueLenOffset + 2)).toBe(42); // value: 42
  });

  it('refuses a non-integer job id rather than encoding nonsense', () => {
    expect(() => jobAttrsRequest('ipp://p:631/ipp/print', { user: 'u', jobId: null }))
      .toThrow(/job-id/);
  });
});
