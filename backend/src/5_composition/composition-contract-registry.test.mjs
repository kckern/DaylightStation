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
import { createLanguageStudyService } from './modules/schoolLanguage.mjs';
import { GratitudePrintPresentationService } from '#apps/gratitude/services/GratitudePrintPresentationService.mjs';
import { ProviderFitnessContentCatalog } from '#adapters/fitness/ProviderFitnessContentCatalog.mjs';
import { INSTALLED_STATE_GATES_POLICY } from './modules/installedStateGatesPolicy.mjs';
import { YamlStateGatesPolicySource } from '#adapters/state-gates/index.mjs';
import { createLibbyRuntime } from './modules/libby.mjs';
import { LibbyStreamGateway } from '#adapters/content/media/libby/LibbyStreamGateway.mjs';
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
          getHouseholdUsers: () => ['user_4'],
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
    id: 'state-gates.installed-school-fitness-contracts',
    async verify() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-installed-'));
      const schoolPrincipal = Object.freeze({ service: 'school' });
      const fitnessPrincipal = Object.freeze({ service: 'fitness' });
      const kioskFrictionPrincipal = Object.freeze({ service: 'kiosk-friction-tracker' });
      const now = Date.parse('2026-08-30T12:00:00-07:00');
      const module = await createStateGatesModule({
        householdId: 'home', eventBus: { publish: vi.fn() },
        // Every publisher the installed policy declares (school, fitness,
        // kiosk-friction-tracker) needs authenticated authority here, or
        // PolicyGraph.create rejects the whole graph as UNKNOWN_PUBLISHER_AUTHORITY
        // — this fixture mirrors app.mjs's real producerPrincipals wiring.
        producerPrincipals: { school: schoolPrincipal, fitness: fitnessPrincipal, 'kiosk-friction-tracker': kioskFrictionPrincipal },
        clock: { now: () => now },
        configService: {
          getHouseholdPath: () => path.join(directory, 'state-gates/current'),
          reloadHouseholdAppConfig: () => null,
          getHouseholdAppConfig: () => null,
          getHouseholdUsers: () => ['user_4'],
          getHouseholdDevices: () => ({ devices: {} }),
          getHouseholdTimezone: () => 'America/Los_Angeles',
          getAllHouseholdIds: () => [],
        },
        logger: logger(),
      });
      try {
        const schoolPeriod = {
          kind: 'interval', id: 'school-day:2026-08-30',
          startsAt: Date.parse('2026-08-30T04:00:00-07:00'),
          endsAt: Date.parse('2026-08-31T04:00:00-07:00'),
        };
        await module.ingress.observe('home', schoolPrincipal, {
          assertionId: 'school:day-complete:user_4:2026-08-30',
          claimTypeId: 'school.day.complete', subject: { kind: 'learner', id: 'user_4' },
          period: schoolPeriod, value: true, sourceRevision: 1,
          observedAt: now, validFrom: now, validUntil: schoolPeriod.endsAt,
        });
        const entitlement = await module.container.getCurrentEntitlements('home', {
          capabilityId: 'piano.games', subjectId: 'user_4', periodId: schoolPeriod.id,
        });
        expect(entitlement.items).toEqual([
          expect.objectContaining({ capabilityId: 'piano.games', decision: 'granted' }),
        ]);
        await module.ingress.observe('home', schoolPrincipal, {
          assertionId: 'school:day-complete:user_4:2026-08-30',
          claimTypeId: 'school.day.complete', subject: { kind: 'learner', id: 'user_4' },
          period: schoolPeriod, value: false, sourceRevision: 2,
          observedAt: now, validFrom: now, validUntil: schoolPeriod.endsAt,
        });
        expect((await module.container.getCurrentEntitlements('home', {
          capabilityId: 'piano.games', subjectId: 'user_4', periodId: schoolPeriod.id,
        })).items[0]).toMatchObject({ decision: 'denied', degraded: false });
        await module.ingress.retract('home', schoolPrincipal, {
          assertionId: 'school:day-complete:user_4:2026-08-30',
          sourceRevision: 3, retractedAt: now,
        });
        expect((await module.container.getCurrentEntitlements('home', {
          capabilityId: 'piano.games', subjectId: 'user_4', periodId: schoolPeriod.id,
        })).items[0]).toMatchObject({ decision: 'denied', degraded: true });

        const fitnessPeriod = {
          kind: 'interval', id: 'fitness-week:2026-08-30:2026-09-05',
          startsAt: Date.parse('2026-08-30T04:00:00-07:00'),
          endsAt: Date.parse('2026-09-06T04:00:00-07:00'),
        };
        await module.ingress.observe('home', fitnessPrincipal, {
          assertionId: 'fitness:weekly-rings:user_4:2026-08-30:2026-09-05',
          claimTypeId: 'fitness.weekly.rings', subject: { kind: 'learner', id: 'user_4' },
          period: fitnessPeriod, value: 42, sourceRevision: 1,
          observedAt: now, validFrom: now, validUntil: fitnessPeriod.endsAt,
        });
        const gates = await module.container.getCurrentGates('home', {
          gateId: 'fitness.weekly-rings', subjectId: 'user_4', periodId: fitnessPeriod.id,
        });
        expect(gates.items[0].evaluation.progress).toMatchObject({ current: 42, target: 1, unit: 'rings' });
      } finally {
        module.dispose();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  },
  {
    // Regression coverage for the 2026-09-21 whole-branch review finding: a
    // future content change to INSTALLED_STATE_GATES_POLICY (a new claim
    // type, gate, or entitlement) that is NOT accompanied by a
    // policy_revision bump deploys completely INERT. The case above
    // ("installed-school-fitness-contracts") only ever activates into a
    // fresh empty store, which trivially succeeds at any revision number —
    // it never exercises the revision-conflict path, which is exactly what
    // shipped broken (production's real store already held an active
    // policy_revision:1 candidate; this branch changed content but left
    // policy_revision at 1, so activatePolicyGraph would have rejected the
    // new candidate and createStateGatesModule's startup `reconcile()`
    // swallows that rejection into a log line, silently keeping the old
    // graph forever).
    //
    // This exercises the SAME startup path (createStateGatesModule ->
    // container.reconcile()) three times against the same on-disk store,
    // simulating: (1) today's production state — the current installed
    // policy activates into a fresh store; (2) a future edit that changes
    // content but forgets to bump policy_revision — must NOT be adopted;
    // (3) the same content change WITH the revision bumped — must be
    // adopted. This is the guard that would have caught the shipped bug.
    id: 'state-gates.installed-policy-revision-guard',
    async verify() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gates-installed-revision-'));
      const now = Date.parse('2026-08-30T12:00:00-07:00');
      const configService = () => ({
        getHouseholdPath: () => path.join(directory, 'state-gates/current'),
        reloadHouseholdAppConfig: () => null,
        getHouseholdAppConfig: () => null,
        getHouseholdUsers: () => ['user_4'],
        getHouseholdDevices: () => ({ devices: {} }),
        getHouseholdTimezone: () => 'America/Los_Angeles',
        getAllHouseholdIds: () => [],
      });
      const producerPrincipals = {
        school: Object.freeze({ service: 'school' }),
        fitness: Object.freeze({ service: 'fitness' }),
        'kiosk-friction-tracker': Object.freeze({ service: 'kiosk-friction-tracker' }),
      };
      const boot = installedPolicy => createStateGatesModule({
        householdId: 'home', eventBus: { publish: vi.fn() }, producerPrincipals,
        clock: { now: () => now }, configService: configService(), logger: logger(),
        ...(installedPolicy ? { installedPolicy } : {}),
      });

      // (1) Today's production state: the real installed policy activates
      // into a fresh store via the normal startup reconcile.
      const first = await boot();
      let activeDigest;
      try {
        const diagnostics = await first.container.getDiagnostics('home', { id: 'test-admin', roles: ['admin'] });
        activeDigest = diagnostics.policy.active?.digest;
        expect(activeDigest).toEqual(expect.any(String));
        expect(diagnostics.policy.active.policyRevision).toBe(INSTALLED_STATE_GATES_POLICY.policy_revision);
      } finally {
        first.dispose();
      }

      // (2) A future edit changes content (adds a claim type) but forgets to
      // bump policy_revision — the exact mistake this branch shipped.
      // Startup must NOT silently adopt it; the store must keep serving the
      // old, already-active graph.
      const sameRevisionMutation = structuredClone(INSTALLED_STATE_GATES_POLICY);
      sameRevisionMutation.claim_types['kiosk.friction-score-v2'] =
        structuredClone(sameRevisionMutation.claim_types['kiosk.friction-score']);
      const second = await boot(sameRevisionMutation);
      try {
        const diagnostics = await second.container.getDiagnostics('home', { id: 'test-admin', roles: ['admin'] });
        expect(diagnostics.policy.active).toMatchObject({
          digest: activeDigest,
          policyRevision: INSTALLED_STATE_GATES_POLICY.policy_revision,
        });
        expect(diagnostics.policy.candidateValidation).toMatchObject({
          valid: false,
          errors: [{ code: 'POLICY_REVISION_CONFLICT' }],
        });
      } finally {
        second.dispose();
      }

      // (3) The same content change WITH policy_revision bumped is the
      // actual fix — startup must adopt it.
      sameRevisionMutation.policy_revision = INSTALLED_STATE_GATES_POLICY.policy_revision + 1;
      const third = await boot(sameRevisionMutation);
      try {
        const diagnostics = await third.container.getDiagnostics('home', { id: 'test-admin', roles: ['admin'] });
        expect(diagnostics.policy.active).toMatchObject({
          policyRevision: INSTALLED_STATE_GATES_POLICY.policy_revision + 1,
        });
        expect(diagnostics.policy.active.digest).not.toBe(activeDigest);
      } finally {
        third.dispose();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  },
  {
    // The kiosk.friction-ok gate declared a reason_labels entry for
    // THRESHOLD_NOT_MET but not for CLAIM_MISSING — the indeterminate path
    // (no friction claim observed yet for this device/period) produced an
    // unlabeled reason code. Verified through the real
    // YamlStateGatesPolicySource normalizer, matching the style of
    // fitness.weekly-rings' own CLAIM_MISSING label in the same file.
    id: 'state-gates.kiosk-friction-ok-has-claim-missing-label',
    async verify() {
      const policySource = new YamlStateGatesPolicySource({ load: async () => INSTALLED_STATE_GATES_POLICY });
      const candidate = await policySource.loadCandidate('home');
      expect(candidate.gates['kiosk.friction-ok'].reasonLabels).toMatchObject({
        CLAIM_MISSING: expect.any(String),
        THRESHOLD_NOT_MET: expect.any(String),
      });
      expect(candidate.gates['kiosk.friction-ok'].reasonLabels.CLAIM_MISSING.length).toBeGreaterThan(0);
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
    // The seam that made a completed language day produce nothing for months.
    // `SentenceLadderService` takes a School realtime GATEWAY; composition
    // handed it a bare `eventBus`, JavaScript dropped the unknown option, and
    // the day-complete fact was never published — so `CloseLanguageDay`, wired
    // correctly at the other end, never heard a thing. The unit suite could
    // not catch it: it passes `realtime:` itself and therefore tests a wiring
    // that production never used.
    id: 'school.language-day-complete-reaches-the-bus',
    verify() {
      const corpus = {
        id: 'contract-korean',
        label: 'Contract Korean',
        languages: { source: 'EN', target: 'KR' },
        audio_base: 'apps/school/language/contract-korean',
        sentences: [
          { seq: 1, text: { EN: 'One.', KR: '하나.' } },
          { seq: 2, text: { EN: 'Two.', KR: '둘.' } },
        ],
      };
      const events = [];
      let progress = null;
      const datastore = {
        listCorpusIds: () => [corpus.id],
        readCorpus: (id) => (id === corpus.id ? corpus : null),
        readProgress: () => progress,
        writeProgress: (_u, _c, next) => { progress = next; return next; },
        appendEvent: (_u, _c, event) => { events.push(event); return event; },
        readAllEvents: () => events,
        resolveAudioPath: (c, seq, lang) => `/media/${c}/${seq}-${lang}.mp3`,
      };
      // The external edge, and the only fake that matters here.
      const eventBus = { publish: vi.fn(), subscribe: vi.fn() };

      const service = createLanguageStudyService({
        datastore,
        readProgramEnrollment: () => ({
          programId: 'sentence-ladder', corpusId: corpus.id, lessonSize: 1, rungs: ['repetition'],
        }),
        eventBus,
        timezone: 'UTC',
        logger: logger(),
      });

      const capabilities = { microphone: true, textInput: ['EN', 'KR'] };
      const args = { userId: 'test-learner', corpusId: corpus.id, capabilities };
      for (let guard = 0; guard < 50; guard += 1) {
        const next = service.getDay(args).queue.find((entry) => !entry.done);
        if (!next) break;
        service.logAttempt({ ...args, seq: next.seq, rung: next.rung, given: 'x' });
      }

      expect(eventBus.publish).toHaveBeenCalledWith('school.language.day-complete', expect.objectContaining({
        learnerId: 'test-learner', corpusId: corpus.id, programId: 'sentence-ladder',
      }));
    },
  },
  {
    id: 'libby.stream-http-policy-stays-in-adapter',
    verify() {
      const runtime = createLibbyRuntime({ dataPath: '/fixture', username: 'reader', fetch: vi.fn() });
      expect(runtime.streamGateway).toBeInstanceOf(LibbyStreamGateway);
      expect(runtime.streamService).toEqual(expect.any(Object));
      const applicationSource = fs.readFileSync(new URL('../3_applications/proxy/LibraryMediaStreamService.mjs', import.meta.url), 'utf8');
      expect(applicationSource).not.toMatch(/\bfetch\b|new URL|listen\.libbyapp|overdrive\.com|redirect:\s*['"]manual/);
      runtime.leases.dispose();
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
