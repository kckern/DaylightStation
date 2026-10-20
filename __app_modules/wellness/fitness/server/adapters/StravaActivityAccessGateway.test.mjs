import { describe, it, expect, vi } from 'vitest';
import { StravaActivityAccessGateway } from './StravaActivityAccessGateway.mjs';

const makeDeps = ({ stored = { refresh: 'old-refresh', athlete_id: 42 }, canRefreshTokens = () => true, withStore = true } = {}) => {
  const client = {
    hasAccessToken: vi.fn().mockReturnValue(false),
    refreshToken: vi.fn().mockResolvedValue({
      access_token: 'new-access', refresh_token: 'new-refresh', expires_at: 1900000000,
    }),
  };
  const authStore = { load: vi.fn().mockResolvedValue(stored), save: vi.fn().mockResolvedValue(undefined) };
  const configService = { getUserAuth: vi.fn().mockReturnValue({ refresh: 'boot-cached-refresh' }) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gateway = new StravaActivityAccessGateway({
    client, configService, authStore: withStore ? authStore : null, logger, canRefreshTokens,
  });
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

  it('refuses to refresh unless a token policy is given (fails closed)', async () => {
    const { client, authStore, configService } = makeDeps();
    const gateway = new StravaActivityAccessGateway({ client, configService, authStore, logger: { info() {}, warn() {}, error() {} } });
    await expect(gateway.ensure('alice')).rejects.toThrow(/Activity access unavailable/);
    expect(client.refreshToken).not.toHaveBeenCalled();
  });

  it('refuses to refresh without a writable token store', async () => {
    const { client, logger, gateway } = makeDeps({ withStore: false });
    await expect(gateway.ensure('alice')).rejects.toThrow(/Activity access unavailable/);
    expect(client.refreshToken).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls.concat(logger.error.mock.calls, logger.info.mock.calls)
      .some(([event]) => event === 'strava.client.no_token_store')).toBe(true);
  });

  it('falls back to configService auth when the store has nothing', async () => {
    const { client, authStore, gateway } = makeDeps({ stored: null });
    await gateway.ensure('alice');
    expect(client.refreshToken).toHaveBeenCalledWith('boot-cached-refresh');
    expect(authStore.save).toHaveBeenCalledWith('alice', 'strava', expect.objectContaining({ refresh: 'new-refresh' }));
  });

  it('logs token_persist_failed (without token values) and rethrows when saving fails', async () => {
    const { authStore, logger, gateway } = makeDeps();
    authStore.save.mockRejectedValue(new Error('disk full'));
    await expect(gateway.ensure('alice')).rejects.toThrow('disk full');
    const call = logger.error.mock.calls.find(([event]) => event === 'strava.auth.token_persist_failed');
    expect(call).toBeTruthy();
    expect(call[1]).toMatchObject({ username: 'alice', error: 'disk full' });
    expect(JSON.stringify(call[1])).not.toContain('new-refresh');
    expect(JSON.stringify(call[1])).not.toContain('new-access');
  });
});
