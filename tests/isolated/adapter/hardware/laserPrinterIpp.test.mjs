import { describe, it, expect } from 'vitest';
import { OPS, encodeRequest, decodeResponse, printJobAttrs } from '../../../../backend/src/1_adapters/hardware/laser-printer/ipp.mjs';

describe('IPP encodeRequest', () => {
  it('emits version 1.1, the operation, request-id, and the document after end-of-attributes', () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const buf = encodeRequest(OPS.PRINT_JOB, printJobAttrs('ipp://p:631/ipp/print', { user: 'learner-two', jobName: 'ws', documentFormat: 'application/pdf' }), pdf, 7);

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

  it('requires an explicit documentFormat — no silent octet-stream default', () => {
    // This is the guard against the incident: octet-stream ("printer,
    // please guess") is what let a raw PDF through to a printer with no PDF
    // interpreter, which guessed "plain text" and printed the PDF source.
    // printJobAttrs refuses to paper over a missing negotiated format.
    expect(() => printJobAttrs('ipp://p/ipp/print', { user: 'u', jobName: 'j' })).toThrow(/documentFormat/i);
  });

  it('encodes exactly the negotiated document-format — never a substituted default', () => {
    const urf = encodeRequest(OPS.PRINT_JOB, printJobAttrs('ipp://p/ipp/print', { user: 'u', jobName: 'j', documentFormat: 'image/urf' }));
    expect(urf.includes('image/urf')).toBe(true);
    expect(urf.includes('application/octet-stream')).toBe(false);
    expect(urf.includes('application/pdf')).toBe(false);

    const pdf = encodeRequest(OPS.PRINT_JOB, printJobAttrs('ipp://p/ipp/print', { user: 'u', jobName: 'j', documentFormat: 'application/pdf' }));
    expect(pdf.includes('application/pdf')).toBe(true);
    expect(pdf.includes('image/urf')).toBe(false);
  });

  it('single-copy jobs carry no copies attribute; multi-copy jobs do', () => {
    const one = encodeRequest(OPS.PRINT_JOB, printJobAttrs('ipp://p/ipp/print', { user: 'u', jobName: 'j', copies: 1, documentFormat: 'image/urf' }));
    const three = encodeRequest(OPS.PRINT_JOB, printJobAttrs('ipp://p/ipp/print', { user: 'u', jobName: 'j', copies: 3, documentFormat: 'image/urf' }));
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

  it('decodes a resolution attribute (xres/yres/units) structurally, not as a mangled string', () => {
    // RFC 8011 §5.1.14: 9 octets — xres(4) yres(4) units(1). This backs DPI
    // selection (negotiate.mjs's chooseResolution) reading
    // printer-resolution-supported/-default off the wire.
    const res = Buffer.alloc(9);
    res.writeInt32BE(300, 0);
    res.writeInt32BE(300, 4);
    res.writeUInt8(3, 8); // dots/inch
    const head = Buffer.from([1, 1, 0x00, 0x00, 0, 0, 0, 1]);
    const body = Buffer.concat([Buffer.from([0x02]), attr(0x32, 'printer-resolution-default', res), Buffer.from([0x03])]);
    const out = decodeResponse(Buffer.concat([head, body]));
    expect(out.attrs['printer-resolution-default']).toEqual([{ xres: 300, yres: 300, units: 3 }]);
  });
});
