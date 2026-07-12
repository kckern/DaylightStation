import { describe, it, expect, vi } from 'vitest';
import { dispatchResponse } from '#apps/trigger/responseHandlers.mjs';

describe('script handler', () => {
  it('calls endpointGateway.call(ref, params)', async () => {
    const endpointGateway = { call: vi.fn().mockResolvedValue('ok') };
    await dispatchResponse(
      { kind: 'script', ref: 'bedtime', params: { x: 1 } },
      { endpointGateway },
    );
    expect(endpointGateway.call).toHaveBeenCalledWith('bedtime', { x: 1 });
  });
});
