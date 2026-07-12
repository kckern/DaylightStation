import { describe, it, expect } from 'vitest';
import { parseSources } from '#adapters/trigger/parsers/sourcesParser.mjs';

describe('parseSources barcode', () => {
  it('collects a barcode slice', () => {
    const out = parseSources({ ds2278: { modality: 'barcode', location: 'ds2278', target: 'living-room', default_action: 'queue', actions: ['queue', 'play', 'open'] } });
    expect(out.barcode.locations.ds2278).toEqual({ target: 'living-room', default_action: 'queue', actions: ['queue', 'play', 'open'] });
  });
});
