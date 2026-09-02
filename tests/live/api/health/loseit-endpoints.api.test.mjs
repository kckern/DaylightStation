/**
 * LoseIt-Revamp Health API — Live Integration Tests (Task F10)
 *
 * Exercises B3/B4/B6/B7 against the running dev server:
 *   1. Goals round-trip (GET/PUT /health/goals)
 *   2. Budget equation (GET /health/budget)
 *   3. Food catalog: create custom → suggest → favorite → suggest-first
 *   4. Saved meals: create → list → log-to-date → nutrilist rows → cleanup
 *   5. Medical readings: add → grouped listing → delete
 *
 * Port convention follows the rest of tests/live/api/ (e.g.
 * content/format-field.test.mjs): `process.env.BACKEND_PORT || 3112`, NOT
 * tests/_lib/configHelper.mjs's getAppPort() — that resolves to the prod
 * container port (3111) on this host because system-local.kckern-server.yml
 * has no app.ports block. 3112 is the Vite dev proxy in front of the 3113
 * backend (see CLAUDE.md dev port table).
 *
 * KNOWN HARNESS GAP: `npm run test:live:api` gates on GET /api/v1/health,
 * which does not exist as a route (the health router has no bare `/`
 * handler) — the harness's own readiness probe 404s even when the backend
 * is fully up, so it always reports "Backend not responding" and refuses to
 * invoke Jest. This is a pre-existing harness bug, not a backend outage.
 * Run this file directly instead (mirrors exactly what live.harness.mjs
 * would exec for `--only=api`, minus its broken gate):
 *
 *   NODE_OPTIONS=--experimental-vm-modules npx jest \
 *     tests/live/api/health/loseit-endpoints.api.test.mjs --colors --runInBand
 */

const BACKEND_PORT = process.env.BACKEND_PORT || 3112;
const BASE = `http://localhost:${BACKEND_PORT}/api/v1/health`;

const todayLocalISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function sendJson(method, path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { status: res.status, body };
}

