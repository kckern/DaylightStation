import { describe, it, expect } from 'vitest';
import { isKeepable, keepTargets, keepStatus, keepEntry, parseKeepKind } from './phoneKeeps.js';

const A = 'install-aaaa-1111';
const B = 'install-bbbb-2222';
const phones = [{ id: 'phone', name: 'Phone' }];

describe('phoneKeeps', () => {
  it('keeps audio only', () => {
    expect(isKeepable({ type: 'album' })).toBe(true);
    expect(isKeepable({ mediaType: 'audio' })).toBe(true);
    expect(isKeepable({ type: 'movie' })).toBe(false);
  });

  it('one phone is one target; two live installs are two, named by model', () => {
    expect(keepTargets(phones, { phone: { installs: [{ installId: A, model: 'SM-S921U', current: true, live: true }] } }))
      .toEqual([{ deviceId: 'phone', installId: A, name: 'Phone' }]);
    const two = keepTargets(phones, { phone: { installs: [
      { installId: A, model: 'SM-S921U', current: true, live: true },
      { installId: B, model: 'sdk_gphone64', current: false, live: true },
    ] } });
    expect(two.map((t) => t.name)).toEqual(['Phone · SM-S921U', 'Phone · sdk_gphone64']);
  });

  it('says what the phone says, waiting first', () => {
    const target = { deviceId: 'phone', installId: A, name: 'Phone' };
    const view = {
      waiting: [{ command: 'keep', contentId: 'plex:5', installId: A }],
      kept: { [A]: { items: [
        { contentId: 'plex:9', state: 'downloading', done: 3, total: 12 },
        { contentId: 'plex:8', state: 'ready', bytes: 230_000_000 },
        { contentId: 'plex:7', state: 'failed', reason: 'Gone from the library' },
      ] } },
    };
    expect(keepStatus(view, target, 'plex:5').line).toBe('Waiting for Phone');
    expect(keepStatus(view, target, 'plex:9').line).toBe('Downloading 3 of 12 on Phone');
    expect(keepStatus(view, target, 'plex:8').line).toBe('On Phone · 230 MB');
    expect(keepStatus(view, target, 'plex:7').line).toBe('Failed on Phone: Gone from the library');
    expect(keepStatus(view, target, 'plex:1')).toEqual({ state: 'none', line: null, kept: false });
  });

  it('another install\'s report is not this install\'s', () => {
    const view = { kept: { [B]: { items: [{ contentId: 'plex:8', state: 'ready', bytes: 1 }] } } };
    expect(keepStatus(view, { deviceId: 'phone', installId: A, name: 'Phone' }, 'plex:8').kept).toBe(false);
  });

  it('entries round-trip their target', () => {
    const target = { deviceId: 'phone', installId: A, name: 'Phone' };
    const keep = keepEntry(target, { kept: false });
    expect(keep.label).toBe('Keep on Phone');
    expect(parseKeepKind(keep.kind)).toEqual({ verb: 'keep', deviceId: 'phone', installId: A });
    expect(parseKeepKind(keepEntry({ deviceId: 'phone', installId: null, name: 'Phone' }, { kept: true }).kind))
      .toEqual({ verb: 'unkeep', deviceId: 'phone', installId: null });
    expect(parseKeepKind('playNow')).toBeNull();
  });
});
