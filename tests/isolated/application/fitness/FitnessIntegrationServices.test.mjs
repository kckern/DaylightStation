import { describe, expect, it, vi } from 'vitest';
import { FitnessContentService } from '#apps/fitness/services/FitnessContentService.mjs';
import { EmergencyAccessService } from '#apps/fitness/services/EmergencyAccessService.mjs';
import { FitnessWebhookService } from '#apps/fitness/services/FitnessWebhookService.mjs';
import { StravaWebhookAdapter } from '#adapters/strava/StravaWebhookAdapter.mjs';
import { GetFitnessMenuMusic } from '#apps/fitness/usecases/GetFitnessMenuMusic.mjs';
import { PrintFitnessReceipt } from '#apps/fitness/usecases/PrintFitnessReceipt.mjs';
import { SaveDebugVoiceMemo } from '#apps/fitness/usecases/SaveDebugVoiceMemo.mjs';

describe('Fitness integration facades', () => {
  it('hydrates the config and preserves the household projection', async () => {
    const service = new FitnessContentService({
      fitnessConfigService: { getPublicConfig: () => ({ plex: { music_playlists: [] } }) },
      userHydrator: { hydrateConfig: (raw) => ({ ...raw, users: [{ id: 'u1' }] }) },
      contentRegistry: null,
      fitnessContentAdapter: null,
    });
    await expect(service.getConfig('home')).resolves.toEqual({
      plex: { music_playlists: [] },
      users: [{ id: 'u1' }],
      _household: 'home',
    });
  });

  it('preserves provider challenge and event timing contracts', () => {
    const enrichmentService = { handleEvent: vi.fn() };
    const adapter = {
      identify: ({ method }) => method === 'GET' ? 'challenge' : 'event',
      handleChallenge: () => ({ ok: true, response: { 'hub.challenge': 'abc' } }),
      parseEvent: () => ({ objectType: 'activity', objectId: 7, aspectType: 'create' }),
      shouldEnrich: () => true,
    };
    const service = new FitnessWebhookService({
      providerWebhookAdapters: { test: adapter },
      enrichmentService,
    });

    expect(service.challenge({ query: {} })).toEqual({
      kind: 'accepted',
      challenge: { 'hub.challenge': 'abc' },
    });
    expect(service.event({ payload: {} })).toEqual({ kind: 'accepted' });
    expect(enrichmentService.handleEvent).toHaveBeenCalledTimes(1);
  });

  it('resolves and prints without exposing the printer or temporary resource to HTTP', async () => {
    const printer = {};
    const printReceipt = vi.fn().mockResolvedValue({ verified: true });
    const useCase = new PrintFitnessReceipt({
      printerRegistry: { resolve: vi.fn().mockReturnValue(printer) },
      createReceiptCanvas: vi.fn().mockResolvedValue({
        canvas: { toBuffer: () => Buffer.from('png') },
        width: 320,
        height: 100,
      }),
      imagePrintGateway: { print: printReceipt },
    });

    await expect(useCase.execute({ sessionId: 's1', location: 'garage', upsidedown: true }))
      .resolves.toEqual({ kind: 'printed', success: true });
    expect(printReceipt).toHaveBeenCalledWith(printer, expect.objectContaining({
      sessionId: 's1',
      width: 320,
      height: 100,
      align: 'left',
      threshold: 128,
    }));
  });

  it('projects menu music and persists debug audio through semantic capabilities', async () => {
    const menu = new GetFitnessMenuMusic({
      menuMusicCatalog: { listTracks: () => ['media/fitness/ux/menus/a.mp3'] },
      fitnessConfigService: { getMenuMusicVolume: () => 0.2 },
    });
    expect(menu.execute('home')).toEqual({
      tracks: ['media/fitness/ux/menus/a.mp3'],
      volume: 0.2,
    });

    const debugAudioStore = { save: vi.fn().mockResolvedValue({ filename: 'capture.webm', size: 4 }) };
    const save = new SaveDebugVoiceMemo({ debugAudioStore, logger: { debug: vi.fn() } });
    const bytes = Buffer.from('test');
    await expect(save.execute(bytes)).resolves.toEqual({ filename: 'capture.webm', size: 4 });
    expect(debugAudioStore.save).toHaveBeenCalledWith(bytes);
  });

  it('consumes emergency identity state behind semantic authorization outcomes', async () => {
    const identityRelay = {
      consumeArmedCommit: vi.fn(() => null),
      consumePendingDetection: vi.fn(() => ({ userId: 'alice' })),
      disarmCommit: vi.fn(),
    };
    const service = new EmergencyAccessService({ identityRelay, clock: () => 42 });

    expect(service.consumeCommitAuthorization()).toEqual({ userId: 'alice' });
    expect(identityRelay.consumePendingDetection).toHaveBeenCalledWith(42, 120000);
    expect(service.confirmAbort()).toEqual({ userId: 'alice' });
    expect(identityRelay.disarmCommit).toHaveBeenCalledTimes(1);
  });

  describe('Strava rename webhooks', () => {
    const build = () => {
      const enrichmentService = { handleEvent: vi.fn(), handleTitleUpdate: vi.fn() };
      const adapter = new StravaWebhookAdapter({ verifyToken: 't', logger: { info() {}, warn() {} } });
      adapter.identify = () => 'event';
      const service = new FitnessWebhookService({
        providerWebhookAdapters: { strava: adapter },
        enrichmentService,
        logger: { info() {}, warn() {} },
      });
      return { service, enrichmentService };
    };

    it('routes activity/update with a title to handleTitleUpdate', () => {
      const { service, enrichmentService } = build();
      service.event({ payload: { object_type: 'activity', object_id: 20245291061, aspect_type: 'update', updates: { title: 'Spartan Sprint' } } });
      expect(enrichmentService.handleTitleUpdate).toHaveBeenCalledTimes(1);
      expect(enrichmentService.handleTitleUpdate.mock.calls[0][0].updates.title).toBe('Spartan Sprint');
      expect(enrichmentService.handleEvent).not.toHaveBeenCalled();
    });

    it('ignores updates that do not change the title', () => {
      const { service, enrichmentService } = build();
      service.event({ payload: { object_type: 'activity', object_id: 1, aspect_type: 'update', updates: { type: 'Run' } } });
      expect(enrichmentService.handleTitleUpdate).not.toHaveBeenCalled();
    });

    it('counts event types nobody handles for the sync-health report', () => {
      const syncHealth = { recordDropped: vi.fn() };
      const adapter = new StravaWebhookAdapter({ verifyToken: 't', logger: { info() {}, warn() {} } });
      adapter.identify = () => 'event';
      const service = new FitnessWebhookService({
        providerWebhookAdapters: { strava: adapter },
        enrichmentService: { handleEvent: vi.fn(), handleTitleUpdate: vi.fn() },
        syncHealth,
        logger: { info() {}, warn() {} },
      });
      service.event({ payload: { object_type: 'activity', object_id: 1, aspect_type: 'delete' } });
      expect(syncHealth.recordDropped).toHaveBeenCalledWith('activity/delete');
    });
  });
});
