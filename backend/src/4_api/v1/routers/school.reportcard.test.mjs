import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolRouter } from './school.mjs';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { DomainInvariantError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

function appWith({
  getReportCard, closeAcademicPeriod, getTeacherToday, reportCardsStore, renderReportCardPdf,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: { listBankSourceSummaries: () => [] },
    getReportCard: getReportCard ?? null,
    closeAcademicPeriod: closeAcademicPeriod ?? null,
    getTeacherToday: getTeacherToday ?? null,
    reportCardsStore: reportCardsStore ?? null,
    renderReportCardPdf: renderReportCardPdf ?? null,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  }));
  return app;
}

const CARD = {
  schema: 'school.report-card/v1', learnerId: 'kid1', period: { periodId: 'fall-2026' }, courses: [],
};

describe('GET /api/v1/school/report-card', () => {
  it('200s with the live report when wired', async () => {
    const getReportCard = { execute: vi.fn(async () => CARD) };
    const res = await request(appWith({ getReportCard }))
      .get('/api/v1/school/report-card?learnerId=kid1&periodId=fall-2026');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(CARD);
    expect(getReportCard.execute).toHaveBeenCalledWith({ learnerId: 'kid1', periodId: 'fall-2026' });
  });

  it('null when not wired', async () => {
    const res = await request(appWith()).get('/api/v1/school/report-card?learnerId=kid1&periodId=fall-2026');
    expect(res.status).toBe(200);
    expect(res.body).toBe(null);
  });

  it('400s on a missing learnerId or periodId', async () => {
    const getReportCard = { execute: vi.fn(async () => CARD) };
    const noLearner = await request(appWith({ getReportCard })).get('/api/v1/school/report-card?periodId=fall-2026');
    expect(noLearner.status).toBe(400);
    const noPeriod = await request(appWith({ getReportCard })).get('/api/v1/school/report-card?learnerId=kid1');
    expect(noPeriod.status).toBe(400);
  });

  it('404s an unknown period (EntityNotFoundError from the use case)', async () => {
    const getReportCard = { execute: vi.fn(async () => { throw new EntityNotFoundError('Academic period', 'ghost'); }) };
    const res = await request(appWith({ getReportCard }))
      .get('/api/v1/school/report-card?learnerId=kid1&periodId=ghost');
    expect(res.status).toBe(404);
  });

  it('format=pdf renders through the wired renderer and serves it inline with the card-id filename', async () => {
    const getReportCard = { execute: vi.fn(async () => CARD) };
    const renderReportCardPdf = vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4 fake'), pageCount: 1, mode: 'draft' }));
    const res = await request(appWith({ getReportCard, renderReportCardPdf }))
      .get('/api/v1/school/report-card?learnerId=kid1&periodId=fall-2026&format=pdf&learnerName=Milo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe('inline; filename="report-card-kid1-fall-2026.pdf"');
    expect(res.body.toString('latin1')).toContain('%PDF-1.4 fake');
    expect(renderReportCardPdf).toHaveBeenCalledWith(CARD, { learnerName: 'Milo' });
  });

  it('format=pdf sanitizes a hostile learnerId out of the filename header', async () => {
    const getReportCard = { execute: vi.fn(async () => CARD) };
    const renderReportCardPdf = vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4 fake'), pageCount: 1, mode: 'draft' }));
    const res = await request(appWith({ getReportCard, renderReportCardPdf }))
      .get('/api/v1/school/report-card')
      .query({
        learnerId: 'kid1"; filename="evil.pdf', periodId: 'fall-2026', format: 'pdf',
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('inline; filename="report-card-kid1-filename-evil-pdf-fall-2026.pdf"');
    expect(res.headers['content-disposition']).not.toContain('"evil.pdf"');
    expect((res.headers['content-disposition'].match(/"/g) || []).length).toBe(2);
  });

  it('format=pdf 503s when no renderer is wired', async () => {
    const getReportCard = { execute: vi.fn(async () => CARD) };
    const res = await request(appWith({ getReportCard }))
      .get('/api/v1/school/report-card?learnerId=kid1&periodId=fall-2026&format=pdf');
    expect(res.status).toBe(503);
  });

  it('JSON stays the default when format is omitted', async () => {
    const getReportCard = { execute: vi.fn(async () => CARD) };
    const renderReportCardPdf = vi.fn(async () => ({ pdf: Buffer.from('%PDF-'), pageCount: 1, mode: 'draft' }));
    const res = await request(appWith({ getReportCard, renderReportCardPdf }))
      .get('/api/v1/school/report-card?learnerId=kid1&periodId=fall-2026');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(renderReportCardPdf).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/school/report-card/frozen', () => {
  it('returns the single frozen record when periodId is given', async () => {
    const reportCardsStore = {
      readReportCard: vi.fn(() => ({ ...CARD, closedBy: 'dad', closedAt: 't1' })),
      listReportCards: vi.fn(),
    };
    const res = await request(appWith({ reportCardsStore }))
      .get('/api/v1/school/report-card/frozen?learnerId=kid1&periodId=fall-2026');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ closedBy: 'dad' });
    expect(reportCardsStore.readReportCard).toHaveBeenCalledWith('kid1', 'fall-2026');
  });

  it('404s when the named period was never closed', async () => {
    const reportCardsStore = { readReportCard: vi.fn(() => null), listReportCards: vi.fn() };
    const res = await request(appWith({ reportCardsStore }))
      .get('/api/v1/school/report-card/frozen?learnerId=kid1&periodId=never-closed');
    expect(res.status).toBe(404);
  });

  it('lists every frozen record for the learner when periodId is omitted', async () => {
    const records = [{ ...CARD, closedBy: 'dad' }];
    const reportCardsStore = { readReportCard: vi.fn(), listReportCards: vi.fn(() => records) };
    const res = await request(appWith({ reportCardsStore })).get('/api/v1/school/report-card/frozen?learnerId=kid1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(records);
    expect(reportCardsStore.listReportCards).toHaveBeenCalledWith('kid1');
  });

  it('null when not wired', async () => {
    const res = await request(appWith()).get('/api/v1/school/report-card/frozen?learnerId=kid1');
    expect(res.status).toBe(200);
    expect(res.body).toBe(null);
  });

  it('format=pdf renders the frozen record and serves it inline with the card-id filename', async () => {
    const frozen = { ...CARD, closedBy: 'dad', closedAt: 't1' };
    const reportCardsStore = { readReportCard: vi.fn(() => frozen), listReportCards: vi.fn() };
    const renderReportCardPdf = vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4 frozen'), pageCount: 1, mode: 'frozen' }));
    const res = await request(appWith({ reportCardsStore, renderReportCardPdf }))
      .get('/api/v1/school/report-card/frozen?learnerId=kid1&periodId=fall-2026&format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe('inline; filename="report-card-kid1-fall-2026.pdf"');
    expect(renderReportCardPdf).toHaveBeenCalledWith(frozen, { learnerName: null });
  });

  it('format=pdf 404s when the named period was never closed — never reaches the renderer', async () => {
    const reportCardsStore = { readReportCard: vi.fn(() => null), listReportCards: vi.fn() };
    const renderReportCardPdf = vi.fn(async () => ({ pdf: Buffer.from('%PDF-'), pageCount: 1, mode: 'frozen' }));
    const res = await request(appWith({ reportCardsStore, renderReportCardPdf }))
      .get('/api/v1/school/report-card/frozen?learnerId=kid1&periodId=never-closed&format=pdf');
    expect(res.status).toBe(404);
    expect(renderReportCardPdf).not.toHaveBeenCalled();
  });

  it('format=pdf 503s when no renderer is wired', async () => {
    const reportCardsStore = { readReportCard: vi.fn(() => ({ ...CARD, closedBy: 'dad', closedAt: 't1' })), listReportCards: vi.fn() };
    const res = await request(appWith({ reportCardsStore }))
      .get('/api/v1/school/report-card/frozen?learnerId=kid1&periodId=fall-2026&format=pdf');
    expect(res.status).toBe(503);
  });

  it('format=pdf is ignored on the list variety (periodId omitted) — still JSON', async () => {
    const records = [{ ...CARD, closedBy: 'dad' }];
    const reportCardsStore = { readReportCard: vi.fn(), listReportCards: vi.fn(() => records) };
    const renderReportCardPdf = vi.fn(async () => ({ pdf: Buffer.from('%PDF-'), pageCount: 1, mode: 'frozen' }));
    const res = await request(appWith({ reportCardsStore, renderReportCardPdf }))
      .get('/api/v1/school/report-card/frozen?learnerId=kid1&format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual(records);
    expect(renderReportCardPdf).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/school/report-card/close', () => {
  it('201s with the frozen payload on a successful close', async () => {
    const frozen = { ...CARD, closedBy: 'dad', closedAt: 't1', supersededVersions: 0 };
    const closeAcademicPeriod = { execute: vi.fn(async () => frozen) };
    const res = await request(appWith({ closeAcademicPeriod }))
      .post('/api/v1/school/report-card/close')
      .send({
        learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad',
      });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(frozen);
    expect(closeAcademicPeriod.execute).toHaveBeenCalledWith({
      learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad', supersede: false, pin: null,
    });
  });

  it('forwards supersede: true', async () => {
    const closeAcademicPeriod = { execute: vi.fn(async () => CARD) };
    await request(appWith({ closeAcademicPeriod }))
      .post('/api/v1/school/report-card/close')
      .send({
        learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad', supersede: true,
      });
    expect(closeAcademicPeriod.execute).toHaveBeenCalledWith({
      learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad', supersede: true, pin: null,
    });
  });

  it('400s on a missing learnerId, periodId, or closedBy — never a 500 from a deep guard', async () => {
    const closeAcademicPeriod = { execute: vi.fn(async () => CARD) };
    const app = appWith({ closeAcademicPeriod });

    const noLearner = await request(app).post('/api/v1/school/report-card/close')
      .send({ periodId: 'fall-2026', closedBy: 'dad' });
    expect(noLearner.status).toBe(400);

    const noPeriod = await request(app).post('/api/v1/school/report-card/close')
      .send({ learnerId: 'kid1', closedBy: 'dad' });
    expect(noPeriod.status).toBe(400);

    const noClosedBy = await request(app).post('/api/v1/school/report-card/close')
      .send({ learnerId: 'kid1', periodId: 'fall-2026' });
    expect(noClosedBy.status).toBe(400);

    expect(closeAcademicPeriod.execute).not.toHaveBeenCalled();
  });

  it('409s a plain re-close (REPORT_CARD_ALREADY_CLOSED)', async () => {
    const closeAcademicPeriod = {
      execute: vi.fn(async () => {
        throw new DomainInvariantError("Report card for 'fall-2026' is already closed", { code: 'REPORT_CARD_ALREADY_CLOSED' });
      }),
    };
    const res = await request(appWith({ closeAcademicPeriod }))
      .post('/api/v1/school/report-card/close')
      .send({
        learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REPORT_CARD_ALREADY_CLOSED');
  });

  it('403s a non-grown-up closedBy (GuestForbiddenError from the gate)', async () => {
    const closeAcademicPeriod = {
      execute: vi.fn(async () => { throw new GuestForbiddenError('Only a grown-up can close a report card'); }),
    };
    const res = await request(appWith({ closeAcademicPeriod }))
      .post('/api/v1/school/report-card/close')
      .send({
        learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'kid1',
      });
    expect(res.status).toBe(403);
  });

  it('404s (not configured) when closeAcademicPeriod is not wired', async () => {
    const res = await request(appWith())
      .post('/api/v1/school/report-card/close')
      .send({
        learnerId: 'kid1', periodId: 'fall-2026', closedBy: 'dad',
      });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/school/teacher/today', () => {
  it('200s with the digest when wired', async () => {
    const digest = [{
      learnerId: 'kid1', attemptsToday: 2, correctToday: 1, sessionsToday: [], pendingReview: 0,
    }];
    const getTeacherToday = { execute: vi.fn(async () => digest) };
    const res = await request(appWith({ getTeacherToday })).get('/api/v1/school/teacher/today');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(digest);
  });

  it('[] when not wired', async () => {
    const res = await request(appWith()).get('/api/v1/school/teacher/today');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
