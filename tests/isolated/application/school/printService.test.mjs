import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrintService } from '../../../../backend/src/3_applications/school/PrintService.mjs';
import { PaperCertification } from '../../../../backend/src/1_adapters/school/paper/PaperCertification.mjs';

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
    userService: { getHouseholdRoster: () => [{ id: 'learner2', name: 'learner2', birthyear: 2016 }, { id: 'dad', name: 'Papa', birthyear: 1984 }] },
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
    const r = await svc.requestPrint({ userId: 'learner2', printableId: 'caps', copies: 1 });
    expect(r.decision).toBe('printed');
    expect(printed).toHaveLength(1);
    expect(store.log).toHaveLength(1);
    expect(store.log[0]).toMatchObject({ userId: 'learner2', pages: 2, printableId: 'caps' });
  });
});

describe('PrintService.requestPrint — over quota', () => {
  it('does NOT print; files a pending approval request', async () => {
    const { deps, store, printed } = makeDeps();
    store.log.push({ at: new Date(T0 - 5 * 60000).toISOString(), userId: 'learner2', pages: 4, printableId: 'caps' });
    const svc = new PrintService(deps);
    const r = await svc.requestPrint({ userId: 'learner2', printableId: 'caps', copies: 1 }); // 4 + 2 = 6 > 5
    expect(r.decision).toBe('approval');
    expect(printed).toHaveLength(0);
    expect(store.pending).toHaveLength(1);
    expect(store.pending[0]).toMatchObject({ userId: 'learner2', printableId: 'caps', pages: 2, status: 'pending' });
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
    await expect(svc.requestPrint({ userId: 'learner2', printableId: 'nope' })).rejects.toThrow();
  });

  it('denies an oversized job outright (no print, no pending)', async () => {
    const { deps, store, printed } = makeDeps();
    deps.worksheetRenderer.renderBankWorksheet = vi.fn(async () => ({ pdf: Buffer.from('%PDF-'), pageCount: 30 }));
    const svc = new PrintService(deps);
    const r = await svc.requestPrint({ userId: 'learner2', printableId: 'caps' });
    expect(r.decision).toBe('deny');
    expect(printed).toHaveLength(0);
    expect(store.pending).toHaveLength(0);
  });

  it('multiplies pages by copies for the quota check', async () => {
    const { deps } = makeDeps();
    const svc = new PrintService(deps);
    const r = await svc.requestPrint({ userId: 'learner2', printableId: 'caps', copies: 3 }); // 2*3 = 6 > 5
    expect(r.decision).toBe('approval');
    expect(r.pages).toBe(6);
  });
});

describe('PrintService.approve / deny', () => {
  it('approve prints the pending job, moves it out of pending, and logs it', async () => {
    const { deps, store, printed } = makeDeps();
    store.pending = [{ id: 'req1', userId: 'learner2', printableId: 'caps', copies: 1, pages: 2, status: 'pending', at: new Date(T0).toISOString() }];
    const svc = new PrintService(deps);
    const r = await svc.approve({ requestId: 'req1', approver: 'dad' });
    expect(r.decision).toBe('printed');
    expect(printed).toHaveLength(1);
    expect(store.pending).toHaveLength(0);
    expect(store.log.at(-1)).toMatchObject({ userId: 'learner2', pages: 2, approvedBy: 'dad' });
  });

  it('deny prints nothing and KEEPS the row as a denied record the child can see (advocacy wave 7)', async () => {
    const { deps, store, printed } = makeDeps();
    store.pending = [{ id: 'req1', userId: 'learner2', printableId: 'caps', copies: 1, pages: 2, status: 'pending', at: new Date(T0).toISOString() }];
    const svc = new PrintService(deps);
    const r = await svc.deny({ requestId: 'req1', approver: 'dad' });
    expect(r.decision).toBe('denied');
    expect(printed).toHaveLength(0);
    expect(store.pending).toHaveLength(1);
    expect(store.pending[0]).toMatchObject({ id: 'req1', status: 'denied', deniedBy: 'dad' });
    // …and it is no longer offered on the parent's approval surface.
    expect(svc.listPending()).toHaveLength(0);
  });

  it('approving an unknown request throws', async () => {
    const { deps } = makeDeps();
    const svc = new PrintService(deps);
    await expect(svc.approve({ requestId: 'ghost', approver: 'dad' })).rejects.toThrow();
  });

  it('only an adult may approve (a child cannot self-approve)', async () => {
    const { deps, store } = makeDeps();
    store.pending = [{ id: 'req1', userId: 'learner2', printableId: 'caps', copies: 1, pages: 2, status: 'pending', at: new Date(T0).toISOString() }];
    const svc = new PrintService(deps);
    await expect(svc.approve({ requestId: 'req1', approver: 'learner2' })).rejects.toThrow(/grown-?up|adult|permission/i);
  });
});

