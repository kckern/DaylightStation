import { describe, it, expect } from 'vitest';
import { ResolverRegistry } from '#domains/trigger/services/ResolverRegistry.mjs';

describe('ResolverRegistry barcode', () => {
  it('routes barcode to BarcodeResolver with the barcode slice', () => {
    const registry = { barcode: { locations: { ds2278: { target: 'living-room', default_action: 'queue', actions: ['queue'] } } } };
    const r = ResolverRegistry.resolve({ modality: 'barcode', location: 'ds2278', value: 'plex:1', registry });
    expect(r.kind).toBe('content');
    expect(r.target).toBe('living-room');
  });
});
