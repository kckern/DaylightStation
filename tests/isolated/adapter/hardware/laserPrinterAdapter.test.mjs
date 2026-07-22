import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';
import { LaserPrinterAdapter } from '../../../../backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs';

const PDF = Buffer.from('%PDF-1.4\n... fake worksheet ...\n%%EOF');

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
    const r = await p.printPdf(PDF, { jobName: 't', user: 'felix' });
    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(PDF.length);
    await new Promise((res) => setTimeout(res, 20)); // let the server flush 'end'
    expect(received[0].equals(PDF)).toBe(true);
  });

  it('sends N copies as N concatenated documents', async () => {
    const { port, received } = await rawSink();
    const p = new LaserPrinterAdapter({ host: '127.0.0.1', rawPort: port, logger: { info() {} } });
    const r = await p.printPdf(PDF, { copies: 3 });
    expect(r.copies).toBe(3);
    expect(r.bytes).toBe(PDF.length * 3);
    await new Promise((res) => setTimeout(res, 20));
    expect(received[0].length).toBe(PDF.length * 3);
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
