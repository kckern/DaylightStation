import { describe, it, expect, vi } from 'vitest';
import { StravaActivityAccessGateway } from './StravaActivityAccessGateway.mjs';

const makeDeps = ({ stored = { refresh: 'old-refresh', athlete_id: 42 }, canRefreshTokens } = {}) => {
  const client = {
    hasAccessToken: vi.fn().mockReturnValue(false),
    refreshToken: vi.fn().mockResolvedValue({
      access_token: 'new-access', refresh_token: 'new-refresh', expires_at: 1900000000,
    }),
  };
  const authStore = { load: vi.fn().mockResolvedValue(stored), save: vi.fn().mockResolvedValue(undefined) };
  const configService = { getUserAuth: vi.fn().mockReturnValue({ refresh: 'boot-cached-refresh' }) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gateway = new StravaActivityAccessGateway({ client, configService, authStore, logger, canRefreshTokens });
  return { client, authStore, configService, logger, gateway };
};

describe('StravaActivityAccessGateway', () => {
  it('refreshes from the stored token and saves the rotated one without dropping other keys', async () => {
    const { client, authStore, gateway } = makeDeps();
    await gateway.ensure('alice');

    expect(client.refreshToken).toHaveBeenCalledWith('old-refresh');
    expect(authStore.save).toHaveBeenCalledWith('alice', 'strava', {
      athlete_id: 42,
      refresh: 'new-refresh',
      access_token: 'new-access',
      expires_at: 1900000000,
    });
  });

  it('keeps the old refresh token when the provider does not rotate it', async () => {
    const { client, authStore, gateway } = makeDeps();
    client.refreshToken.mockResolvedValue({ access_token: 'a', expires_at: 1 });
    await gateway.ensure('alice');
    expect(authStore.save.mock.calls[0][2].refresh).toBe('old-refresh');
  });

  it('does nothing when the client already has an access token', async () => {
    const { client, authStore, gateway } = makeDeps();
    client.hasAccessToken.mockReturnValue(true);
    await gateway.ensure('alice');
    expect(client.refreshToken).not.toHaveBeenCalled();
    expect(authStore.save).not.toHaveBeenCalled();
  });

  it('refuses to refresh when this process may not rotate tokens', async () => {
    const { client, authStore, logger, gateway } = makeDeps({ canRefreshTokens: () => false });
    await expect(gateway.ensure('alice')).rejects.toThrow(/Activity access unavailable/);
    expect(client.refreshToken).not.toHaveBeenCalled();
    expect(authStore.save).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('strava.client.token_writer_disabled', { username: 'alice' });
  });
});
