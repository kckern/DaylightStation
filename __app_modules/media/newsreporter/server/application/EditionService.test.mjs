import { describe, it, expect } from 'vitest';
import {
  harness, headlineServiceFake, feedSourcesFake, decisionGatewayFake, printerRegistryFake,
} from './edition/fixtures/editionHarness.mjs';
import { sampleEditionConfig } from './edition/fixtures/editionFixtures.mjs';

const TODAY = '2026-11-24';

describe('EditionService.compose', () => {
  it('composes, renders and stores the day\'s edition', async () => {
    const h = harness();
    const result = await h.service.compose('office-paper');
    expect(result.status).toBe('composed');
    const stored = await h.store.get('office-paper', TODAY);
    expect(stored).toMatchObject({ number: 1, status: 'composed', deliveries: [], error: null });
    expect(h.store.pngs.get(`office-paper/${TODAY}`).subarray(1, 4).toString()).toBe('PNG');
    expect(stored.inputs.pick).toEqual({ method: 'decision', units: 4, failed: 0 });
    expect(stored.inputs.headlines).toBe(5);
    expect(stored.inputs.missing).toEqual([]);
    expect(stored.layout.masthead).toMatchObject({ title: 'The Daylight Ledger', number: 1, weatherLabel: '41°/22°' });
    const types = stored.layout.blocks.map((b) => b.type);
    expect(types.slice(0, 4)).toEqual(['weather', 'agenda', 'tasks', 'lead']);
    // The budget cluster (two outlets) is the lead, and it carries its interest.
    expect(stored.stories[0]).toMatchObject({ category: 'lead', urls: ['https://cnn.example/budget', 'https://bbc.example/budget'], interest: 3 });
    expect(stored.stories.every((s) => s.urls.length === s.titles.length)).toBe(true);
    expect(h.aiGateway.chatStructured).toHaveBeenCalledTimes(1); // write only; pick went to the decision gateway
    expect(h.logger.events.map((e) => e.event)).toEqual(expect.arrayContaining(['newsreporter.edition.compose.start', 'newsreporter.edition.compose.complete']));
  });

  it('numbers from the previous edition and keeps the number on a recompose', async () => {
    const h = harness();
    await h.store.save('office-paper', '2026-11-23', { number: 141, status: 'composed', stories: [], inputs: { modules: [] }, deliveries: [] });
    await h.service.compose('office-paper');
    expect((await h.store.get('office-paper', TODAY)).number).toBe(142);
    await h.service.compose('office-paper');
    expect((await h.store.get('office-paper', TODAY)).number).toBe(142);
  });

  it('leaves out a module that fails and names it in missing', async () => {
    const h = harness({ feedSources: feedSourcesFake({ failing: ['tasks'] }) });
    await h.service.compose('office-paper');
    const stored = await h.store.get('office-paper', TODAY);
    expect(stored.inputs.missing).toEqual(['todoist']);
    expect(stored.layout.blocks.some((b) => b.type === 'tasks')).toBe(false);
    expect(h.logger.events.some((e) => e.event === 'newsreporter.edition.gather.module_failed' && e.data.module === 'todoist')).toBe(true);
  });

  it('carries school from the previous study day', async () => {
    const h = harness();
    await h.service.compose('office-paper');
    const stored = await h.store.get('office-paper', TODAY);
    expect(stored.layout.blocks.find((b) => b.type === 'note' && b.module === 'school')).toMatchObject({ text: 'school line' });
  });

  it('fails the run when headlines fail, recording a failed edition', async () => {
    const h = harness({ headlines: headlineServiceFake({ fail: true }) });
    const result = await h.service.compose('office-paper');
    expect(result).toMatchObject({ status: 'failed', error: 'headline cache unreadable' });
    expect(await h.store.get('office-paper', TODAY)).toMatchObject({ status: 'failed', error: 'headline cache unreadable' });
    expect(h.logger.events.some((e) => e.event === 'newsreporter.edition.compose.error')).toBe(true);
  });

  it('a failed recompose never replaces a good edition', async () => {
    const h = harness();
    await h.service.compose('office-paper');
    h.headlines.getAllHeadlines.mockRejectedValue(new Error('gone'));
    expect((await h.service.compose('office-paper')).status).toBe('failed');
    expect((await h.store.get('office-paper', TODAY)).status).toBe('composed');
  });

  it('dry run returns the edition and base64 PNG and stores nothing', async () => {
    const h = harness();
    const result = await h.service.compose('office-paper', { dryRun: true });
    expect(result.status).toBe('composed');
    expect(result.edition.layout.blocks.length).toBeGreaterThan(4);
    expect(Buffer.from(result.png, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(result.png.startsWith('data:')).toBe(false);
    expect(h.store.records.size).toBe(0);
    expect(h.store.pngs.size).toBe(0);
  });

  it('fails before any model call on an unknown source id', async () => {
    const cfg = sampleEditionConfig();
    cfg.news.categories[2].sources = ['arstechnica', 'nosuch'];
    const h = harness({ config: cfg });
    const result = await h.service.compose('office-paper');
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/news\.categories\[2\]\.sources\[1\]: unknown source id "nosuch"/);
    expect(h.decisionGateway.evaluate).not.toHaveBeenCalled();
    expect(h.aiGateway.chatStructured).not.toHaveBeenCalled();
  });

  it('falls back to the chat pick without a decision gateway', async () => {
    const h = harness({ decisionGateway: null });
    await h.service.compose('office-paper');
    const stored = await h.store.get('office-paper', TODAY);
    expect(stored.inputs.pick).toEqual({ method: 'chat', units: 5, failed: 0 });
    expect(h.aiGateway.chatStructured).toHaveBeenCalledTimes(2);
  });

  it('falls back to the chat pick when most decisions fail', async () => {
    const h = harness({ decisionGateway: decisionGatewayFake({ failAll: true }) });
    await h.service.compose('office-paper');
    expect((await h.store.get('office-paper', TODAY)).inputs.pick.method).toBe('chat');
  });

  it('sums the edition cost from the usage ledger', async () => {
    const costReader = { listCosts: async (q) => (q.app === 'newsreporter' && q.feature === 'office-paper' ? [{ costUsd: 0.01 }, { costUsd: 0.0234 }] : []) };
    const h = harness({ costReader });
    await h.service.compose('office-paper');
    expect((await h.store.get('office-paper', TODAY)).costUsd).toBe(0.0334);
  });

  it('refuses a report-kind or unknown reporter', async () => {
    const h = harness();
    await expect(h.service.compose('world-cup')).rejects.toThrow();
    await expect(h.service.compose('nope')).rejects.toThrow();
  });
});

describe('EditionService.deliver', () => {
  it('prints the stored PNG once, unrouted, as one 576-wide image', async () => {
    const h = harness();
    await h.service.compose('office-paper');
    const result = await h.service.deliver('office-paper', { trigger: 'ha' });
    expect(result.status).toBe('printed');
    expect(h.printerRegistry.get).toHaveBeenCalledWith('office');
    expect(h.printerRegistry.resolve).not.toHaveBeenCalled();
    const job = h.printerRegistry.printer.print.mock.calls[0][0];
    expect(job.items).toHaveLength(1);
    expect(job.items[0]).toMatchObject({ type: 'image', path: `/media/newsreporter/office-paper/${TODAY}.png`, width: 576 });
    expect(job.items[0].height).toBeGreaterThan(1000);
    expect(job.transcript).toMatch(/THE DAYLIGHT LEDGER/);
    const stored = await h.store.get('office-paper', TODAY);
    expect(stored.deliveries).toEqual([{ at: h.now.value.toISOString(), printer: 'office', trigger: 'ha', confirmed: true }]);
    expect(result.edition).toMatchObject({ deliveredAt: h.now.value.toISOString(), printer: 'office' });
  });

  it('is once per day unless forced', async () => {
    const h = harness();
    await h.service.compose('office-paper');
    await h.service.deliver('office-paper');
    expect((await h.service.deliver('office-paper')).status).toBe('already_delivered');
    expect(h.printerRegistry.printer.print).toHaveBeenCalledTimes(1);
    expect((await h.service.deliver('office-paper', { force: true, printer: 'upstairs' })).status).toBe('printed');
    expect(h.printerRegistry.get).toHaveBeenLastCalledWith('upstairs');
    expect((await h.store.get('office-paper', TODAY)).deliveries).toHaveLength(2);
  });

  it('two triggers at once print once', async () => {
    const h = harness();
    await h.service.compose('office-paper');
    const [a, b] = await Promise.all([h.service.deliver('office-paper'), h.service.deliver('office-paper')]);
    expect([a.status, b.status].sort()).toEqual(['already_delivered', 'printed']);
    expect(h.printerRegistry.printer.print).toHaveBeenCalledTimes(1);
  });

  it('is expired after expires_after, unless forced', async () => {
    const h = harness();
    await h.service.compose('office-paper');
    h.now.value = new Date('2026-11-24T19:05:00Z'); // 12:05 in Denver
    expect((await h.service.deliver('office-paper')).status).toBe('expired');
    expect(h.printerRegistry.printer.print).not.toHaveBeenCalled();
    expect((await h.service.deliver('office-paper', { force: true })).status).toBe('printed');
  });

  it('a past day is expired', async () => {
    const h = harness();
    expect((await h.service.deliver('office-paper', { date: '2026-11-20' })).status).toBe('expired');
  });

  it('composes then prints when no edition exists', async () => {
    const h = harness();
    const result = await h.service.deliver('office-paper');
    expect(result.status).toBe('composed_then_printed');
    expect(h.printerRegistry.printer.print).toHaveBeenCalledTimes(1);
    expect((await h.store.get('office-paper', TODAY)).deliveries).toHaveLength(1);
  });

  it('composes then prints over a failed edition', async () => {
    const h = harness();
    await h.store.save('office-paper', TODAY, { status: 'failed', error: 'x', deliveries: [] });
    expect((await h.service.deliver('office-paper')).status).toBe('composed_then_printed');
  });

  it('reports compose_failed when it cannot compose', async () => {
    const h = harness({ headlines: headlineServiceFake({ fail: true }) });
    const result = await h.service.deliver('office-paper');
    expect(result.status).toBe('compose_failed');
    expect(h.printerRegistry.printer.print).not.toHaveBeenCalled();
  });

  it('print_failed leaves the edition undelivered so a later deliver retries', async () => {
    let attempt = 0;
    const registry = printerRegistryFake(() => (++attempt === 1 ? { dispatched: false, verified: false, verification: 'unreadable' } : { dispatched: true, verified: false, verification: 'unreadable' }));
    const h = harness({ printerRegistry: registry });
    await h.service.compose('office-paper');
    expect((await h.service.deliver('office-paper')).status).toBe('print_failed');
    expect((await h.store.get('office-paper', TODAY)).deliveries).toEqual([]);
    expect(h.logger.events.some((e) => e.event === 'newsreporter.edition.deliver.failed' && e.level === 'warn')).toBe(true);
    const second = await h.service.deliver('office-paper');
    expect(second.status).toBe('printed');
    expect((await h.store.get('office-paper', TODAY)).deliveries[0].confirmed).toBe(false);
  });

  it('a reported printer fault is print_failed', async () => {
    const h = harness({ printerRegistry: printerRegistryFake({ dispatched: true, verified: false, verification: 'faulted', faults: ['cover_open'] }) });
    await h.service.compose('office-paper');
    expect(await h.service.deliver('office-paper')).toMatchObject({ status: 'print_failed', error: 'printer fault: cover_open' });
  });

  it('an unknown printer is print_failed, never another printer', async () => {
    const h = harness();
    await h.service.compose('office-paper');
    const result = await h.service.deliver('office-paper', { printer: 'garage' });
    expect(result).toMatchObject({ status: 'print_failed', printer: 'garage' });
    expect(h.printerRegistry.resolve).not.toHaveBeenCalled();
  });

  it('uses the routed printer only when deliver.fallback is true', async () => {
    const cfg = sampleEditionConfig({ deliver: { printer: 'office', fallback: true } });
    const h = harness({ config: cfg });
    await h.service.compose('office-paper');
    await h.service.deliver('office-paper');
    expect(h.printerRegistry.resolve).toHaveBeenCalledWith('office');
    expect(h.printerRegistry.get).not.toHaveBeenCalled();
  });
});

describe('EditionService reads', () => {
  it('lists summaries newest first and serves the image', async () => {
    const h = harness();
    await h.store.save('office-paper', '2026-11-23', { number: 9, status: 'composed', composedAt: 'x', deliveries: [{ at: 'y', printer: 'office' }], costUsd: 0.02, inputs: { missing: ['strava'] }, layout: { blocks: [{ type: 'lead', headline: 'Old lead' }] } });
    await h.service.compose('office-paper');
    const list = await h.service.listEditions('office-paper');
    expect(list.map((e) => e.date)).toEqual([TODAY, '2026-11-23']);
    expect(list[1]).toEqual({ date: '2026-11-23', number: 9, status: 'composed', composedAt: 'x', deliveredAt: 'y', printer: 'office', costUsd: 0.02, leadHeadline: 'Old lead', missing: ['strava'] });
    expect((await h.service.getImage('office-paper', TODAY)).length).toBeGreaterThan(1000);
    expect(h.service.printers()).toEqual(['office', 'upstairs']);
  });
});
