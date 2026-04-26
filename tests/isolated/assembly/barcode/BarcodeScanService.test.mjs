// tests/isolated/assembly/barcode/BarcodeScanService.test.mjs
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BarcodeScanService } from '../../../../backend/src/3_applications/barcode/BarcodeScanService.mjs';
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';
import { BarcodeGatekeeper } from '#domains/barcode/BarcodeGatekeeper.mjs';
import { resolveCommand } from '#domains/barcode/BarcodeCommandMap.mjs';

const KNOWN_ACTIONS = ['queue', 'play', 'open'];
const KNOWN_COMMANDS = ['pause', 'play', 'next', 'prev', 'ffw', 'rew', 'stop', 'off', 'blackout', 'volume', 'speed'];

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makePayload(barcode, device = 'scanner-1') {
  return BarcodePayload.parse(
    { barcode, timestamp: '2026-03-30T01:00:00Z', device },
    KNOWN_ACTIONS, KNOWN_COMMANDS
  );
}

describe('BarcodeScanService', () => {
  let broadcastEvent;
  let gatekeeper;
  let deviceConfig;
  let pipelineConfig;

  beforeEach(() => {
    broadcastEvent = vi.fn();
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
      commandResolver: overrides.commandResolver || resolveCommand,
      waitForAck: overrides.waitForAck || null,
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
        targetScreen: 'office',
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
        targetScreen: 'office',
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
        targetScreen: 'living-room',
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
        targetScreen: 'living-room',
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

  describe('handle — command barcodes', () => {
    it('broadcasts playback command to default screen', async () => {
      const service = createService();
      await service.handle(makePayload('pause'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        playback: 'pause',
        source: 'barcode',
        device: 'scanner-1',
        targetScreen: 'office',
      });
    });

    it('broadcasts command to barcode-specified screen', async () => {
      const service = createService();
      await service.handle(makePayload('office:pause'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        playback: 'pause',
        source: 'barcode',
        device: 'scanner-1',
        targetScreen: 'office',
      });
    });

    it('broadcasts parameterized command', async () => {
      const service = createService();
      await service.handle(makePayload('volume:30'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        volume: 30,
        source: 'barcode',
        device: 'scanner-1',
        targetScreen: 'office',
      });
    });

    it('broadcasts screen:command:arg', async () => {
      const service = createService();
      await service.handle(makePayload('office:speed:1.5'));

      expect(broadcastEvent).toHaveBeenCalledWith('office', {
        rate: 1.5,
        source: 'barcode',
        device: 'scanner-1',
        targetScreen: 'office',
      });
    });

    it('skips gatekeeper for commands', async () => {
      const denyGatekeeper = new BarcodeGatekeeper([
        async () => ({ approved: false, reason: 'deny all' }),
      ]);
      const service = createService({ gatekeeper: denyGatekeeper });
      await service.handle(makePayload('pause'));

      // Command still broadcasts despite deny-all gatekeeper
      expect(broadcastEvent).toHaveBeenCalled();
    });

    it('logs warning for unknown commands', async () => {
      const service = createService({
        commandResolver: () => null,
      });
      await service.handle(makePayload('pause'));

      expect(broadcastEvent).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'barcode.unknownCommand',
        expect.objectContaining({ command: 'pause' })
      );
    });
  });

  describe('handle — ack-based fallback', () => {
    it('does not trigger fallback when screen acks', async () => {
      const waitForAck = vi.fn().mockResolvedValue({ type: 'content-ack', screen: 'office' });
      const loadFallback = vi.fn().mockResolvedValue();
      const service = createService({ waitForAck });
      service.setLoadFallback(loadFallback);

      await service.handle(makePayload('plex:12345'));

      expect(waitForAck).toHaveBeenCalledWith(expect.any(Function), 2000);
      expect(loadFallback).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('barcode.ack.received', { targetScreen: 'office' });
    });

    it('triggers fallback when ack times out', async () => {
      const waitForAck = vi.fn().mockRejectedValue(new Error('waitForMessage timed out'));
      const loadFallback = vi.fn().mockResolvedValue();
      const service = createService({ waitForAck });
      service.setLoadFallback(loadFallback);

      await service.handle(makePayload('plex:12345'));

      expect(waitForAck).toHaveBeenCalled();
      expect(loadFallback).toHaveBeenCalledWith('office', { queue: 'plex:12345' });
      expect(logger.info).toHaveBeenCalledWith('barcode.ack.timeout', { targetScreen: 'office', timeoutMs: 2000 });
    });

    it('triggers fallback immediately when no waitForAck is provided', async () => {
      const loadFallback = vi.fn().mockResolvedValue();
      const service = createService({ waitForAck: null });
      service.setLoadFallback(loadFallback);

      await service.handle(makePayload('plex:12345'));

      expect(loadFallback).toHaveBeenCalledWith('office', { queue: 'plex:12345' });
      expect(logger.info).toHaveBeenCalledWith('barcode.loadFallback.noAck', { targetScreen: 'office' });
    });

    it('ack predicate matches correct screen', async () => {
      let capturedPredicate;
      const waitForAck = vi.fn().mockImplementation((pred) => {
        capturedPredicate = pred;
        return Promise.resolve();
      });
      const service = createService({ waitForAck });
      service.setLoadFallback(vi.fn().mockResolvedValue());

      await service.handle(makePayload('living-room:plex:12345'));

      // Predicate should match ack for living-room
      expect(capturedPredicate({ type: 'content-ack', screen: 'living-room' })).toBe(true);
      // Predicate should NOT match ack for a different screen
      expect(capturedPredicate({ type: 'content-ack', screen: 'office' })).toBe(false);
      // Predicate should NOT match non-ack messages
      expect(capturedPredicate({ type: 'other', screen: 'living-room' })).toBe(false);
    });

    it('passes content options through to fallback query', async () => {
      const waitForAck = vi.fn().mockRejectedValue(new Error('timeout'));
      const loadFallback = vi.fn().mockResolvedValue();
      const service = createService({ waitForAck });
      service.setLoadFallback(loadFallback);

      await service.handle(makePayload('plex:12345+shuffle'));

      expect(loadFallback).toHaveBeenCalledWith('office', { queue: 'plex:12345', shuffle: true });
    });
  });
});
