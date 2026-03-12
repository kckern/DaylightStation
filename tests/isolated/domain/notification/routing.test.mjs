import { describe, it, expect, beforeEach } from '@jest/globals';
import { NotificationService } from '#apps/notification/NotificationService.mjs';
import { NotificationIntent } from '#domains/notification/entities/NotificationIntent.mjs';
import { NotificationPreference } from '#domains/notification/entities/NotificationPreference.mjs';

describe('NotificationService routing', () => {
  let service;
  let appAdapter;
  let telegramAdapter;
  let emailAdapter;

  const prefConfig = {
    ceremony: {
      normal: ['telegram'],
      high: ['telegram', 'app'],
    },
    drift_alert: {
      normal: ['app'],
      critical: ['telegram', 'app'],
    },
    system: {
      normal: ['app'],
    },
  };

  beforeEach(() => {
    appAdapter = {
      channel: 'app',
      send: jest.fn().mockResolvedValue({ delivered: true, channelId: 'app-1' }),
    };
    telegramAdapter = {
      channel: 'telegram',
      send: jest.fn().mockResolvedValue({ delivered: true, channelId: 'tg-1' }),
    };
    emailAdapter = {
      channel: 'email',
      send: jest.fn().mockResolvedValue({ delivered: false, error: 'not configured' }),
    };

    service = new NotificationService({
      adapters: [appAdapter, telegramAdapter, emailAdapter],
      preferenceLoader: () => new NotificationPreference(prefConfig),
    });
  });

  it('sends to telegram when preference says telegram', async () => {
    const intent = new NotificationIntent({
      title: 'Ceremony',
      body: 'Time for capture',
      category: 'ceremony',
      urgency: 'normal',
    });

    const results = await service.send(intent);
    expect(telegramAdapter.send).toHaveBeenCalledWith(intent);
    expect(appAdapter.send).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].delivered).toBe(true);
  });

  it('sends to multiple channels when preference says [telegram, app]', async () => {
    const intent = new NotificationIntent({
      title: 'Ceremony',
      body: 'Urgent',
      category: 'ceremony',
      urgency: 'high',
    });

    const results = await service.send(intent);
    expect(telegramAdapter.send).toHaveBeenCalledWith(intent);
    expect(appAdapter.send).toHaveBeenCalledWith(intent);
    expect(results).toHaveLength(2);
  });

  it('skeleton adapters return not-configured error', async () => {
    // Force preference to email
    service = new NotificationService({
      adapters: [appAdapter, telegramAdapter, emailAdapter],
      preferenceLoader: () => new NotificationPreference({
        system: { normal: ['email'] },
      }),
    });

    const intent = new NotificationIntent({
      title: 'Test',
      body: 'Test',
      category: 'system',
      urgency: 'normal',
    });

    const results = await service.send(intent);
    expect(emailAdapter.send).toHaveBeenCalled();
    expect(results[0].delivered).toBe(false);
    expect(results[0].error).toBe('not configured');
  });

  it('skips adapters that are not registered for the resolved channels', async () => {
    const intent = new NotificationIntent({
      title: 'Drift',
      body: 'You are drifting',
      category: 'drift_alert',
      urgency: 'normal',
    });

    const results = await service.send(intent);
    expect(appAdapter.send).toHaveBeenCalled();
    expect(telegramAdapter.send).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it('falls back to app when no adapter matches', async () => {
    // Push preference with no push adapter registered
    service = new NotificationService({
      adapters: [appAdapter],
      preferenceLoader: () => new NotificationPreference({
        system: { normal: ['push'] },
      }),
    });

    const intent = new NotificationIntent({
      title: 'Test',
      body: 'Test',
      category: 'system',
      urgency: 'normal',
    });

    const results = await service.send(intent);
    // Should fall back to app adapter
    expect(appAdapter.send).toHaveBeenCalled();
  });
});
