import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EinkPanelService, prepareEinkRenderData } from './EinkPanelService.mjs';
import { createEinkPanelRenderer } from '#rendering/eink/EinkPanelRenderer.mjs';
import { Sha1ContentFingerprint } from '#adapters/eink/Sha1ContentFingerprint.mjs';

const dataSourceGateway = { resolve: async () => ({}) };
const fingerprint = new Sha1ContentFingerprint();

test('EinkPanelService delegates pixels to its semantic panel renderer', async () => {
  const calls = [];
  const png = Buffer.from('panel-png');
  const service = new EinkPanelService({
    panelStore: {
      getPanel: () => ({
          hardware: { display: { width: 800, height: 480, color: 'gray16' } },
          content: { views: [{ id: 'home', layout: { children: [] }, data: {} }] },
        }), getTelemetry: () => ({}), saveTelemetry() {},
    },
    dataSourceGateway,
    fingerprint,
    clock: () => new Date('2026-08-28T12:00:00.000Z'),
    panelRenderer: {
      version: 'test-renderer-v1',
      async render(screen, options) { calls.push({ screen, options }); return png; },
    },
    logger: { info() {} },
  });

  const result = await service.renderResult('kitchen');

  assert.equal(result.png, png);
  assert.equal(result.view, 'home');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].screen.width, 800);
  assert.equal(calls[0].options.grayscale, true);
  assert.equal(calls[0].options.renderReferenceTime.toISOString(), '2026-08-28T12:00:00.000Z');
});

test('EinkPanelService requires the panel rendering capability', () => {
  assert.throws(
    () => new EinkPanelService({ panelStore: {} }),
    /panelStore/,
  );
});

test('production EInk renderer satisfies the semantic capability', () => {
  assert.doesNotThrow(() => new EinkPanelService({
    panelStore: { getPanel() {}, getTelemetry() {}, saveTelemetry() {} },
    dataSourceGateway,
    fingerprint,
    panelRenderer: createEinkPanelRenderer(),
  }));
});

test('prepareEinkRenderData selects the next twelve forecast hours before rendering', () => {
  const past = { unix: 100, temp: 1 };
  const future = Array.from({ length: 14 }, (_, index) => ({ unix: 200 + index, temp: index }));
  const prepared = prepareEinkRenderData(
    { weather: { current: { temp: 20 }, hourly: [past, ...future] }, untouched: true },
    new Date(200 * 1000),
  );

  assert.deepEqual(prepared.weather.forecastHours, future.slice(0, 12));
  assert.equal(prepared.untouched, true);
  assert.equal(prepared.weather.hourly.length, 15);
});

test('prepareEinkRenderData preserves the legacy first-twelve fallback', () => {
  const hourly = Array.from({ length: 14 }, (_, index) => ({ unix: 100 + index }));
  const prepared = prepareEinkRenderData(
    { weather: { hourly } },
    new Date(1_000 * 1000),
  );
  assert.deepEqual(prepared.weather.forecastHours, hourly.slice(0, 12));
});
