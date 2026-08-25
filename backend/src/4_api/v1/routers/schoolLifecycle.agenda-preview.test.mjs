import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolLifecycleRouter } from './schoolLifecycle.mjs';

function appWith(previewAgenda) {
  const app = express();
  app.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({
    // One lifecycle use case is needed to mount the router. It is not called
    // by this preview route; the assertion below protects that boundary.
    buildAgenda: { execute: vi.fn() },
    previewAgenda,
    receiptPngRenderer: { createCanvas: vi.fn() },
    logger: { warn() {}, error() {} },
  }));
  return app;
}

describe('agenda preview study-day contract', () => {
  it('passes an explicit study day only to the dry-run builder and marks the response non-recording', async () => {
    const previewAgenda = { execute: vi.fn(async () => ({
      document: { id: 'agenda-milo' }, sections: [{ subject: 'civilization' }],
      plan: { entries: [{ unitId: 'illinois' }], errors: [] },
    })) };
    const response = await request(appWith(previewAgenda))
      .get('/api/v1/school/lifecycle/learners/milo/agenda/preview?format=json&studyDay=2026-08-25');

    expect(response.status).toBe(200);
    expect(response.headers['x-school-preview']).toBe('agenda-non-recording');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toMatchObject({ learnerId: 'milo', studyDay: '2026-08-25' });
    expect(previewAgenda.execute).toHaveBeenCalledWith({ learnerId: 'milo', learnerName: null, studyDay: '2026-08-25' });
  });
});
