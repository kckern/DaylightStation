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
import { createStateGatesModule } from './modules/stateGates.mjs';
import { createFitnessPlayableModule } from './modules/fitnessApi.mjs';
import { createApplicationScheduledJobs } from './modules/applicationScheduledJobs.mjs';
import { createSchoolApiServices } from './modules/schoolApi.mjs';
import { GratitudePrintPresentationService } from '#apps/gratitude/services/GratitudePrintPresentationService.mjs';
import { ProviderFitnessContentCatalog } from '#adapters/fitness/ProviderFitnessContentCatalog.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    id: 'state-gates.atomic-foundation-wiring',
    async verify() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-composition-'));
      const policy = { schema: 'daylight.state-gates-policy/v1', policy_revision: 1, publishers: {}, subject_sets: {}, claim_types: {}, gates: {}, entitlements: {} };
      const eventBus = { publish: vi.fn() };
      const module = await createStateGatesModule({
        householdId: 'home', eventBus, roleIds: ['admin', 'parent'],
        clock: { now: () => Date.parse('2026-08-30T12:00:00-07:00') },
        configService: {
          getHouseholdPath: () => path.join(directory, 'state-gates/current'),
          reloadHouseholdAppConfig: () => policy,
          getHouseholdAppConfig: () => policy,
          getHouseholdUsers: () => ['learner-a'],
          getHouseholdDevices: () => ({ devices: {} }),
          getHouseholdTimezone: () => 'America/Los_Angeles',
          getAllHouseholdIds: () => [],
        },
        logger: logger(),
      });
      try {
        expect(module.stateGatesRouter).toEqual(expect.any(Function));
        expect(module.entitlementsRouter).toEqual(expect.any(Function));
        expect(await module.container.getCurrentGates('home')).toMatchObject({ currentRevision: 1, items: [] });
        expect(fs.existsSync(path.join(directory, 'state-gates/current.yml'))).toBe(true);
      } finally {
        module.dispose();
        fs.rmSync(directory, { recursive: true, force: true });
      }
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
  {
    id: 'gratitude.print-presentation-explicit-runtime',
    async verify() {
      const item = (id) => ({
        id, datetime: '2026-08-29T12:00:00.000Z', printCount: 0,
        displayName: 'Family', item: { text: id },
      });
      const base = {
        gratitude: { getSelectionsForPrint: async () => ({
          gratitude: ['g1', 'g2', 'g3'].map(item),
          hopes: ['h1', 'h2', 'h3'].map(item),
        }) },
        resolveGroupLabel: () => 'Family',
        clock: { now: () => Date.parse('2026-08-30T12:00:00.000Z') },
        random: () => 0,
      };
      const presentation = new GratitudePrintPresentationService(base);
      await expect(presentation.prepare('home')).resolves.toMatchObject({
        gratitude: [{ id: expect.any(String) }, { id: expect.any(String) }],
        hopes: [{ id: expect.any(String) }, { id: expect.any(String) }],
      });
      expect(() => new GratitudePrintPresentationService({ ...base, random: null }))
        .toThrow('GratitudePrintPresentationService requires random');
    },
  },
  {
    id: 'fitness.shared-playable-semantic-catalog',
    verify() {
      const adapter = { source: 'plex' };
      const module = createFitnessPlayableModule({
        configService: {
          getDefaultHouseholdId: () => 'home',
          getHouseholdAppConfig: () => ({ content_source: 'plex' }),
        },
        fitnessConfig: { content_source: 'plex', plex: { library_id: 14 } },
        contentRegistry: { get: () => adapter },
        contentQueryService: {},
      });
      expect(module.fitnessContentAdapter).toBe(adapter);
      expect(module.fitnessContentCatalog).toBeInstanceOf(ProviderFitnessContentCatalog);
      expect(module.fitnessPlayableService).toEqual(expect.any(Object));
    },
  },
  {
    id: 'scheduler.deleted-module-workflows-registered',
    verify() {
      const executor = createApplicationScheduledJobs({
        financeHarvestService: { harvest: vi.fn() },
        healthService: { execute: vi.fn() },
        archiveService: { rotateToArchive: vi.fn() },
        loadArchiveConfig: () => ({ services: {} }),
        mediaMemoryValidator: { validateMediaMemory: vi.fn() },
        resolveHouseholdId: () => 'home',
        resolveUsername: () => 'parent',
      });
      expect(['budget', 'health', 'archive-rotation', 'media-memory-validator']
        .every((id) => executor.canHandle(id))).toBe(true);
    },
  },
  {
    id: 'school.production-semantic-service-composer',
    verify() {
      const services = createSchoolApiServices({ schoolService: {} });
      expect(services).toMatchObject({
        schoolResourceService: expect.any(Object),
        schoolPrintAccess: expect.any(Object),
        schoolRecordsQuery: expect.any(Object),
        schoolReportDocuments: expect.any(Object),
        schoolCurriculumQuery: expect.any(Object),
        schoolArtifactService: expect.any(Object),
        schoolApiSessions: expect.any(Object),
      });
    },
  },
];

describe('composition contract registry', () => {
  it.each(contracts)('$id', async ({ verify }) => {
    await verify();
  });
});
