import { describe, it, expect, vi } from 'vitest';
import { parseSources } from '#adapters/trigger/parsers/sourcesParser.mjs';
import { parseNfcTags } from '#adapters/trigger/parsers/nfcTagsParser.mjs';
import { buildTriggerRegistry } from '#adapters/trigger/parsers/buildTriggerRegistry.mjs';

// One bad entry must disable only itself. Before this, any per-entry error threw
// out of the whole load and composition fell back to an EMPTY registry, which
// unregistered every tag in the house (a single `modality: voice` line did it).
describe('trigger registry per-entry isolation (onSkip)', () => {
  const good = { livingroom: { modality: 'nfc', target: 'livingroom-tv' } };

  it('skips an unknown modality and keeps every other source', () => {
    const onSkip = vi.fn();
    const out = parseSources({ ...good, kitchen: { modality: 'voice', target: 'kitchen' } }, { onSkip });
    expect(Object.keys(out.nfc.locations)).toEqual(['livingroom']);
    expect(onSkip).toHaveBeenCalledWith(expect.objectContaining({ kind: 'source', id: 'kitchen', code: 'UNKNOWN_MODALITY' }));
  });

  it('skips a source that fails its modality validation (missing target, non-object)', () => {
    const onSkip = vi.fn();
    const out = parseSources({
      ...good,
      office: { modality: 'nfc' },
      hall: 'nope',
      'hall-state': { modality: 'state', location: 'hall' },
      'den-state': { modality: 'state', location: 'den', target: 'den-tv', states: { off: { action: 'clear' } } },
    }, { onSkip });
    expect(Object.keys(out.nfc.locations)).toEqual(['livingroom']);
    expect(Object.keys(out.state.locations)).toEqual(['den']);
    expect(onSkip.mock.calls.map(([s]) => s.id).sort()).toEqual(['hall', 'hall-state', 'office']);
    expect(onSkip).toHaveBeenCalledWith(expect.objectContaining({ id: 'office', code: 'MISSING_TARGET' }));
  });

  it('skips a bad tag, a duplicate spelling and a tag naming an unknown reader, keeping the rest', () => {
    const onSkip = vi.fn();
    const tags = parseNfcTags({
      '04a1b2c3': { plex: 1 },
      '04:A1:B2:C3': { plex: 2 },
      '04ffeedd': { plex: 3, livingrm: { action: 'x' } },
      '04112233': 'nope',
      '04445566': { plex: 4, livingroom: { action: 'queue' } },
    }, new Set(['livingroom']), { onSkip });
    expect(Object.keys(tags).sort()).toEqual(['04445566', '04a1b2c3']);
    expect(tags['04a1b2c3'].global.plex).toBe(1);
    expect(onSkip.mock.calls.map(([s]) => s.code).sort()).toEqual(['DUPLICATE_TAG_UID', 'INVALID_TAG', 'UNKNOWN_READER_OVERRIDE']);
  });

  it('a skipped reader only drops the overrides that name it, via the tag rule above', () => {
    const onSkip = vi.fn();
    const registry = buildTriggerRegistry({
      sources: { ...good, study: { modality: 'voice' } },
      bindingsNfc: { '04a1b2c3': { plex: 1 }, '04ffeedd': { plex: 2, study: { action: 'x' } } },
    }, { onSkip });
    expect(Object.keys(registry.nfc.locations)).toEqual(['livingroom']);
    expect(Object.keys(registry.nfc.tags)).toEqual(['04a1b2c3']);
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it('without onSkip the parsers stay strict (unchanged behaviour)', () => {
    expect(() => parseSources({ a: { modality: 'voice', target: 't' } })).toThrow(/unknown modality/);
    expect(() => parseSources({ a: { modality: 'nfc' } })).toThrow();
    expect(() => parseNfcTags({ '04a1b2c3': 'x' }, new Set())).toThrow();
  });

  it('a malformed root still fails the whole file, even with onSkip', () => {
    expect(() => parseSources('x', { onSkip: vi.fn() })).toThrow();
    expect(() => parseNfcTags('x', new Set(), { onSkip: vi.fn() })).toThrow();
  });
});
