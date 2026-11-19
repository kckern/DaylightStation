import fs from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWebNutribotProxy } from "./webNutribotProxy.mjs";
import { HealthOperations } from "../../../health/server/application/health/HealthOperations.mjs";
import { createHealthRouter } from "../../../health/server/api/routers/health.mjs";

const operationsSource = fs.readFileSync(new URL('../../../health/server/application/health/HealthOperations.mjs', import.meta.url), 'utf8');
// Read from the source, so a new call that the proxy does not forward fails here.
const calledByHealth = [...new Set([...operationsSource.matchAll(/this\.nutritionInput\??\.(\w+)/g)].map(match => match[1]))];
const silent = { debug() {}, info() {}, warn() {}, error() {} };

it('forwards read-only meal suggestions through the same deferred adapter used by Health', async () => {
  const proxy = createWebNutribotProxy();
  const health = new HealthOperations({ healthData: {}, nutritionInput: proxy });
  const input = { userId: 'u', date: '2026-09-06', bucket: 'evening', selectedIds: [] };
  await expect(health.suggestMealGroups(input)).rejects.toThrow('not yet initialized');
  proxy._delegate = { marker: 'delegate', async suggestMealGroups(received) {
    expect(this.marker).toBe('delegate'); expect(received).toBe(input);
    return { committed: false, groups: [], proposals: [] };
  } };
  await expect(health.suggestMealGroups(input)).resolves.toMatchObject({ committed: false, groups: [] });
});

describe('every adapter method Health calls', () => {
  it('is found by the source scan', () => {
    expect(calledByHealth).toEqual(expect.arrayContaining(['process', 'processCallback', 'processDayInput', 'reviewPending', 'listPendingByDate', 'suggestMealGroups', 'reviseEntry', 'reviseDish']));
  });
  it.each(calledByHealth)('%s reaches the adapter with its arguments', async method => {
    const proxy = createWebNutribotProxy();
    expect(proxy[method], `${method} is not forwarded`).toBeTypeOf('function');
    await expect(proxy[method]('x')).rejects.toThrow('not yet initialized');
    proxy._delegate = { marker: 'delegate', [method](...args) { return { self: this.marker, args }; } };
    expect(await proxy[method]('a', 'b')).toEqual({ self: 'delegate', args: ['a', 'b'] });
  });
});

describe('the Health routes through the proxy', () => {
  const setup = () => {
    const proxy = createWebNutribotProxy();
    proxy._delegate = {
      processDayInput: vi.fn(async () => ({ committed: true, outcome: 'committed', kind: 'added', message: 'Logged Eggs' })),
      reviewPending: vi.fn(async () => ({ committed: true, logId: 'log' })),
    };
    const healthOperations = new HealthOperations({ healthData: {}, nutritionInput: proxy, today: () => '2026-11-18', resolveDefaultUsername: () => 'u' });
    return { adapter: proxy._delegate, app: express().use(express.json()).use(createHealthRouter({ healthOperations, logger: silent })) };
  };
  it('POST /nutrition/day-input reaches the adapter, with the server\'s today', async () => {
    const { app, adapter } = setup();
    const response = await request(app).post('/nutrition/day-input').send({ type: 'text', content: 'eggs', date: '2026-11-17', operationId: 'op' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ outcome: 'committed', kind: 'added', message: 'Logged Eggs' });
    expect(adapter.processDayInput).toHaveBeenCalledWith({ userId: 'u', type: 'text', content: 'eggs', date: '2026-11-17', resolved: {}, operationId: 'op', today: '2026-11-18' });
  });
  it('POST /nutrition/pending/:id/review reaches the adapter', async () => {
    const { app, adapter } = setup();
    const response = await request(app).post('/nutrition/pending/log/review').send({ expectedVersion: 'v1', operationId: 'op', action: 'accept' });
    expect(response.status).toBe(200);
    expect(adapter.reviewPending).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', logUuid: 'log', expectedVersion: 'v1', operationId: 'op', action: 'accept' }));
  });
});