describe('PrintService.listPrintables — paper certification gate', () => {
  const paperProfile = {
    surfaceId: 'paper-letter-mono', family: 'paper', liveness: 'static',
    capabilities: [
      'reader@1', 'examples@1', 'quiz@1', 'problems@1', 'flashcards@1',
      'image@1', 'math@1', 'table-layout@1', 'scan-action@1',
      'response.choice@1', 'response.asset-choice@1', 'return.scan@1',
    ],
    limits: { omrChannels: 12, maxItemsPerSheet: 25, maxPagesPerDocument: 20 },
  };
  const choiceBank = { id: 'mc-bank', items: [
    { id: 'q1', type: 'multiple_choice', prompt: 'p', choices: ['a', 'b', 'c'], answer: 'a' },
  ] };
  const textBank = { id: 'sa-bank', items: [
    { id: 'q1', type: 'short_answer', prompt: 'p', answer: 'x' },
  ] };
  const CERT_CONFIG = {
    printing: { windowMinutes: 60, pagesPerWindow: 5, maxPagesPerJob: 20 },
    printables: [
      { id: 'mc', label: 'Multiple Choice Quiz', type: 'bank', bankId: 'mc-bank' },
      { id: 'sa', label: 'Short Answer Quiz', type: 'bank', bankId: 'sa-bank' },
      { id: 'flyer', label: 'Field Trip Flyer', type: 'pdf', file: 'flyer.pdf' },
    ],
  };

  function makeCertDeps({ paperCertifyBank } = {}) {
    return {
      config: CERT_CONFIG,
      datastore: { readPrintLog: () => [], appendPrintLog: () => {}, readPrintPending: () => [], savePrintPending: () => {} },
      printerAdapter: { printPdf: vi.fn() },
      worksheetRenderer: { renderBankWorksheet: vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4'), pageCount: 1 })) },
      bankReader: { getBank: vi.fn((id) => (id === 'mc-bank' ? choiceBank : (id === 'sa-bank' ? textBank : null))) },
      pdfReader: { read: vi.fn(() => ({ pdf: Buffer.from('%PDF-1.4 file'), pageCount: 3 })) },
      userService: { getHouseholdRoster: () => [] },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      now: () => T0,
      paperCertifyBank,
    };
  }

  it('excludes a bank whose items are incompatible with paper, keeps the conforming bank + pdf, logs the exclusion with reasons', async () => {
    const port = new PaperCertification();
    const deps = makeCertDeps({ paperCertifyBank: (bank) => port.certifyBank(bank, paperProfile) });
    const svc = new PrintService(deps);
    const list = await svc.listPrintables();
    expect(list.map((p) => p.id)).toEqual(['mc', 'flyer']);
    expect(deps.logger.warn).toHaveBeenCalledWith('print.printable-excluded', expect.objectContaining({
      printableId: 'sa', bankId: 'sa-bank', reasons: expect.arrayContaining([expect.stringMatching(/response\.text@1/)]),
    }));
  });

  it('with paperCertifyBank: null, all printables are returned unfiltered (legacy path unchanged)', async () => {
    const deps = makeCertDeps({ paperCertifyBank: null });
    const svc = new PrintService(deps);
    const list = await svc.listPrintables();
    expect(list.map((p) => p.id)).toEqual(['mc', 'sa', 'flyer']);
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });
});

describe('PrintService.getQuota', () => {
  it('reports pages used and remaining in the window for a user', () => {
    const { deps, store } = makeDeps();
    store.log.push({ at: new Date(T0 - 10 * 60000).toISOString(), userId: 'learner2', pages: 3 });
    store.log.push({ at: new Date(T0 - 90 * 60000).toISOString(), userId: 'learner2', pages: 5 }); // outside window
    store.log.push({ at: new Date(T0 - 5 * 60000).toISOString(), userId: 'other', pages: 2 }); // other user
    const svc = new PrintService(deps);
    const q = svc.getQuota('learner2');
    expect(q.pagesInWindow).toBe(3);
    expect(q.remaining).toBe(2);
    expect(q.pagesPerWindow).toBe(5);
  });
});
