// @vitest-environment node
//
// The dry-run agenda preview (DoNow + Agenda Preview plan, Task 2). A parent
// wants to see "what would print right now" without a card ever touching the
// scanner — so this route reuses BuildAgenda's own algorithm and the real
// receipt renderer, but against dry-run session/token stands-ins wired in the
// composition root, and returns a PNG rather than paper.
//
// THE WHOLE POINT IS THE DRY RUN. A preview that quietly opened a session,
// minted a real scannable ticket, or nudged a language learner's stored
// progress would be a production bug wearing a "preview" label. (b) below
// pins all three: the session store, the token registry (one file per token
// on disk — see YamlTokenRegistry), and the language datastore's write path
// are all asserted UNCHANGED by a preview call, and (c) proves a real tap
// right after still behaves exactly as every other lifecycle e2e expects.
//
// Same production graph as every other file in this directory
// (`tests/_lib/school/lifecycleHarness.mjs`) — the difference here is that the
// route is reached over real HTTP (`lifecycle.router`, not a use case called
// directly), because the response under test IS the HTTP contract: status,
// `content-type`, `content-disposition`, PNG bytes. Real `fetch` against a real
// `http.Server`, hence the node environment pragma (mirrors
// `schoolLifecycleRouter.test.mjs`).
import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  createLifecycleHarness, COURSE_ID, DEFAULT_LEARNER,
} from '#testlib/school/lifecycleHarness.mjs';
import { LanguageStudyService } from '#apps/school/LanguageStudyService.mjs';
import { createSchoolLifecycleRouter } from '#api/v1/routers/schoolLifecycle.mjs';
import { errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const LANGUAGE_UNIT = 'language-daily';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * A language program nobody has touched — same shape as
 * `agendaV2LanguageJourney.e2e.test.mjs`'s `neverTouchedLanguageService()` —
 * plus a `writeProgress` spy so (b) can assert it was never called by a
 * preview. `todayStatus` (which the preview's program launcher calls) never
 * writes at all, in preview OR the real path — see the one-line comment on it
 * in `LanguageStudyService.mjs` — so this spy is really pinning that
 * production invariant, not something specific to dry-run wiring.
 */
function spiedLanguageDatastore() {
  return {
    listCorpusIds: () => [],
    readProgress: () => null,
    readAllEvents: () => [],
    writeProgress: vi.fn(),
  };
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}/api/v1/school` };
}

let h;
let server;
let base;
let languageDatastore;

beforeEach(async () => {
  languageDatastore = spiedLanguageDatastore();
  h = await createLifecycleHarness({
    languageStudyService: new LanguageStudyService({ datastore: languageDatastore, logger: silent }),
  });
  await h.assign({ courses: [COURSE_ID], units: [LANGUAGE_UNIT] });

  const app = express();
  app.use('/api/v1/school', h.lifecycle.router);
  app.use(errorHandlerMiddleware({ logger: silent, shape: 'string' }));
  ({ server, base } = await listen(app));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  h?.dispose();
});

const tokenDir = () => path.join(h.dataDir, 'household', 'apps', 'school', 'tokens');
const tokenFiles = () => (fs.existsSync(tokenDir()) ? fs.readdirSync(tokenDir()) : []);

describe('GET /learners/:learnerId/agenda/preview — dry-run agenda preview', () => {
  it('(a) renders a PNG receipt for a learner with an assignment', async () => {
    const res = await fetch(`${base}/learners/${DEFAULT_LEARNER}/agenda/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain(`agenda-${DEFAULT_LEARNER}`);
    expect(disposition).toMatch(/\.png"$/);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  });

  it('(b) DRY-RUN PROOF: no new sessions, no new tokens, no language progress write', async () => {
    const sessionsBefore = await h.sessionRows(DEFAULT_LEARNER);
    const tokensBefore = tokenFiles();

    const res = await fetch(`${base}/learners/${DEFAULT_LEARNER}/agenda/preview`);
    expect(res.status).toBe(200);
    await res.arrayBuffer(); // drain the body

    const sessionsAfter = await h.sessionRows(DEFAULT_LEARNER);
    expect(sessionsAfter).toHaveLength(sessionsBefore.length);
    expect(tokenFiles()).toHaveLength(tokensBefore.length);
    expect(languageDatastore.writeProgress).not.toHaveBeenCalled();
  });

  it('(c) a real tap right after a preview still creates sessions and tokens normally', async () => {
    await fetch(`${base}/learners/${DEFAULT_LEARNER}/agenda/preview`).then((r) => r.arrayBuffer());

    const sessionsBefore = await h.sessionRows(DEFAULT_LEARNER);
    const tokensBefore = tokenFiles();

    await h.scanCard(DEFAULT_LEARNER);

    const sessionsAfter = await h.sessionRows(DEFAULT_LEARNER);
    expect(sessionsAfter.length).toBeGreaterThan(sessionsBefore.length);
    expect(tokenFiles().length).toBeGreaterThan(tokensBefore.length);
  });

  it('(d) an unknown learner still gets a 200 PNG — the notice renders, it does not fail', async () => {
    const res = await fetch(`${base}/learners/nobody-assigned/agenda/preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  });

  it('(e) 501s with a clear message when the renderer is not wired', async () => {
    const app2 = express();
    // Mirrors production shape: previewAgenda present (the harness's real use
    // case), receiptPngRenderer absent — the exact gap the composition guards
    // against when the rendering-layer import fails.
    app2.use('/api/v1/school', createSchoolLifecycleRouter({
      previewAgenda: h.useCases.previewAgenda,
      receiptPngRenderer: null,
      buildAgenda: h.useCases.buildAgenda,
      logger: silent,
    }));
    app2.use(errorHandlerMiddleware({ logger: silent, shape: 'string' }));
    const { server: server2, base: base2 } = await listen(app2);
    try {
      const res = await fetch(`${base2}/learners/${DEFAULT_LEARNER}/agenda/preview`);
      expect(res.status).toBe(501);
      expect(await res.json()).toEqual({ error: 'agenda preview not configured' });
    } finally {
      await new Promise((resolve) => server2.close(resolve));
    }
  });
});
