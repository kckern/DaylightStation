import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createSchoolLifecycleRouter } from './schoolLifecycle.mjs';

function app(recoverMisattributedWorksheet) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1/school/lifecycle', createSchoolLifecycleRouter({
    recoverMisattributedWorksheet,
    logger: { info() {}, warn() {} },
  }));
  return server;
}

const body = (apply) => ({
  sourceSessionId: 'ses_math',
  creditedSessionId: 'ses_scripture',
  remediationSessionId: 'ses_retry',
  sourceCardId: '8684155',
  currentCardId: '8424408',
  sourceRows: [22, 23, 24],
  targetRows: [1, 2, 3],
  marks: ['B', 'B', 'B'],
  reason: 'scripture answers were bubbled in the math row window',
  recoveredBy: 'parent',
  idempotencyKey: 'milo-2026-08-31',
  expectedReplacementRows: { start: 4, end: 9 },
  apply,
});

describe('school lifecycle worksheet-attribution recovery route', () => {
  it('previews with the teacher capability and applies with its scoped step-up proof', async () => {
    const recoverMisattributedWorksheet = {
      execute: vi.fn(async (args) => ({
        schema: 'school.worksheet-attribution-recovery/v1', applied: args.apply,
      })),
    };
    const server = app(recoverMisattributedWorksheet);

    await request(server)
      .post('/api/v1/school/lifecycle/recoveries/worksheet-attribution')
      .set('Cookie', 'daylight_teacher_session=session-1')
      .send(body(false))
      .expect(200)
      .expect({ schema: 'school.worksheet-attribution-recovery/v1', applied: false });
    expect(recoverMisattributedWorksheet.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceSessionId: 'ses_math',
      marks: ['B', 'B', 'B'],
      apply: false,
      pin: { capabilityToken: 'session-1', stepUpToken: null },
    }));

    await request(server)
      .post('/api/v1/school/lifecycle/recoveries/worksheet-attribution')
      .set('Cookie', 'daylight_teacher_session=session-1')
      .set('X-Teacher-Step-Up', 'grant-1')
      .send(body(true))
      .expect(201)
      .expect({ schema: 'school.worksheet-attribution-recovery/v1', applied: true });
    expect(recoverMisattributedWorksheet.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceSessionId: 'ses_math',
      expectedReplacementRows: { start: 4, end: 9 },
      apply: true,
      pin: { capabilityToken: 'session-1', stepUpToken: 'grant-1' },
    }));
  });
});
