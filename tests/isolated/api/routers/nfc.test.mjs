import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createNfcRouter } from '../../../../backend/src/4_api/v1/routers/nfc.mjs';

describe('createNfcRouter', () => {
  let nfcService;
  let app;

  beforeEach(() => {
    nfcService = { handleScan: jest.fn() };
    app = express();
    app.use('/api/v1/nfc', createNfcRouter({ nfcService, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
  });

  it('returns 200 on successful scan', async () => {
    nfcService.handleScan.mockResolvedValue({ ok: true, action: 'queue', target: 'livingroom-tv' });
    const res = await request(app).get('/api/v1/nfc/livingroom-nfc/83_8e_68_06');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(nfcService.handleScan).toHaveBeenCalledWith('livingroom-nfc', '83_8e_68_06', expect.any(Object));
  });

  it('returns 404 for READER_NOT_FOUND', async () => {
    nfcService.handleScan.mockResolvedValue({ ok: false, code: 'READER_NOT_FOUND', error: 'Unknown reader' });
    const res = await request(app).get('/api/v1/nfc/attic-nfc/aa_bb');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('READER_NOT_FOUND');
  });

  it('returns 404 for TAG_NOT_REGISTERED', async () => {
    nfcService.handleScan.mockResolvedValue({ ok: false, code: 'TAG_NOT_REGISTERED', error: 'Unknown tag' });
    const res = await request(app).get('/api/v1/nfc/livingroom-nfc/zz');
    expect(res.status).toBe(404);
  });

  it('returns 401 for AUTH_FAILED', async () => {
    nfcService.handleScan.mockResolvedValue({ ok: false, code: 'AUTH_FAILED', error: 'auth' });
    const res = await request(app).get('/api/v1/nfc/livingroom-nfc/aa');
    expect(res.status).toBe(401);
  });

  it('returns 400 for UNKNOWN_ACTION and INVALID_INTENT', async () => {
    nfcService.handleScan.mockResolvedValueOnce({ ok: false, code: 'UNKNOWN_ACTION', error: 'x' });
    expect((await request(app).get('/api/v1/nfc/r/t')).status).toBe(400);
    nfcService.handleScan.mockResolvedValueOnce({ ok: false, code: 'INVALID_INTENT', error: 'y' });
    expect((await request(app).get('/api/v1/nfc/r/t')).status).toBe(400);
  });

  it('returns 502 for DISPATCH_FAILED', async () => {
    nfcService.handleScan.mockResolvedValue({ ok: false, code: 'DISPATCH_FAILED', error: 'boom' });
    const res = await request(app).get('/api/v1/nfc/r/t');
    expect(res.status).toBe(502);
  });

  it('passes ?token= and ?dryRun= through to options', async () => {
    nfcService.handleScan.mockResolvedValue({ ok: true });
    await request(app).get('/api/v1/nfc/r/t?token=secret&dryRun=1');
    expect(nfcService.handleScan).toHaveBeenCalledWith('r', 't',
      expect.objectContaining({ token: 'secret', dryRun: true }));
  });
});
