/**
 * Composition contract registry
 *
 * One fast, dependency-free pre-deploy gate for seams where a feature can be
 * correctly implemented yet unavailable at runtime because composition passed
 * the wrong object, omitted a capability, or silently selected a fallback.
 *
 * Add a case here when a new cross-layer capability is introduced.  Each case
 * must exercise the real composition boundary with fakes only at the external
 * edge (filesystem, network, or messaging transport).
 */
import { describe, expect, it, vi } from 'vitest';
import { createNutribotServices } from './bootstrap.mjs';
import { createFeedRouter } from '#api/v1/routers/feed.mjs';
import { createArtRouter } from '#api/v1/routers/art.mjs';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const contracts = [
  {
    id: 'nutribot.rendered-report-delivery',
    async verify() {
      const rendered = Buffer.from('png');
      const renderer = { renderDailyReport: vi.fn().mockResolvedValue(rendered) };
      const log = logger();
      const { nutribotContainer } = await createNutribotServices({
        configService: {
          getPath: () => '/tmp/daylight-composition-icons',
          getUserDir: () => '/tmp/daylight-composition-user',
        },
        dataService: {},
        telegramAdapter: {},
        aiGateway: {},
        reportRenderer: renderer,
        logger: log,
      });

      // This traverses the production composition path: renderer -> delivery
      // port -> container. It fails if any name changes or the capability is
      // silently dropped (the failure that produced text-only reports).
      const delivery = nutribotContainer.getReportDelivery();
      expect(delivery).toEqual(expect.objectContaining({ prepare: expect.any(Function) }));
      const prepared = await delivery.prepare({ date: '2026-08-27' });
      const messaging = { sendPhoto: vi.fn().mockResolvedValue({ messageId: 'photo-1' }) };
      await prepared.sendTo(messaging, 'caption', { inline: true });

      expect(renderer.renderDailyReport).toHaveBeenCalledWith({ date: '2026-08-27' });
      expect(messaging.sendPhoto).toHaveBeenCalledWith(
        expect.stringMatching(/report-2026-08-27-\d+\.png$/),
        'caption',
        { inline: true },
      );
      expect(log.info).toHaveBeenCalledWith('nutribot.report.delivery.configured', { mode: 'photo' });
    },
  },
  {
    id: 'feed.router-required-runtime-capabilities',
    verify() {
      const base = {
        feedReaderService: {},
        headlineService: {},
        feedAssemblyService: {},
        feedContentService: {},
        feedPrincipalResolver: { resolve: () => 'alice' },
        feedReaderTimelineService: {},
        feedScrollSessionService: {},
      };
      expect(() => createFeedRouter(base)).not.toThrow();
      for (const dependency of Object.keys(base)) {
        const missing = { ...base };
        delete missing[dependency];
        expect(() => createFeedRouter(missing)).toThrow(`createFeedRouter requires ${dependency}`);
      }
    },
  },
  {
    id: 'art.router-semantic-service',
    verify() {
      expect(() => createArtRouter({
        artService: { selectFeatured: async () => ({}), getPreset: async () => ({}) },
      })).not.toThrow();
      expect(() => createArtRouter({ artService: {} }))
        .toThrow('createArtRouter requires artService with selectFeatured and getPreset');
    },
  },
];

describe('composition contract registry', () => {
  it.each(contracts)('$id', async ({ verify }) => {
    await verify();
  });
});

