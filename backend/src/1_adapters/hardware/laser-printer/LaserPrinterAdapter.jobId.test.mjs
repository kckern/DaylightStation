import {
  afterEach, describe, expect, it,
} from 'vitest';
import { LaserPrinterAdapter } from './LaserPrinterAdapter.mjs';
import { decodeResponse } from './ipp.mjs';

/**
 * Encode a single IPP attribute (tag + name + value), same wire shape as
 * ipp.mjs's internal `attr()` helper (not exported, so this is a local copy
 * for fixture-building only).
 */
function attr(tag, name, valueBuf) {
  const nameBuf = Buffer.from(name, 'utf8');
  const out = Buffer.alloc(1 + 2 + nameBuf.length + 2 + valueBuf.length);
  let o = 0;
  out.writeUInt8(tag, o); o += 1;
  out.writeUInt16BE(nameBuf.length, o); o += 2;
  nameBuf.copy(out, o); o += nameBuf.length;
  out.writeUInt16BE(valueBuf.length, o); o += 2;
  valueBuf.copy(out, o);
  return out;
}

const int32Value = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};

/**
 * Fake IPP response: status 0x0000 (successful-ok), a printer-attributes
 * group naming `document-format-supported: application/pdf` (so printPdf's
 * capability negotiation picks the direct-PDF container and never needs to
 * rasterize — no ghostscript in this test), followed by a job-attributes
 * group carrying `job-id: 42`. This same response body is returned for
 * every #ipp() round trip printPdf makes (Get-Printer-Attributes,
 * Validate-Job, Print-Job) — all three read out fine from it: capabilities
 * negotiation reads document-format-supported, Validate-Job only cares
 * about the status code (ok), and Print-Job reads job-id.
 *
 * Group tag 0x04 = printer-attributes, 0x02 = job-attributes, 0x49 =
 * mime-type value tag, 0x21 = integer value tag, 0x03 = end-of-attributes
 * (RFC 8010 §3.5).
 */
function fakeIppResponseBody() {
  return Buffer.concat([
    Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]), // version/status/request-id
    Buffer.from([0x04]), // printer-attributes group
    attr(0x49, 'document-format-supported', Buffer.from('application/pdf', 'utf8')),
    Buffer.from([0x02]), // job-attributes group
    attr(0x21, 'job-id', int32Value(42)),
    Buffer.from([0x03]), // end-of-attributes
  ]);
}

function makeAdapterWithFakeTransport(responseBody) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => responseBody.buffer.slice(
      responseBody.byteOffset, responseBody.byteOffset + responseBody.byteLength,
    ),
  });
  // `host` is the only required constructor argument (LaserPrinterAdapter.mjs:157-165).
  return new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
}

afterEach(() => { delete globalThis.fetch; });

describe('IPP job id retention', () => {
  it('the fixture decodes to job-id 42 (sanity check on the hand-built buffer)', () => {
    const decoded = decodeResponse(fakeIppResponseBody());
    expect(decoded.attrs['job-id']).toEqual([42]);
  });

  it('returns the job-id the printer assigned', async () => {
    const adapter = makeAdapterWithFakeTransport(fakeIppResponseBody());
    const result = await adapter.printPdf(Buffer.from('%PDF-1.4\n'), { jobName: 't' });
    expect(result.jobId).toBe(42);
  });
});
