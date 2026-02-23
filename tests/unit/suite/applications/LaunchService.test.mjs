import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LaunchService } from '#apps/content/services/LaunchService.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('LaunchService', () => {
  let service;
  let mockRegistry;
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

    mockRegistry = {
      resolve: jest.fn().mockReturnValue({
        adapter: mockAdapter,
        source: 'retroarch',
        localId: 'n64/mario-kart-64'
      })
    };

    mockLauncher = {
      canLaunch: jest.fn().mockResolvedValue(true),
      launch: jest.fn().mockResolvedValue({ ok: true })
    };

    service = new LaunchService({
      contentRegistry: mockRegistry,
      deviceLauncher: mockLauncher,
      logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
    });
  });

  it('resolves content, validates device, and launches', async () => {
    const result = await service.launch({
      contentId: 'retroarch:n64/mario-kart-64',
      targetDeviceId: 'shield-tv'
    });

    expect(mockRegistry.resolve).toHaveBeenCalledWith('retroarch:n64/mario-kart-64');
    expect(mockAdapter.getItem).toHaveBeenCalledWith('n64/mario-kart-64');
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
