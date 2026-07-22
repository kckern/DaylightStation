import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrintService } from '../../../../backend/src/3_applications/school/PrintService.mjs';

const T0 = Date.UTC(2026, 6, 22, 15, 0, 0);
const logger = { info() {}, warn() {}, error() {} };

const CONFIG = {
  printing: { windowMinutes: 60, pagesPerWindow: 5, maxPagesPerJob: 20 },
  printables: [
    { id: 'caps', label: 'State Capitals', type: 'bank', bankId: 'us-state-capitals' },
    { id: 'flyer', label: 'Field Trip Flyer', type: 'pdf', file: 'flyer.pdf' },
  ],
};

function makeDeps(overrides = {}) {
  const printed = [];
  const store = {
    log: [],
    pending: [],
    readPrintLog: () => store.log,
    appendPrintLog: (e) => { store.log.push(e); return e; },
    readPrintPending: () => store.pending,
    savePrintPending: (l) => { store.pending = l; return l; },
  };
  const deps = {
    config: CONFIG,
    datastore: store,
    printerAdapter: { printPdf: vi.fn(async (pdf, opts) => { printed.push({ pages: pdf.length, opts }); return { ok: true, jobId: printed.length }; }) },
    worksheetRenderer: { renderBankWorksheet: vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4 ws'), pageCount: 2 })) },
    bankReader: { getBank: vi.fn((id) => (id === 'us-state-capitals' ? { id, title: 'Caps', items: [{}, {}] } : null)) },
    pdfReader: { read: vi.fn(() => ({ pdf: Buffer.from('%PDF-1.4 file'), pageCount: 3 })) },
    userService: { getHouseholdRoster: () => [{ id: 'felix', name: 'Felix', birthyear: 2016 }, { id: 'dad', name: 'Papa', birthyear: 1984 }] },
    logger,
    now: () => T0,
    ...overrides,
  };
  return { deps, store, printed };
}

describe('PrintService.listPrintables', () => {
  it('returns configured printables with page counts resolved', async () => {
    const { deps } = makeDeps();
    const svc = new PrintService(deps);
    const list = await svc.listPrintables();
    expect(list.map((p) => p.id)).toEqual(['caps', 'flyer']);
    expect(list.find((p) => p.id === 'caps').pages).toBe(2); // bank worksheet
    expect(list.find((p) => p.id === 'flyer').pages).toBe(3); // pdf file
  });
});

describe('PrintService.requestPrint — under quota', () => {
  it('prints immediately and logs the job', async () => {
    const { deps, store, printed } = makeDeps();
    const svc = new PrintService(deps);
    const r = await svc.requestPrint({ userId: 'felix', printableId: 'caps', copies: 1 });
    expect(r.decision).toBe('printed');
    expect(printed).toHaveLength(1);
    expect(store.log).toHaveLength(1);
    expect(store.log[0]).toMatchObject({ userId: 'felix', pages: 2, printableId: 'caps' });
  });
});

describe('PrintService.requestPrint — over quota', () => {
  it('does NOT print; files a pending approval request', async () => {
    const { deps, store, printed } = makeDeps();
    store.log.push({ at: new Date(T0 - 5 * 60000).toISOString(), userId: 'felix', pages: 4, printableId: 'caps' });
    const svc = new PrintService(deps);
    const r = await svc.requestPrint({ userId: 'felix', printableId: 'caps', copies: 1 }); // 4 + 2 = 6 > 5
    expect(r.decision).toBe('approval');
    expect(printed).toHaveLength(0);
    expect(store.pending).toHaveLength(1);
    expect(store.pending[0]).toMatchObject({ userId: 'felix', printableId: 'caps', pages: 2, status: 'pending' });
    expect(store.pending[0].id).toBeTruthy();
  });
});

describe('PrintService.requestPrint — guards', () => {
  it('rejects a guest (no userId)', async () => {
    const { deps } = makeDeps();
    const svc = new PrintService(deps);
    await expect(svc.requestPrint({ userId: null, printableId: 'caps' })).rejects.toThrow(/sign in/i);
  });

  it('404s an unknown printable', async () => {
    const { deps } = makeDeps();
    const svc = new PrintService(deps);
    await expect(svc.requestPrint({ userId: 'felix', printableId: 'nope' })).rejects.toThrow();
  });

  it('denies an oversized job outright (no print, no pending)', async () => {
    const { deps, store, printed } = makeDeps();
    deps.worksheetRenderer.renderBankWorksheet = vi.fn(async () => ({ pdf: Buffer.from('%PDF-'), pageCount: 30 }));
    const svc = new PrintService(deps);
    const r = await svc.requestPrint({ userId: 'felix', printableId: 'caps' });
    expect(r.decision).toBe('deny');
    expect(printed).toHaveLength(0);
    expect(store.pending).toHaveLength(0);
  });

  it('multiplies pages by copies for the quota check', async () => {
    const { deps } = makeDeps();
    const svc = new PrintService(deps);
    const r = await svc.requestPrint({ userId: 'felix', printableId: 'caps', copies: 3 }); // 2*3 = 6 > 5
    expect(r.decision).toBe('approval');
    expect(r.pages).toBe(6);
  });
});

describe('PrintService.approve / deny', () => {
  it('approve prints the pending job, moves it out of pending, and logs it', async () => {
    const { deps, store, printed } = makeDeps();
    store.pending = [{ id: 'req1', userId: 'felix', printableId: 'caps', copies: 1, pages: 2, status: 'pending', at: new Date(T0).toISOString() }];
    const svc = new PrintService(deps);
    const r = await svc.approve({ requestId: 'req1', approver: 'dad' });
    expect(r.decision).toBe('printed');
    expect(printed).toHaveLength(1);
    expect(store.pending).toHaveLength(0);
    expect(store.log.at(-1)).toMatchObject({ userId: 'felix', pages: 2, approvedBy: 'dad' });
  });

  it('deny removes the pending job without printing', async () => {
    const { deps, store, printed } = makeDeps();
    store.pending = [{ id: 'req1', userId: 'felix', printableId: 'caps', copies: 1, pages: 2, status: 'pending', at: new Date(T0).toISOString() }];
    const svc = new PrintService(deps);
    const r = await svc.deny({ requestId: 'req1', approver: 'dad' });
    expect(r.decision).toBe('denied');
    expect(printed).toHaveLength(0);
    expect(store.pending).toHaveLength(0);
  });

  it('approving an unknown request throws', async () => {
    const { deps } = makeDeps();
    const svc = new PrintService(deps);
    await expect(svc.approve({ requestId: 'ghost', approver: 'dad' })).rejects.toThrow();
  });

  it('only an adult may approve (a child cannot self-approve)', async () => {
    const { deps, store } = makeDeps();
    store.pending = [{ id: 'req1', userId: 'felix', printableId: 'caps', copies: 1, pages: 2, status: 'pending', at: new Date(T0).toISOString() }];
    const svc = new PrintService(deps);
    await expect(svc.approve({ requestId: 'req1', approver: 'felix' })).rejects.toThrow(/grown-?up|adult|permission/i);
  });
});

describe('PrintService.getQuota', () => {
  it('reports pages used and remaining in the window for a user', () => {
    const { deps, store } = makeDeps();
    store.log.push({ at: new Date(T0 - 10 * 60000).toISOString(), userId: 'felix', pages: 3 });
    store.log.push({ at: new Date(T0 - 90 * 60000).toISOString(), userId: 'felix', pages: 5 }); // outside window
    store.log.push({ at: new Date(T0 - 5 * 60000).toISOString(), userId: 'other', pages: 2 }); // other user
    const svc = new PrintService(deps);
    const q = svc.getQuota('felix');
    expect(q.pagesInWindow).toBe(3);
    expect(q.remaining).toBe(2);
    expect(q.pagesPerWindow).toBe(5);
  });
});
