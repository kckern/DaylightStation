import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LaunchService } from "../../../../__capabilities/device-dispatch/server/application/LaunchService.mjs";
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('LaunchService', () => {
  let service;
  let mockCatalog;
  let mockLauncher;
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = {
      getItem: jest.fn().mockResolvedValue({
        id: 'retroarch:n64/mario-kart-64',
        title: 'Mario Kart 64',
        launchIntent: {
          target: 'com.retroarch/Activity',
          params: { ROM: '/path/rom.n64' }
        }
      })
    };

    mockCatalog = {
      resolve: jest.fn().mockReturnValue({
        source: 'retroarch',
        localId: 'n64/mario-kart-64'
      }),
      getItem: (...args) => mockAdapter.getItem(...args),
    };

    mockLauncher = {
      canLaunch: jest.fn().mockResolvedValue(true),
      launch: jest.fn().mockResolvedValue({ ok: true })
    };

    service = new LaunchService({
      contentCatalog: mockCatalog,
      deviceLauncher: mockLauncher,
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  it('resolves content, validates device, and launches', async () => {
    const result = await service.launch({
      contentId: 'retroarch:n64/mario-kart-64',
      targetDeviceId: 'shield-tv'
    });

    expect(mockCatalog.resolve).toHaveBeenCalledWith('retroarch:n64/mario-kart-64');
    expect(mockAdapter.getItem).toHaveBeenCalledWith({ source: 'retroarch', localId: 'n64/mario-kart-64' });
    expect(mockLauncher.canLaunch).toHaveBeenCalledWith('shield-tv');
    expect(mockLauncher.launch).toHaveBeenCalledWith('shield-tv', {
      target: 'com.retroarch/Activity',
      params: { ROM: '/path/rom.n64' }
    });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      contentId: 'retroarch:n64/mario-kart-64',
      targetDeviceId: 'shield-tv',
      title: 'Mario Kart 64'
    }));
  });

  it('resolves a direct-launch intent without invoking the device launcher', async () => {
    await expect(service.resolveIntent('retroarch:n64/mario-kart-64')).resolves.toEqual({
      target: 'com.retroarch/Activity',
      params: { ROM: '/path/rom.n64' }
    });

    expect(mockCatalog.resolve).toHaveBeenCalledWith('retroarch:n64/mario-kart-64');
    expect(mockLauncher.launch).not.toHaveBeenCalled();
  });

  describe('prepareLaunch hook', () => {
    function withPrepare(prepareLaunch) {
      return new LaunchService({
        contentCatalog: mockCatalog,
        deviceLauncher: mockLauncher,
        prepareLaunch,
        logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
      });
    }

    it('runs before the device launch with the resolved item', async () => {
      const order = [];
      const prepareLaunch = jest.fn(async () => { order.push('prepare'); });
      mockLauncher.launch.mockImplementation(async () => { order.push('launch'); return { ok: true }; });
      await withPrepare(prepareLaunch).launch({ contentId: 'retroarch:n64/mario-kart-64', targetDeviceId: 'shield-tv' });
      expect(prepareLaunch).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mario Kart 64' }));
      expect(order).toEqual(['prepare', 'launch']);
    });

    it('runs before an FKB intent is handed back', async () => {
      const prepareLaunch = jest.fn().mockResolvedValue(undefined);
      await withPrepare(prepareLaunch).resolveIntent('retroarch:n64/mario-kart-64');
      expect(prepareLaunch).toHaveBeenCalledTimes(1);
    });

    it('a throwing hook never blocks the launch', async () => {
      const prepareLaunch = jest.fn().mockRejectedValue(new Error('adb down'));
      const result = await withPrepare(prepareLaunch).launch({ contentId: 'retroarch:n64/mario-kart-64', targetDeviceId: 'shield-tv' });
      expect(result.success).toBe(true);
      expect(mockLauncher.launch).toHaveBeenCalled();
      await expect(withPrepare(prepareLaunch).resolveIntent('retroarch:n64/mario-kart-64'))
        .resolves.toEqual(expect.objectContaining({ target: 'com.retroarch/Activity' }));
    });
  });

  it('fails at composition time when the content catalog contract is missing', () => {
    expect(() => new LaunchService({
      contentRegistry: mockCatalog,
      deviceLauncher: mockLauncher,
    })).toThrow('LaunchService requires contentCatalog with resolve() and getItem()');
  });

  it('throws ValidationError when content has no launchIntent', async () => {
    mockAdapter.getItem.mockResolvedValue({ id: 'plex:123', title: 'Movie', launchIntent: null });

    await expect(service.launch({ contentId: 'plex:123', targetDeviceId: 'shield-tv' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when device cannot launch', async () => {
    mockLauncher.canLaunch.mockResolvedValue(false);

    await expect(service.launch({ contentId: 'retroarch:n64/mario-kart-64', targetDeviceId: 'phone' }))
      .rejects.toThrow(ValidationError);
  });

  it('throws when content not found', async () => {
    mockAdapter.getItem.mockResolvedValue(null);

    await expect(service.launch({ contentId: 'retroarch:n64/missing', targetDeviceId: 'shield-tv' }))
      .rejects.toThrow();
  });
});
