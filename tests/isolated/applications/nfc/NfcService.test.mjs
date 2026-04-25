import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NfcService } from '../../../../backend/src/3_applications/nfc/NfcService.mjs';

const makeResolver = () => ({ resolve: (id) => /^plex:/.test(id) ? { source: 'plex' } : null });

describe('NfcService.handleScan', () => {
  let wakeAndLoadService;
  let haGateway;
  let deviceService;
  let broadcast;
  let logger;

  beforeEach(() => {
    wakeAndLoadService = { execute: jest.fn().mockResolvedValue({ ok: true, dispatchId: 'd1' }) };
    haGateway = { callService: jest.fn().mockResolvedValue({ ok: true }) };
    deviceService = { get: jest.fn().mockReturnValue({ loadContent: jest.fn().mockResolvedValue({ ok: true }) }) };
    broadcast = jest.fn();
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  });

  function makeService(configOverrides = {}) {
    const config = {
      readers: { 'livingroom-nfc': { target: 'livingroom-tv', action: 'queue' } },
      tags: { '83_8e_68_06': { plex: 620707 } },
      ...configOverrides,
    };
    return new NfcService({
      config,
      contentIdResolver: makeResolver(),
      wakeAndLoadService,
      haGateway,
      deviceService,
      broadcast,
      logger,
    });
  }

  it('returns ok and dispatches a content load for a known scan', async () => {
    const service = makeService();
    const result = await service.handleScan('livingroom-nfc', '83_8e_68_06');
    expect(result.ok).toBe(true);
    expect(result.action).toBe('queue');
    expect(result.target).toBe('livingroom-tv');
    expect(wakeAndLoadService.execute).toHaveBeenCalledWith(
      'livingroom-tv',
      expect.objectContaining({ queue: 'plex:620707' }),
      expect.objectContaining({ dispatchId: expect.any(String) })
    );
  });

  it('returns 404-ish error for unknown reader', async () => {
    const service = makeService();
    const result = await service.handleScan('attic-nfc', '83_8e_68_06');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reader/i);
    expect(result.code).toBe('READER_NOT_FOUND');
  });

  it('returns 404-ish error for unknown tag (and logs the scan)', async () => {
    const service = makeService();
    const result = await service.handleScan('livingroom-nfc', 'unknown_uid');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TAG_NOT_REGISTERED');
    expect(logger.info).toHaveBeenCalledWith('nfc.scan',
      expect.objectContaining({ registered: false, tagUid: 'unknown_uid' }));
  });

  it('lowercases the tag UID before lookup', async () => {
    const service = makeService();
    const result = await service.handleScan('livingroom-nfc', '83_8E_68_06');
    expect(result.ok).toBe(true);
  });

  it('returns 400-ish error for unknown action', async () => {
    const service = makeService({
      tags: { '83_8e_68_06': { action: 'launch-rocket' } },
    });
    const result = await service.handleScan('livingroom-nfc', '83_8e_68_06');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNKNOWN_ACTION');
  });

  it('rejects when reader has auth_token and the request omits it', async () => {
    const service = makeService({
      readers: { 'livingroom-nfc': { target: 'livingroom-tv', action: 'queue', auth_token: 'secret' } },
    });
    const result = await service.handleScan('livingroom-nfc', '83_8e_68_06', {});
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AUTH_FAILED');
  });

  it('accepts when reader auth_token matches', async () => {
    const service = makeService({
      readers: { 'livingroom-nfc': { target: 'livingroom-tv', action: 'queue', auth_token: 'secret' } },
    });
    const result = await service.handleScan('livingroom-nfc', '83_8e_68_06', { token: 'secret' });
    expect(result.ok).toBe(true);
  });

  it('does not dispatch when dryRun is true (validates only)', async () => {
    const service = makeService();
    const result = await service.handleScan('livingroom-nfc', '83_8e_68_06', { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(wakeAndLoadService.execute).not.toHaveBeenCalled();
  });

  it('broadcasts an nfc.scan event to topic nfc:<readerId>', async () => {
    const service = makeService();
    await service.handleScan('livingroom-nfc', '83_8e_68_06');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'nfc:livingroom-nfc',
      type: 'nfc.scan',
      readerId: 'livingroom-nfc',
      tagUid: '83_8e_68_06',
    }));
  });

  it('returns DISPATCH_FAILED when the action handler throws a non-UnknownAction error', async () => {
    wakeAndLoadService.execute.mockRejectedValue(new Error('TV unreachable'));
    const service = makeService();
    const result = await service.handleScan('livingroom-nfc', '83_8e_68_06');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('DISPATCH_FAILED');
    expect(result.error).toMatch(/TV unreachable/);
  });
});
