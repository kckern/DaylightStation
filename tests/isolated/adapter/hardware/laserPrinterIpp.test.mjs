import { describe, it, expect } from 'vitest';
import { OPS, encodeRequest, decodeResponse, printJobAttrs } from '../../../../backend/src/1_adapters/hardware/laser-printer/ipp.mjs';

describe('IPP encodeRequest', () => {
  it('emits version 1.1, the operation, request-id, and the document after end-of-attributes', () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const buf = encodeRequest(OPS.PRINT_JOB, printJobAttrs('ipp://p:631/ipp/print', { user: 'felix', jobName: 'ws' }), pdf, 7);

    expect(buf.readUInt8(0)).toBe(1);
    expect(buf.readUInt8(1)).toBe(1);
    expect(buf.readUInt16BE(2)).toBe(OPS.PRINT_JOB);
    expect(buf.readUInt32BE(4)).toBe(7);
    // charset MUST be first (RFC 8011): tag 0x47, name attributes-charset
    expect(buf.readUInt8(8)).toBe(0x01); // operation-attributes group
    expect(buf.readUInt8(9)).toBe(0x47);
    expect(buf.toString('utf8', 12, 12 + 18)).toBe('attributes-charset');
    // document bytes follow the 0x03 end tag, verbatim
    const end = buf.indexOf(0x03, 8);
    expect(buf.subarray(buf.length - pdf.length).equals(pdf)).toBe(true);
    expect(end).toBeGreaterThan(8);
  });

  it('single-copy jobs carry no copies attribute; multi-copy jobs do', () => {
    const one = encodeRequest(OPS.PRINT_JOB, printJobAttrs('ipp://p/ipp/print', { user: 'u', jobName: 'j', copies: 1 }));
    const three = encodeRequest(OPS.PRINT_JOB, printJobAttrs('ipp://p/ipp/print', { user: 'u', jobName: 'j', copies: 3 }));
    expect(one.includes('copies')).toBe(false);
    expect(three.includes('copies')).toBe(true);
  });
});

describe('IPP decodeResponse', () => {
  function attr(tag, name, valueBuf) {
    const n = Buffer.from(name);
    const head = Buffer.alloc(3);
    head.writeUInt8(tag, 0);
    head.writeUInt16BE(n.length, 1);
    const vlen = Buffer.alloc(2);
    vlen.writeUInt16BE(valueBuf.length);
    return Buffer.concat([head, n, vlen, valueBuf]);
  }

  it('reads status, integers, enums, and strings; ok for the successful-ok family', () => {
    const int = Buffer.alloc(4); int.writeInt32BE(42);
    const en = Buffer.alloc(4); en.writeInt32BE(3);
    const head = Buffer.from([1, 1, 0x00, 0x00, 0, 0, 0, 7]); // status successful-ok
    const body = Buffer.concat([
      Buffer.from([0x02]), // job-attributes group
      attr(0x21, 'job-id', int),
      attr(0x23, 'printer-state', en),
      attr(0x44, 'printer-state-reasons', Buffer.from('none')),
      Buffer.from([0x03]),
    ]);
    const out = decodeResponse(Buffer.concat([head, body]));
    expect(out.ok).toBe(true);
    expect(out.attrs['job-id']).toEqual([42]);
    expect(out.attrs['printer-state']).toEqual([3]);
    expect(out.attrs['printer-state-reasons']).toEqual(['none']);
  });

  it('a client-error status decodes as not ok', () => {
    const head = Buffer.from([1, 1, 0x04, 0x00, 0, 0, 0, 1, 0x03]); // client-error-bad-request
    expect(decodeResponse(head).ok).toBe(false);
    expect(decodeResponse(head).statusCode).toBe(0x0400);
  });
});
