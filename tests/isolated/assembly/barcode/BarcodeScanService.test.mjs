// tests/isolated/assembly/barcode/BarcodeScanService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BarcodeScanService } from '../../../../backend/src/3_applications/barcode/BarcodeScanService.mjs';
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';
import { BarcodeGatekeeper } from '#domains/barcode/BarcodeGatekeeper.mjs';

const KNOWN_ACTIONS = ['queue', 'play', 'open'];

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

function makePayload(barcode, device = 'scanner-1') {
  return BarcodePayload.parse(
    { barcode, timestamp: '2026-03-30T01:00:00Z', device },
    KNOWN_ACTIONS
  );
}

describe('BarcodeScanService', () => {
  let broadcastEvent;
  let gatekeeper;
  let deviceConfig;
  let pipelineConfig;

  beforeEach(() => {
    broadcastEvent = jest.fn();
    gatekeeper = new BarcodeGatekeeper([]); // auto-approve (no strategies)
    deviceConfig = {
      'scanner-1': { type: 'barcode-scanner', target_screen: 'office', policy_group: 'default' },
      'scanner-2': { type: 'barcode-scanner', target_screen: 'living-room', policy_group: 'strict' },
    };
    pipelineConfig = {
      default_action: 'queue',
      actions: KNOWN_ACTIONS,
    };
    logger.info.mockClear();
    logger.warn.mockClear();
  });

  function createService(overrides = {}) {
    return new BarcodeScanService({
      gatekeeper: overrides.gatekeeper || gatekeeper,
      deviceConfig: overrides.deviceConfig || deviceConfig,
      broadcastEvent: overrides.broadcastEvent || broadcastEvent,
      pipelineConfig: overrides.pipelineConfig || pipelineConfig,
      logger,
    });
  }

  describe('handle — approved scans', () => {
    it('broadcasts to the device default screen with default action', async () => {
      const service = createService();
      await service.handle(makePayload('plex:12345'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        action: 'queue',
        contentId: 'plex:12345',
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('uses barcode action when specified', async () => {
      const service = createService();
      await service.handle(makePayload('play:plex:12345'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        action: 'play',
        contentId: 'plex:12345',
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('uses barcode target screen when specified', async () => {
      const service = createService();
      await service.handle(makePayload('living-room:plex:12345'));

      expect(broadcastEvent).toHaveBeenCalledWith('living-room', {
        action: 'queue',
        contentId: 'plex:12345',
        source: 'barcode',
        device: 'scanner-1',
      });
    });

    it('uses both barcode screen and action when specified', async () => {
      const service = createService();
      await service.handle(makePayload('living-room:play:plex:12345'));

      expect(broadcastEvent).toHaveBeenCalledWith('living-room', {
        action: 'play',
        contentId: 'plex:12345',
        source: 'barcode',
        device: 'scanner-1',
      });
    });
  });

  describe('handle — denied scans', () => {
    it('does not broadcast when gatekeeper denies', async () => {
      const denyGatekeeper = new BarcodeGatekeeper([
        async () => ({ approved: false, reason: 'test deny' }),
      ]);
      const service = createService({ gatekeeper: denyGatekeeper });
      await service.handle(makePayload('plex:12345'));

      expect(broadcastEvent).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'barcode.denied',
        expect.objectContaining({ reason: 'test deny' })
      );
    });
  });

  describe('handle — unknown device', () => {
    it('logs warning and does not broadcast for unknown scanner', async () => {
      const service = createService();
      await service.handle(makePayload('plex:12345', 'unknown-scanner'));

      expect(broadcastEvent).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'barcode.unknownDevice',
        expect.objectContaining({ device: 'unknown-scanner' })
      );
    });
  });
});
