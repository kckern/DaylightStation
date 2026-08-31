import { describe, expect, it, vi } from 'vitest';
import { PlexMemoryValidationGateway } from './PlexMemoryValidationGateway.mjs';

function client(overrides = {}) {
  return {
    getLibrarySections: vi.fn().mockResolvedValue({}),
    getMetadata: vi.fn().mockResolvedValue({ MediaContainer: { Metadata: [{ ratingKey: '10' }] } }),
    hubSearch: vi.fn().mockResolvedValue({ results: [] }),
    ...overrides,
  };
}

describe('PlexMemoryValidationGateway', () => {
  it('translates the validator search contract to PlexClient options', async () => {
    const plexClient = client();
    const gateway = new PlexMemoryValidationGateway({ client: plexClient });

    await gateway.hubSearch('Episode title', '8');

    expect(plexClient.hubSearch).toHaveBeenCalledWith('Episode title', { libraryId: '8' });
  });

  it('treats only a 404 as a missing id', async () => {
    const missing = new Error('not found');
    missing.status = 404;
    const gateway = new PlexMemoryValidationGateway({
      client: client({ getMetadata: vi.fn().mockRejectedValue(missing) }),
    });
    await expect(gateway.verifyId('10')).resolves.toBe(false);

    const unavailable = new Error('connection reset');
    const unavailableGateway = new PlexMemoryValidationGateway({
      client: client({ getMetadata: vi.fn().mockRejectedValue(unavailable) }),
    });
    await expect(unavailableGateway.verifyId('10')).rejects.toThrow('connection reset');
  });
});
