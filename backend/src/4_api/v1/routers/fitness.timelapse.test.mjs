import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFitnessRouter } from './fitness.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function appWith(generateSessionTimelapse) {
  const app = express();
  app.use(express.json());
  app.use('/', createFitnessRouter({ generateSessionTimelapse, logger: silent }));
  return app;
}

test('POST /sessions/:id/timelapse returns 202 and triggers the use case', async () => {
  let called = null;
  const uc = { execute: async (args) => { called = args; return { status: 'ready' }; } };
  const app = appWith(uc);
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/sessions/20260612180809/timelapse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ household: 'h' })
    });
    assert.equal(res.status, 202);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(called?.sessionId, '20260612180809');
    assert.equal(called?.householdId, 'h');
  } finally {
    server.close();
  }
});

test('POST /sessions/:id/timelapse returns 501 when not configured', async () => {
  const app = appWith(null);
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/sessions/20260612180809/timelapse`, { method: 'POST' });
    assert.equal(res.status, 501);
  } finally {
    server.close();
  }
});
