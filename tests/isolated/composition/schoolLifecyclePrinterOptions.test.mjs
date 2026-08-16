// @vitest-environment node
//
// The printer options `school.yml` declares must reach the adapter the SCHOOL
// LIFECYCLE constructs — not just the one `app.mjs` builds for `PrintService`.
//
// There are two `LaserPrinterAdapter` construction sites. This is the one whose
// adapter is injected into `IssueDocument` and `ReplaceLostAnswerSheet`, i.e.
// the path every tracked worksheet and quiz prints through. When it was built
// with only `host`/`port`/`path`, an operator setting `printing: { duplex:
// false }` per the docs got no effect at all on the path that matters most, and
// nothing was logged to say so. Nothing else in the suite pins this: the real
// adapter is private to the container, so the constructor call itself is what
// gets asserted.
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Constructor args of every real LaserPrinterAdapter the container builds. */
const built = [];

vi.mock('#adapters/hardware/laser-printer/LaserPrinterAdapter.mjs', () => ({
  LaserPrinterAdapter: class {
    constructor(opts) {
      built.push(opts);
      this.opts = opts;
    }

    get printerUri() { return `ipp://${this.opts.host}/ipp/print`; }

    async printPdf() { return { ok: true, bytes: 0, copies: 1, duplex: this.opts.duplex }; }

    async getStatus() { return { state: 'idle', stateReasons: [], name: 'stub', model: 'stub', accepting: true }; }

    async ping() { return true; }
  },
}));

const { createSchoolLifecycle } = await import('#composition/modules/schoolLifecycle.mjs');

const silent = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => silent,
};

let dataDir;

beforeEach(async () => {
  built.length = 0;
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'school-printer-opts-'));
});
afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

const wire = (schoolConfig) => createSchoolLifecycle({
  configService: {
    getHouseholdAppConfig: () => schoolConfig,
    getDataDir: () => dataDir,
    getHouseholdPath: (rel) => `${dataDir}/household/${rel}`,
    getDeviceConfig: () => null,
  },
  schoolService: { listBanks: () => [], getBank: () => null },
  eventBus: { broadcast() {}, onClientMessage() {}, subscribe() {} },
  logger: silent,
});

describe('school lifecycle → LaserPrinterAdapter options', () => {
  it('defaults the lifecycle printer to duplex ON / LONGEDGE', async () => {
    const result = await wire({ lifecycle: { enabled: true }, printing: { host: 'printer.local' } });
    expect(result.wired).toBe(true);
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ host: 'printer.local', duplex: true, binding: 'LONGEDGE' });
  });

  it('passes printing.duplex:false through to the adapter the use cases print with', async () => {
    await wire({
      lifecycle: { enabled: true },
      printing: { host: 'printer.local', duplex: false },
    });
    expect(built).toHaveLength(1);
    expect(built[0].duplex).toBe(false);
  });

  it('passes a configured binding through', async () => {
    await wire({
      lifecycle: { enabled: true },
      printing: { host: 'printer.local', binding: 'SHORTEDGE' },
    });
    expect(built[0].binding).toBe('SHORTEDGE');
  });

  it('resolves duplex/binding the same way app.mjs does', async () => {
    // app.mjs: `duplex: printing?.duplex ?? true`, `binding: printing?.binding || 'LONGEDGE'`.
    // `??` (not `||`) on duplex is what makes `false` expressible at all.
    await wire({
      lifecycle: { enabled: true },
      printing: { host: 'printer.local', duplex: false, binding: '' },
    });
    expect(built[0]).toMatchObject({ duplex: false, binding: 'LONGEDGE' });
  });
});
