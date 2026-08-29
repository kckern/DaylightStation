import { describe, expect, it, vi } from 'vitest';
import { FitnessContentService } from '#apps/fitness/services/FitnessContentService.mjs';
import { EmergencyAccessService } from '#apps/fitness/services/EmergencyAccessService.mjs';
import { FitnessWebhookService } from '#apps/fitness/services/FitnessWebhookService.mjs';
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
});
