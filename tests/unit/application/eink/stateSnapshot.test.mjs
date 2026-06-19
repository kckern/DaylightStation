import { describe, it, expect } from 'vitest';
import { EinkPanelService } from '#apps/eink/EinkPanelService.mjs';

// A screen with two distinct, data-free views (so resolveData returns {} with no
// network) — lets us exercise the fingerprint logic without a canvas render.
const SCREEN = {
  hardware: { display: { rotation: 270 } },
  buttons: { green: 'select', right: 'next', left: 'prev' },
  refresh: { interval: '15min' },
  content: {
    width: 1872,
    height: 1404,
    views: [
      { id: 'home', layout: { children: [{ widget: 'date' }] } },
      { id: 'dashboard', layout: { children: [{ widget: 'placeholder' }] } },
    ],
  },
};

const makeService = (screen = SCREEN) => new EinkPanelService({
  baseUrl: 'http://test.local',
  dataService: { household: { read: () => screen } },
  logger: { info() {} },
});

describe('EinkPanelService.stateSnapshot', () => {
  it('returns runtime config + cadence + image link + a hash, without rendering', async () => {
    const snap = await makeService().stateSnapshot('kitchen-eink');
    expect(snap.id).toBe('kitchen-eink');
    expect(snap.rotation).toBe(270);
    expect(snap.buttons).toEqual({ green: 'select', right: 'next', left: 'prev' });
    expect(snap.nextWakeSec).toBeGreaterThan(0);
    expect(snap.image).toBe('/api/v1/eink/kitchen-eink/panel');
    expect(snap.view).toBe('home');
    expect(snap.imageHash).toMatch(/^[0-9a-f]{40}$/); // sha1 hex
  });

  it('is deterministic — identical now-state yields the same hash', async () => {
    const svc = makeService();
    const a = await svc.stateSnapshot('kitchen-eink');
    const b = await svc.stateSnapshot('kitchen-eink');
    expect(b.imageHash).toBe(a.imageHash);
  });

  it('changes the hash when the current view changes', async () => {
    const svc = makeService();
    const home = await svc.stateSnapshot('kitchen-eink');
    await svc.advance('kitchen-eink', 'next');
    const dash = await svc.stateSnapshot('kitchen-eink');
    expect(dash.view).toBe('dashboard');
    expect(dash.imageHash).not.toBe(home.imageHash);
  });

  it('changes the hash on a refresh action WITHOUT changing the view (force redraw)', async () => {
    const svc = makeService();
    const before = await svc.stateSnapshot('kitchen-eink');
    const result = await svc.advance('kitchen-eink', 'refresh');
    const after = await svc.stateSnapshot('kitchen-eink');
    expect(result.refreshNonce).toBe(1);
    expect(after.view).toBe(before.view);          // same view (no paging)
    expect(after.imageHash).not.toBe(before.imageHash); // but a new hash -> panel redraws
  });

  it('a no-op select leaves the hash unchanged', async () => {
    const svc = makeService();
    const before = await svc.stateSnapshot('kitchen-eink');
    await svc.advance('kitchen-eink', 'select');
    const after = await svc.stateSnapshot('kitchen-eink');
    expect(after.imageHash).toBe(before.imageHash);
  });

  it('404s when the panel config is missing', async () => {
    const svc = new EinkPanelService({
      dataService: { household: { read: () => null } },
      logger: { info() {} },
    });
    await expect(svc.stateSnapshot('nope')).rejects.toMatchObject({ status: 404 });
  });
});
