import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import { LaserPrinterAdapter, pjlWrap } from '../../../../backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs';

const PDF = Buffer.from('%PDF-1.4\n... fake worksheet ...\n%%EOF');

/** Let the sink's 'end' handler run before reading what it captured. */
const flush = () => new Promise((res) => setTimeout(res, 20));

let server;
afterEach(() => { if (server) { server.close(); server = null; } });

function rawSink() {
  return new Promise((resolve) => {
    const received = [];
    server = net.createServer((sock) => {
      const chunks = [];
      sock.on('data', (c) => chunks.push(c));
      sock.on('end', () => { received.push(Buffer.concat(chunks)); });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, received }));
  });
}

describe('LaserPrinterAdapter.printPdf (raw 9100)', () => {
  it('streams the PDF bytes to the raw port and resolves on clean close', async () => {
    const { port, received } = await rawSink();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', rawPort: port, logger: { info() {} } });
    const r = await p.printPdf(PDF, { jobName: 't', user: 'learner-two' });
    expect(r.ok).toBe(true);
    // `bytes` is the wire payload: the PDF plus the PJL duplex envelope.
    expect(r.bytes).toBe(pjlWrap(PDF, { jobName: 't', duplex: true, binding: 'LONGEDGE' }).length);
    await flush(); // let the server flush 'end'
    expect(received[0].includes(PDF)).toBe(true); // PDF bytes travel untouched
  });

  it('sends N copies as N concatenated documents inside ONE PJL envelope', async () => {
    const { port, received } = await rawSink();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', rawPort: port, logger: { info() {} } });
    const r = await p.printPdf(PDF, { copies: 3 });
    expect(r.copies).toBe(3);
    await flush();
    const sent = received[0];
    expect(sent.length).toBe(r.bytes);
    // Three documents, one envelope — not three envelopes.
    expect(sent.toString('latin1').split('%PDF-1.4')).toHaveLength(4);
    expect(sent.toString('latin1').split('@PJL JOB')).toHaveLength(2);
    expect(sent.length).toBe(
      pjlWrap(Buffer.concat([PDF, PDF, PDF]), { jobName: 'daylight-print', duplex: true, binding: 'LONGEDGE' }).length,
    );
  });

  it('rejects a non-PDF buffer before opening a socket', async () => {
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', rawPort: 1, logger: { info() {} } });
    await expect(p.printPdf(Buffer.from('not a pdf'))).rejects.toThrow(/not a PDF/i);
  });

  it('rejects an empty buffer', async () => {
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', rawPort: 1, logger: { info() {} } });
    await expect(p.printPdf(Buffer.alloc(0))).rejects.toThrow(/non-empty/i);
  });

  it('surfaces a connection failure as an InfrastructureError', async () => {
    // port 9 (discard) is unlikely to be listening on the test host; use a
    // closed port to force ECONNREFUSED quickly.
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', rawPort: 1, printTimeout: 2000, logger: { info() {} } });
    await expect(p.printPdf(PDF)).rejects.toThrow(/raw print failed/i);
  });
});

describe('LaserPrinterAdapter duplex (PJL wrapping)', () => {
  /** Print once against a live sink and hand back the exact bytes that hit the wire. */
  async function sendAndCapture(adapterOpts = {}, jobOpts = {}) {
    const { port, received } = await rawSink();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', rawPort: port, logger: { info() {} }, ...adapterOpts });
    const result = await p.printPdf(PDF, jobOpts);
    await flush();
    return { result, sent: received[0], text: received[0].toString('latin1') };
  }

  it('defaults to duplex ON with LONGEDGE binding, wrapped in a PJL preamble/trailer', async () => {
    const { result, sent, text } = await sendAndCapture({}, { jobName: 'test-job' });
    expect(text).toContain('@PJL SET DUPLEX=ON');
    expect(text).toContain('@PJL SET BINDING=LONGEDGE');
    expect(text).toContain('@PJL JOB NAME="test-job"');
    expect(text).toContain('%PDF-'); // the real PDF bytes are still in there, untouched
    // Exact envelope: UEL ... ENTER LANGUAGE=PDF, payload, UEL EOJ UEL.
    expect(text.startsWith(
      '\x1B%-12345X@PJL JOB NAME="test-job"\r\n'
      + '@PJL SET DUPLEX=ON\r\n'
      + '@PJL SET BINDING=LONGEDGE\r\n'
      + '@PJL ENTER LANGUAGE=PDF\r\n',
    )).toBe(true);
    expect(text.endsWith('\r\n\x1B%-12345X@PJL EOJ\r\n\x1B%-12345X')).toBe(true);
    // The document survives byte-for-byte between the preamble and the trailer.
    const start = sent.indexOf(PDF);
    expect(start).toBeGreaterThan(0);
    expect(sent.subarray(start, start + PDF.length).equals(PDF)).toBe(true);
    expect(result.duplex).toBe(true);
  });

  it('duplex can be disabled per-adapter (config-driven)', async () => {
    const { result, text } = await sendAndCapture({ duplex: false }, { jobName: 'test-job' });
    expect(text).toContain('@PJL SET DUPLEX=OFF');
    expect(text).not.toContain('BINDING=');
    expect(result.duplex).toBe(false);
  });

  it('duplex can be disabled per-job, overriding the adapter default', async () => {
    const { result, text } = await sendAndCapture({}, { jobName: 'test-job', duplex: false });
    expect(text).toContain('@PJL SET DUPLEX=OFF');
    expect(text).not.toContain('BINDING=');
    expect(result.duplex).toBe(false);
  });

  it('duplex can be re-enabled per-job on a single-sided-by-default adapter', async () => {
    const { text } = await sendAndCapture({ duplex: false }, { duplex: true, binding: 'SHORTEDGE' });
    expect(text).toContain('@PJL SET DUPLEX=ON');
    expect(text).toContain('@PJL SET BINDING=SHORTEDGE');
  });

  it('honors a configured SHORTEDGE binding default', async () => {
    const { text } = await sendAndCapture({ binding: 'SHORTEDGE' });
    expect(text).toContain('@PJL SET BINDING=SHORTEDGE');
  });

  it('keeps a hostile job name from breaking out of the PJL header', async () => {
    const { text } = await sendAndCapture({}, { jobName: 'a"b\r\n@PJL SET DUPLEX=OFF' });
    expect(text).toContain("@PJL JOB NAME=\"a'b  @PJL SET DUPLEX=OFF\"");
    expect(text).toContain('@PJL SET DUPLEX=ON');
    expect(text).not.toContain('\r\n@PJL SET DUPLEX=OFF');
  });
});
