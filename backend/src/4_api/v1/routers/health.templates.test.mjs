import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function makeApp(overrides = {}) {
  const calls = { list: [], create: [], instantiate: [], remove: [], approve: [], dismiss: [] };
  const templateService = {
    list: async (userId, options) => { calls.list.push({ userId, options }); return [{ id: 't1', name: 'Morning smoothie' }]; },
    create: async (payload, userId) => { calls.create.push({ payload, userId }); return { id: 't2', ...payload }; },
    instantiate: async (id, userId, options) => {
      calls.instantiate.push({ id, userId, options });
      return { groupUuid: 'g1', items: [{ uuid: 'g1' }, { uuid: 'c1' }] };
    },
    remove: async (id, userId) => { calls.remove.push({ id, userId }); },
    approve: async (id, userId, options) => { calls.approve.push({ id, userId, options }); return { id, name: options?.name }; },
    dismiss: async (id, userId) => { calls.dismiss.push({ id, userId }); return { ok: true, key: 'k1' }; },
    ...overrides,
  };
  const router = createHealthRouter({
    healthOperations: { defaultUsername: () => 'testuser', currentDate: () => '2026-09-04' },
    templateService,
    logger: silent,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/health', router);
  return { app, calls };
}

describe('meal template endpoints (Task 10.1)', () => {
  it('GET /nutrition/templates hides proposals unless includeProposed is asked for', async () => {
    const { app, calls } = makeApp();
    const plain = await request(app).get('/api/v1/health/nutrition/templates');
    expect(plain.status).toBe(200);
    expect(plain.body.templates[0].name).toBe('Morning smoothie');
    expect(calls.list[0].options).toEqual({ includeProposed: false });

    await request(app).get('/api/v1/health/nutrition/templates?includeProposed=1');
    expect(calls.list[1].options).toEqual({ includeProposed: true });
  });

  it('POST /nutrition/templates passes name, icon and components through', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).post('/api/v1/health/nutrition/templates')
      .send({ name: 'Smoothie', icon: 'smoothie', components: [{ name: 'Chia', role: 'core', calories: 60 }] });
    expect(res.status).toBe(200);
    expect(calls.create[0].payload).toEqual({
      name: 'Smoothie', icon: 'smoothie', components: [{ name: 'Chia', role: 'core', calories: 60 }],
    });
    expect(calls.create[0].userId).toBe('testuser');
  });

  it('POST /nutrition/templates answers 400 on an invalid template rather than a 500', async () => {
    const { app } = makeApp({
      create: async () => { const e = new Error('Template requires components'); e.code = 'TEMPLATE_INVALID'; throw e; },
    });
    const res = await request(app).post('/api/v1/health/nutrition/templates').send({ name: 'x', components: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TEMPLATE_INVALID');
  });

  it('POST /:id/instantiate forwards date, bucket and chosen variants', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).post('/api/v1/health/nutrition/templates/t1/instantiate')
      .send({ date: '2026-09-04', mealTime: 'morning', variantNames: ['Mango'] });
    expect(res.status).toBe(200);
    expect(res.body.groupUuid).toBe('g1');
    expect(calls.instantiate[0]).toMatchObject({
      id: 't1', userId: 'testuser',
      options: { date: '2026-09-04', mealTime: 'morning', variantNames: ['Mango'] },
    });
  });

  it('refuses a phantom bucket, a malformed date and a non-array variant list — none reaches the service', async () => {
    const { app, calls } = makeApp();
    const bucket = await request(app).post('/api/v1/health/nutrition/templates/t1/instantiate').send({ mealTime: 'brunch' });
    const date = await request(app).post('/api/v1/health/nutrition/templates/t1/instantiate').send({ date: '09/04/2026' });
    const variants = await request(app).post('/api/v1/health/nutrition/templates/t1/instantiate').send({ variantNames: 'Mango' });
    expect([bucket.status, date.status, variants.status]).toEqual([400, 400, 400]);
    expect(calls.instantiate).toHaveLength(0);
  });

  it('answers 404 for an unknown template and 409 for one still awaiting approval', async () => {
    const missing = makeApp({ instantiate: async () => { const e = new Error('nope'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; } });
    const proposal = makeApp({ instantiate: async () => { const e = new Error('nope'); e.code = 'TEMPLATE_NOT_ACTIVE'; throw e; } });
    expect((await request(missing.app).post('/api/v1/health/nutrition/templates/t1/instantiate').send({})).status).toBe(404);
    expect((await request(proposal.app).post('/api/v1/health/nutrition/templates/t1/instantiate').send({})).status).toBe(409);
  });

  it('DELETE /nutrition/templates/:id removes it', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).delete('/api/v1/health/nutrition/templates/t1');
    expect(res.status).toBe(200);
    expect(calls.remove[0]).toEqual({ id: 't1', userId: 'testuser' });
  });

  it('POST /:id/approve names the proposal', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).post('/api/v1/health/nutrition/templates/t1/approve').send({ name: 'Morning smoothie' });
    expect(res.status).toBe(200);
    expect(calls.approve[0]).toEqual({ id: 't1', userId: 'testuser', options: { name: 'Morning smoothie' } });
  });

  it('POST /:id/dismiss returns the key it will remember', async () => {
    const { app, calls } = makeApp();
    const res = await request(app).post('/api/v1/health/nutrition/templates/t1/dismiss').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, key: 'k1' });
    expect(calls.dismiss[0]).toEqual({ id: 't1', userId: 'testuser' });
  });

  it('approve and dismiss answer 404 for an id that is not there', async () => {
    const notFound = () => { const e = new Error('nope'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; };
    const { app } = makeApp({ approve: async () => notFound(), dismiss: async () => notFound() });
    expect((await request(app).post('/api/v1/health/nutrition/templates/x/approve').send({})).status).toBe(404);
    expect((await request(app).post('/api/v1/health/nutrition/templates/x/dismiss').send({})).status).toBe(404);
  });

  it('the suggest endpoint routes its result through the template merge', async () => {
    const calls = { merge: [] };
    const router = createHealthRouter({
      healthOperations: { defaultUsername: () => 'testuser', currentDate: () => '2026-09-04' },
      catalogService: { suggest: async () => [{ id: 'f1', name: 'Oatmeal' }] },
      templateService: {
        list: async () => [],
        mergeIntoSuggestions: async (foods, opts) => {
          calls.merge.push({ foods, opts });
          return [{ id: 't1', type: 'template', name: 'Morning smoothie' }, ...foods.map((f) => ({ ...f, type: 'food' }))];
        },
      },
      logger: silent,
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/health', router);
    const res = await request(app).get('/api/v1/health/nutrition/catalog/suggest?q=oat&limit=8&bucket=morning');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.type)).toEqual(['template', 'food']);
    expect(calls.merge[0].opts).toEqual({ query: 'oat', userId: 'testuser', limit: 8 });
  });

  it('with no template service the suggest endpoint still answers with the plain catalog list', async () => {
    const router = createHealthRouter({
      healthOperations: { defaultUsername: () => 'testuser', currentDate: () => '2026-09-04' },
      catalogService: { suggest: async () => [{ id: 'f1', name: 'Oatmeal' }] },
      logger: silent,
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/health', router);
    const res = await request(app).get('/api/v1/health/nutrition/catalog/suggest');
    expect(res.body.items).toEqual([{ id: 'f1', name: 'Oatmeal' }]);
  });

  it('the routes do not exist at all when no template service is composed', async () => {
    const router = createHealthRouter({
      healthOperations: { defaultUsername: () => 'testuser', currentDate: () => '2026-09-04' },
      logger: silent,
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/health', router);
    expect((await request(app).get('/api/v1/health/nutrition/templates')).status).toBe(404);
  });
});