describe('Health/LoseIt live API', () => {
  beforeAll(async () => {
    // Sanity-check the dev server is reachable before any tests run — an
    // unreachable backend must FAIL these tests, never silently skip them.
    try {
      const r = await fetch(`${BASE}/goals`, { signal: AbortSignal.timeout(5000) });
      if (r.status >= 500) {
        throw new Error(`Server returned ${r.status} on health probe`);
      }
    } catch (err) {
      throw new Error(
        `Dev server not reachable at port ${BACKEND_PORT}: ${err.message}. ` +
        `Ensure the dev server is running (backend 3113 / vite proxy 3112) before running live API tests.`
      );
    }
  });

  // ==========================================================================
  // 1. Goals round-trip — SAVE and RESTORE the pre-existing goals.
  // ==========================================================================
  describe('goals round-trip', () => {
    test('PUT goals then GET returns the saved values, and original goals are restored', async () => {
      const before = await getJson('/goals');
      expect(before.status).toBe(200);
      const originalGoals = before.body.goals;
      expect(originalGoals).toBeTruthy();

      const testGoals = { ...originalGoals, targetWeightLbs: 999 };

      const putResult = await sendJson('PUT', '/goals', testGoals);
      expect(putResult.status).toBe(200);
      expect(putResult.body.goals.targetWeightLbs).toBe(999);

      const afterPut = await getJson('/goals');
      expect(afterPut.status).toBe(200);
      expect(afterPut.body.goals.targetWeightLbs).toBe(999);
      expect(afterPut.body.goals.heightIn).toBe(originalGoals.heightIn);
      expect(afterPut.body.goals.sex).toBe(originalGoals.sex);

      // Restore — never leave test residue in a live-configured goals file.
      const restoreResult = await sendJson('PUT', '/goals', originalGoals);
      expect(restoreResult.status).toBe(200);
      expect(restoreResult.body.goals).toEqual(originalGoals);

      const afterRestore = await getJson('/goals');
      expect(afterRestore.body.goals).toEqual(originalGoals);
    }, 20000);
  });

  // ==========================================================================
  // 2. Budget equation
  // ==========================================================================
  describe('budget equation', () => {
    test('GET /budget returns a numeric equation, or 409 GOALS_NOT_CONFIGURED', async () => {
      const { status, body } = await getJson('/budget');

      if (status === 409) {
        expect(body.code).toBe('GOALS_NOT_CONFIGURED');
        expect(typeof body.error).toBe('string');
        return;
      }

      expect(status).toBe(200);
      expect(typeof body.budget).toBe('number');
      expect(typeof body.food).toBe('number');
      expect(typeof body.exercise).toBe('number');
      expect(typeof body.remaining).toBe('number');
      expect(['under', 'over']).toContain(body.status);
      // The equation itself: remaining = budget - food + exercise
      expect(body.remaining).toBe(body.budget - body.food + body.exercise);
    });
  });

  // ==========================================================================
  // 3. Food catalog: custom create → suggest → favorite → suggest-first
  // ==========================================================================
  describe('food catalog: create, suggest, favorite', () => {
    const CUSTOM_NAME = 'ZZZ Integration Food';

    test('POST custom food (idempotent) appears in suggest, then favoriting ranks it first', async () => {
      // Idempotent create: only POST if a prior run hasn't already left it
      // behind. No DELETE route exists for catalog entries (checked
      // backend/src/4_api/v1/routers/health.mjs — only GET/POST/PUT under
      // /nutrition/catalog*), so it's expected to persist across runs.
      const existingSearch = await getJson(`/nutrition/catalog?q=${encodeURIComponent('zzz')}`);
      expect(existingSearch.status).toBe(200);
      const alreadyExists = existingSearch.body.items.some((i) => i.name === CUSTOM_NAME);

      if (!alreadyExists) {
        const created = await sendJson('POST', '/nutrition/catalog', {
          name: CUSTOM_NAME,
          calories: 123,
        });
        expect(created.status).toBe(200);
        expect(created.body.entry.name).toBe(CUSTOM_NAME);
        expect(created.body.entry.nutrients.calories).toBe(123);
      }

      const suggested = await getJson('/nutrition/catalog/suggest?q=zzz');
      expect(suggested.status).toBe(200);
      const names = suggested.body.items.map((i) => i.name);
      expect(names).toContain(CUSTOM_NAME);

      try {
        const favorited = await sendJson('PUT', '/nutrition/catalog/favorite', {
          name: CUSTOM_NAME,
          favorite: true,
        });
        expect(favorited.status).toBe(200);
        expect(favorited.body.entry.favorite).toBe(true);

        const suggestedAfterFavorite = await getJson('/nutrition/catalog/suggest?q=zzz');
        expect(suggestedAfterFavorite.status).toBe(200);
        expect(suggestedAfterFavorite.body.items.length).toBeGreaterThan(0);
        expect(suggestedAfterFavorite.body.items[0].name).toBe(CUSTOM_NAME);
        expect(suggestedAfterFavorite.body.items[0].favorite).toBe(true);
      } finally {
        // Never leave the test entry favorited — it sorts first in every
        // real "+ Add food…" suggest list, including the empty-query one
        // (I-3, final review 2026-09-02).
        await sendJson('PUT', '/nutrition/catalog/favorite', {
          name: CUSTOM_NAME,
          favorite: false,
        });
      }
    });
  });

  // ==========================================================================
  // 4. Saved meals: create → list → log-to-date → nutrilist rows → cleanup
  // ==========================================================================
  describe('saved meals: create, log, cleanup', () => {
    test('created meal appears in the list, logging writes SAVEDMEAL nutrilist rows, cleanup removes both', async () => {
      const mealName = `ZZZ Integration Meal ${Date.now()}`;
      const created = await sendJson('POST', '/nutrition/meals', {
        name: mealName,
        items: [
          { name: 'Integration Test Toast', calories: 150, protein: 4, carbs: 20, fat: 5 },
          { name: 'Integration Test Juice', calories: 90, protein: 0, carbs: 22, fat: 0 },
        ],
      });
      expect(created.status).toBe(200);
      const mealId = created.body.meal.id;
      expect(mealId).toBeTruthy();
      expect(created.body.meal.name).toBe(mealName);
      expect(created.body.meal.items).toHaveLength(2);

      const listed = await getJson('/nutrition/meals');
      expect(listed.status).toBe(200);
      expect(listed.body.meals.some((m) => m.id === mealId)).toBe(true);

      const today = todayLocalISO();
      const logged = await sendJson('POST', `/nutrition/meals/${mealId}/log`, { date: today });
      expect(logged.status).toBe(200);
      expect(logged.body.items).toHaveLength(2);
      for (const row of logged.body.items) {
        expect(row.log_uuid).toBe('SAVEDMEAL');
        expect(row.date).toBe(today);
      }
      const loggedUuids = logged.body.items.map((i) => i.uuid);

      const nutrilist = await getJson(`/nutrilist/${today}`);
      expect(nutrilist.status).toBe(200);
      const nutrilistUuids = nutrilist.body.data.map((i) => i.uuid);
      for (const uuid of loggedUuids) {
        expect(nutrilistUuids).toContain(uuid);
      }
      const savedMealRows = nutrilist.body.data.filter((i) => loggedUuids.includes(i.uuid));
      expect(savedMealRows.every((r) => r.log_uuid === 'SAVEDMEAL')).toBe(true);

      // Cleanup: delete the nutrilist rows this test created, then the meal.
      for (const uuid of loggedUuids) {
        const del = await fetch(`${BASE}/nutrilist/${uuid}`, { method: 'DELETE' });
        expect(del.status).toBe(200);
      }
      const delMeal = await fetch(`${BASE}/nutrition/meals/${mealId}`, { method: 'DELETE' });
      expect(delMeal.status).toBe(200);

      const nutrilistAfter = await getJson(`/nutrilist/${today}`);
      const remainingUuids = nutrilistAfter.body.data.map((i) => i.uuid);
      for (const uuid of loggedUuids) {
        expect(remainingUuids).not.toContain(uuid);
      }
      const mealsAfter = await getJson('/nutrition/meals');
      expect(mealsAfter.body.meals.some((m) => m.id === mealId)).toBe(false);
    });
  });

  // ==========================================================================
  // 5. Medical readings: add → grouped listing shows latest → delete → gone
  // ==========================================================================
  describe('medical readings: add, group, delete', () => {
    test('POST bp reading appears as latest in grouped listing, then DELETE removes it', async () => {
      const today = todayLocalISO();
      const added = await sendJson('POST', '/medical', {
        metric: 'bp',
        value: 118,
        value2: 76,
        unit: 'mmHg',
        date: today,
        note: 'integration-test',
      });
      expect(added.status).toBe(200);
      const readingId = added.body.reading.id;
      expect(readingId).toBeTruthy();
      expect(added.body.reading.metric).toBe('bp');
      expect(added.body.reading.value).toBe(118);
      expect(added.body.reading.value2).toBe(76);

      const grouped = await getJson('/medical');
      expect(grouped.status).toBe(200);
      const bpGroup = grouped.body.metrics.find((m) => m.metric === 'bp');
      expect(bpGroup).toBeTruthy();
      expect(bpGroup.latest.id).toBe(readingId);
      expect(bpGroup.latest.value).toBe(118);
      expect(bpGroup.readings.some((r) => r.id === readingId)).toBe(true);

      const del = await fetch(`${BASE}/medical/${readingId}`, { method: 'DELETE' });
      expect(del.status).toBe(200);
      const delBody = await del.json();
      expect(delBody.ok).toBe(true);

      const groupedAfter = await getJson('/medical');
      const bpGroupAfter = groupedAfter.body.metrics.find((m) => m.metric === 'bp');
      const stillThere = bpGroupAfter?.readings.some((r) => r.id === readingId) ?? false;
      expect(stillThere).toBe(false);
    });
  });
});
