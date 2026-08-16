import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VirtualLaserPrinterAdapter } from '#adapters/hardware/laser-printer/VirtualLaserPrinterAdapter.mjs';

/** Minimal but structurally real PDF: `n` page objects the house sniffer can count. */
const makePdf = (pages = 1) => {
  const body = Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`).join('');
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n${body}%%EOF\n`, 'latin1');
};

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let captureDir, printer;

beforeEach(async () => {
  captureDir = await mkdtemp(path.join(os.tmpdir(), 'virt-laser-'));
  printer = new VirtualLaserPrinterAdapter({ captureDir, logger: silent });
});

afterEach(async () => {
  await rm(captureDir, { recursive: true, force: true });
});

describe('construction', () => {
  it('requires a captureDir, the way the real adapter requires a host', () => {
    let err;
    try { new VirtualLaserPrinterAdapter({}); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.name).toBe('InfrastructureError');
    expect(err.code).toBe('MISSING_DEPENDENCY');
    expect(err.context.dependency).toBe('captureDir');
  });
});

describe('printPdf — happy path', () => {
  it('resolves the real adapter return shape {ok, bytes, copies, duplex}', async () => {
    const pdf = makePdf(2);
    const res = await printer.printPdf(pdf, { jobName: 'worksheet', user: 'kid1' });
    expect(res).toEqual({ ok: true, bytes: pdf.length, copies: 1, duplex: true });
  });

  it('counts copies as N concatenated documents, like JetDirect does', async () => {
    const pdf = makePdf(1);
    const res = await printer.printPdf(pdf, { copies: 3 });
    expect(res).toEqual({ ok: true, bytes: pdf.length * 3, copies: 3, duplex: true });
  });

  it('floors and clamps copies to at least 1', async () => {
    const pdf = makePdf(1);
    expect((await printer.printPdf(pdf, { copies: 0 })).copies).toBe(1);
    expect((await printer.printPdf(pdf, { copies: 2.7 })).copies).toBe(2);
  });

  it('writes a {jobId}.pdf and a {jobId}.json sidecar per job', async () => {
    await printer.printPdf(makePdf(3), { jobName: 'agenda', user: 'kid1', copies: 2 });
    const files = (await readdir(captureDir)).sort();
    expect(files).toHaveLength(2);
    const [jsonFile, pdfFile] = files;
    expect(path.extname(jsonFile)).toBe('.json');
    expect(path.extname(pdfFile)).toBe('.pdf');
    expect(path.basename(jsonFile, '.json')).toBe(path.basename(pdfFile, '.pdf'));

    const sidecar = JSON.parse(await readFile(path.join(captureDir, jsonFile), 'utf8'));
    expect(sidecar).toMatchObject({
      jobId: path.basename(jsonFile, '.json'),
      pageCount: 3,
      requestedBy: 'kid1',
      copies: 2,
      jobName: 'agenda',
    });
    expect(sidecar.bytes).toBe(makePdf(3).length * 2);
    expect(Date.parse(sidecar.at)).not.toBeNaN();
  });

  it('the captured .pdf holds one readable copy of the document', async () => {
    const pdf = makePdf(1);
    await printer.printPdf(pdf, { copies: 4 });
    const [job] = printer.listJobs();
    const captured = await readFile(path.join(captureDir, `${job.jobId}.pdf`));
    expect(captured.equals(pdf)).toBe(true);
  });

  it('records duplex/binding in the job sidecar, defaulting to true/LONGEDGE', async () => {
    await printer.printPdf(makePdf(1), { jobName: 'x' });
    const [job] = printer.listJobs();
    expect(job.duplex).toBe(true);
    expect(job.binding).toBe('LONGEDGE');
    const sidecar = JSON.parse(await readFile(path.join(captureDir, `${job.jobId}.json`), 'utf8'));
    expect(sidecar).toMatchObject({ duplex: true, binding: 'LONGEDGE' });
  });

  it('records a single-sided / short-edge job as asked, without applying it', async () => {
    const pdf = makePdf(1);
    const res = await printer.printPdf(pdf, { jobName: 'x', duplex: false, binding: 'SHORTEDGE' });
    expect(res.duplex).toBe(false);
    const [job] = printer.listJobs();
    expect(job).toMatchObject({ duplex: false, binding: 'SHORTEDGE' });
    // No PJL envelope here — the capture stays a plain, readable PDF.
    const captured = await readFile(path.join(captureDir, `${job.jobId}.pdf`));
    expect(captured.equals(pdf)).toBe(true);
  });

  it('derives pageCount by counting /Type /Page and never /Type /Pages', async () => {
    await printer.printPdf(makePdf(5));
    expect(printer.listJobs()[0].pageCount).toBe(5);
  });

  it('reports at least one page for a PDF with no countable page objects', async () => {
    await printer.printPdf(Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'));
    expect(printer.listJobs()[0].pageCount).toBe(1);
  });
});

describe('printPdf — input validation mirrors the real adapter', () => {
  it('rejects a non-Buffer document with INVALID_DOCUMENT', async () => {
    await expect(printer.printPdf('not a buffer')).rejects.toMatchObject({
      name: 'InfrastructureError', code: 'INVALID_DOCUMENT',
    });
  });

  it('rejects an empty buffer with INVALID_DOCUMENT', async () => {
    await expect(printer.printPdf(Buffer.alloc(0))).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  });

  it('rejects bytes that do not start with %PDF-', async () => {
    await expect(printer.printPdf(Buffer.from('GIF89a'))).rejects.toMatchObject({
      code: 'INVALID_DOCUMENT',
      message: 'document is not a PDF',
    });
  });

  it('writes nothing to the capture dir when validation rejects', async () => {
    await printer.printPdf(Buffer.from('GIF89a')).catch(() => {});
    expect(await readdir(captureDir)).toEqual([]);
  });
});

describe('listJobs / readJob', () => {
  it('lists jobs in submission order', async () => {
    await printer.printPdf(makePdf(1), { jobName: 'first' });
    await printer.printPdf(makePdf(1), { jobName: 'second' });
    expect(printer.listJobs().map((j) => j.jobName)).toEqual(['first', 'second']);
  });

  it('readJob returns the sidecar plus the captured PDF bytes', async () => {
    const pdf = makePdf(2);
    const { jobId } = await printer.printPdf(pdf, { jobName: 'w' }).then(() => printer.listJobs()[0]);
    const job = await printer.readJob(jobId);
    expect(job.jobId).toBe(jobId);
    expect(job.pageCount).toBe(2);
    expect(Buffer.isBuffer(job.pdf)).toBe(true);
    expect(job.pdf.equals(pdf)).toBe(true);
  });

  it('readJob returns null for an unknown job', async () => {
    expect(await printer.readJob('job_9999')).toBe(null);
  });
});

describe('getStatus / ping — healthy', () => {
  it('returns the real adapter status shape', async () => {
    const status = await printer.getStatus();
    expect(Object.keys(status).sort()).toEqual(['accepting', 'model', 'name', 'state', 'stateReasons'].sort());
    expect(status.state).toBe('idle');
    expect(status.stateReasons).toEqual([]);
    expect(status.accepting).toBe(true);
    expect(typeof status.name).toBe('string');
    expect(typeof status.model).toBe('string');
  });

  it('ping resolves true', async () => {
    expect(await printer.ping()).toBe(true);
  });
});

describe('setFault', () => {
  it('rejects an unknown fault name', () => {
    expect(() => printer.setFault('onFire')).toThrow(/offline/);
    expect(printer.getFault()).toBe(null);
  });

  it('accepts and reports offline / jam / null', () => {
    printer.setFault('offline');
    expect(printer.getFault()).toBe('offline');
    printer.setFault('jam');
    expect(printer.getFault()).toBe('jam');
    printer.setFault(null);
    expect(printer.getFault()).toBe(null);
  });
});

describe('fault: offline — drives the print-pending recovery path', () => {
  beforeEach(() => printer.setFault('offline'));

  it('printPdf rejects with the transport failure the real adapter raises', async () => {
    const err = await printer.printPdf(makePdf(1)).catch((e) => e);
    expect(err.name).toBe('InfrastructureError');
    expect(err.code).toBe('PRINT_SEND_FAILED');
    expect(err.message).toMatch(/^raw print failed: /);
    expect(err.context.host).toBeDefined();
    expect(err.context.port).toBeDefined();
  });

  it('captures nothing when the job could not be sent', async () => {
    await printer.printPdf(makePdf(1)).catch(() => {});
    expect(printer.listJobs()).toEqual([]);
    expect(await readdir(captureDir)).toEqual([]);
  });

  it('ping resolves false', async () => {
    expect(await printer.ping()).toBe(false);
  });

  it('getStatus rejects with PRINTER_STATUS_ERROR', async () => {
    await expect(printer.getStatus()).rejects.toMatchObject({
      name: 'InfrastructureError', code: 'PRINTER_STATUS_ERROR',
    });
  });

  it('clearing the fault restores printing', async () => {
    await printer.printPdf(makePdf(1)).catch(() => {});
    printer.setFault(null);
    await printer.printPdf(makePdf(1));
    expect(printer.listJobs()).toHaveLength(1);
    expect(await printer.ping()).toBe(true);
  });
});

describe('fault: jam — reachable printer, stopped transport', () => {
  beforeEach(() => printer.setFault('jam'));

  it('still accepts the bytes, because port 9100 is fire-and-forget', async () => {
    await expect(printer.printPdf(makePdf(1))).resolves.toMatchObject({ ok: true });
    expect(printer.listJobs()).toHaveLength(1);
  });

  it('surfaces the jam through getStatus, not through printPdf', async () => {
    const status = await printer.getStatus();
    expect(status.state).toBe('stopped');
    expect(status.stateReasons).toContain('media-jam');
    expect(status.accepting).toBe(false);
  });

  it('ping stays true — the network stack is fine', async () => {
    expect(await printer.ping()).toBe(true);
  });
});
