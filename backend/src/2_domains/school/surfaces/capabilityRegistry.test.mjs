import { describe, expect, it } from 'vitest';
import {
  KNOWN_CAPABILITY_IDS, RETURN_CAPABILITY_IDS, isRegisteredCapability,
} from './capabilityRegistry.mjs';

describe('capability registry', () => {
  it('contains every published ID from the spec §3.1 inventory, verbatim', () => {
    const published = [
      'reader@1', 'examples@1', 'problems@1', 'flashcards@1', 'quiz@1', 'learning-probe@1',
      'activity.matching@1', 'activity.sorting@1', 'activity.sequencing@1',
      'activity.timed-drill@1', 'activity.memory@1',
      'response.choice@1', 'response.text@1', 'response.matching@1',
      'response.region@1', 'response.asset-choice@1',
      'math@1', 'table-layout@1', 'image@1', 'scan-action@1',
      'calculator@1', 'graph@1', 'table@1', 'solver@1', 'matrix@1',
      'equation-editor@1', 'native-program@1',
      'cable-sync@1', 'qr-output@1', 'shell-core@1',
    ];
    for (const id of published) expect(KNOWN_CAPABILITY_IDS).toContain(id);
  });

  it('adds exactly the four v1 return.* IDs and nothing dispatch-shaped', () => {
    expect(RETURN_CAPABILITY_IDS).toEqual([
      'return.session@1', 'return.scan@1', 'return.cable@1', 'return.qr@1',
    ]);
    for (const id of RETURN_CAPABILITY_IDS) expect(KNOWN_CAPABILITY_IDS).toContain(id);
    expect(KNOWN_CAPABILITY_IDS.some((id) => id.startsWith('action.'))).toBe(false);
  });

  it('recognizes registered IDs, injected custom capabilities, and rejects the rest', () => {
    expect(isRegisteredCapability('reader@1')).toBe(true);
    expect(isRegisteredCapability('made-up@1')).toBe(false);
    expect(isRegisteredCapability('periodic-table@1', { customCapabilities: ['periodic-table@1'] })).toBe(true);
    expect(isRegisteredCapability('not-an-id')).toBe(false);
  });
});
