import { describe, it, expect } from 'vitest';
import { isKeepable, keepTargets, keepStatus, keepEntries, parseKeepKind, keepIdsFor, phonePage, expandPhoneInstalls, splitInstallTarget } from './phoneKeeps.js';

// ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §2, §3.2, §3.8.
const A = 'install-aaaa-1111';
const B = 'install-bbbb-2222';
const phones = [{ id: 'phone', name: 'Phone' }];
const T = { deviceId: 'phone', installId: A, name: 'Phone' };
const view = (over = {}) => ({ installs: [{ installId: A, model: 'SM-S921U', current: true, live: true }], waiting: [], received: [], refused: [], kept: { [A]: { items: [] } }, ...over });
const report = (items, extra = {}) => ({ [A]: { items, ...extra } });

describe('phoneKeeps', () => {
  it('keeps audio only', () => {
    expect(isKeepable({ type: 'album' })).toBe(true);
    expect(isKeepable({ mediaType: 'audio' })).toBe(true);
    expect(isKeepable({ type: 'movie' })).toBe(false);
  });

  it('one phone is one target; two live installs are two, by model; gone installs are never targets', () => {
    expect(keepTargets(phones, { phone: view() })).toEqual([{ deviceId: 'phone', installId: A, name: 'Phone', phoneName: 'Phone' }]);
    const two = keepTargets(phones, { phone: view({ installs: [
      { installId: A, model: 'SM-S921U', current: true, live: true },
      { installId: B, model: 'sdk_gphone64', live: true },
    ] }) });
    expect(two.map((t) => t.name)).toEqual(['Phone · SM-S921U', 'Phone · sdk_gphone64']);
    const gone = keepTargets(phones, { phone: view({ installs: [{ installId: B, model: 'old', current: true, live: false, gone: true }] }) });
    expect(gone).toEqual([{ deviceId: 'phone', installId: null, name: 'Phone', phoneName: 'Phone' }]);
  });

  it('Asked: waiting for the phone, with the time asked, and Cancel before it is received', () => {
    const v = view({ waiting: [{ command: 'keep', commandId: 'k1', contentId: 'plex:5', installId: A, queuedAt: '2026-11-26T20:04:00.000Z', handedOver: false }] });
    const s = keepStatus(v, T, { id: 'plex:5' });
    expect(s.state).toBe('asked');
    expect(s.line).toMatch(/^Waiting for Phone · asked /);
    expect(s.line).toMatch(/ · usually within 15 min$/);
    expect(s.cancel).toBe('k1');
    expect(keepEntries(T, s)).toEqual([{ kind: 'cancelKeepOn:phone#k1', label: 'Cancel keep on Phone' }]);
    const sent = keepStatus(view({ waiting: [{ ...v.waiting[0], handedOver: true }] }), T, { id: 'plex:5' });
    expect(sent.cancel).toBeUndefined();
    expect(sent.line).not.toMatch(/15 min/);
    expect(keepEntries(T, sent)[0].label).toBe('Remove from Phone');
  });

  it('Received between the ack and the first report; a refusal stays visible', () => {
    expect(keepStatus(view({ received: [{ contentId: 'plex:5', installId: A, command: 'keep' }] }), T, { id: 'plex:5' }).line).toBe('Received by Phone');
    const refused = keepStatus(view({ refused: [{ contentId: 'plex:5', installId: A, reason: 'Needs 1.2 GB more room' }] }), T, { id: 'plex:5' });
    expect(refused).toMatchObject({ state: 'refused', line: 'Phone refused: Needs 1.2 GB more room', kept: false });
  });

  it('says every lifecycle state in its words', () => {
    const line = (it) => keepStatus(view({ kept: report([{ contentId: 'plex:9', ...it }]) }), T, { id: 'plex:9' }).line;
    expect(line({ state: 'checking' })).toBe('Checking size on Phone…');
    expect(line({ state: 'needs-room', neededBytes: 1.2e9 })).toBe('Needs 1.2 GB more room on Phone');
    expect(line({ state: 'queued' })).toBe('Queued on Phone');
    expect(line({ state: 'waiting-wifi' })).toBe('Waiting for Wi-Fi on Phone');
    expect(line({ state: 'waiting-home' })).toBe('Phone is waiting for home');
    expect(line({ state: 'waiting-storage' })).toBe('Phone storage is full');
    expect(line({ state: 'downloading', done: 3, total: 12, bytes: 84e6, totalBytes: 230e6 })).toBe('Downloading 3 of 12 · 84 MB of 230 MB on Phone');
    expect(line({ state: 'paused' })).toBe('Paused on Phone');
    expect(line({ state: 'partly-ready', done: 11, total: 12, failed: 1, reason: 'Gone from the library' })).toBe("11 of 12 ready on Phone · 1 couldn't download: Gone from the library");
    expect(line({ state: 'ready', bytes: 230e6 })).toBe('On Phone · 230 MB');
    expect(line({ state: 'updating' })).toBe('Updating on Phone');
    expect(line({ state: 'removing' })).toBe('Removing from Phone…');
    expect(line({ state: 'not-available' })).toBe("On Phone's SD card — not inserted");
    expect(line({ state: 'damaged', failed: 1 })).toBe('1 track on Phone needs downloading again');
  });

  it('a track finds its keep under its album, or in a report that lists it', () => {
    expect(keepIdsFor({ id: 'plex:100', parentId: '99' })).toEqual(new Set(['plex:100', 'plex:99']));
    const v = view({ kept: report([{ contentId: 'plex:99', state: 'ready', bytes: 1e6 }]) });
    expect(keepStatus(v, T, { id: 'plex:100', parentId: '99' }).state).toBe('ready');
    const listed = view({ kept: report([{ contentId: 'plex:77', state: 'ready', trackIds: ['plex:100'] }]) });
    expect(keepStatus(listed, T, { id: 'plex:100' }).state).toBe('ready');
  });

  it('another install’s report is not this install’s', () => {
    const v = view({ kept: { [B]: { items: [{ contentId: 'plex:8', state: 'ready', bytes: 1 }] } } });
    expect(keepStatus(v, T, { id: 'plex:8' }).kept).toBe(false);
  });

  it('entries round-trip their target', () => {
    expect(parseKeepKind(keepEntries(T, { kept: false })[0].kind)).toEqual({ verb: 'keep', deviceId: 'phone', installId: A });
    expect(parseKeepKind(keepEntries({ ...T, installId: null }, { kept: true })[0].kind)).toEqual({ verb: 'unkeep', deviceId: 'phone', installId: null });
    expect(parseKeepKind('cancelKeepOn:phone#k1')).toEqual({ verb: 'cancel', deviceId: 'phone', commandId: 'k1' });
    expect(parseKeepKind('playNow')).toBeNull();
  });

  it('the phone page: items largest first, room, waiting with time, gone installs', () => {
    const page = phonePage({ id: 'phone', name: 'Phone' }, view({
      installs: [
        { installId: A, model: 'SM-S921U', current: true, live: true },
        { installId: B, model: 'old phone', live: false, gone: true, lastPollAt: '2026-10-01T00:00:00.000Z' },
      ],
      kept: report([
        { contentId: 'plex:1', title: 'Small', state: 'ready', bytes: 10e6 },
        { contentId: 'plex:2', title: 'Big', state: 'ready', bytes: 900e6 },
      ], { freeBytes: 15e9, limitBytes: 4e9 }),
      waiting: [{ command: 'keep', commandId: 'k1', contentId: 'plex:3', queuedAt: '2026-11-26T20:04:00.000Z' }],
    }));
    expect(page.installs[0].items.map((i) => i.title)).toEqual(['Big', 'Small']);
    expect(page.installs[0].space).toBe('910 MB kept · 4.0 GB limit · 15.0 GB free on phone');
    expect(page.installs[1].gone).toBe(true);
    expect(page.waiting[0].asked).toBeTruthy();
  });

  it('Play on: a phone with two live installs is one row per install; one live install stays one row', () => {
    const devices = [{ id: 'phone', name: 'Phone' }, { id: 'office-tv', name: 'Office TV' }];
    const isPhone = (d) => d.id === 'phone';
    const two = expandPhoneInstalls(devices, { phone: view({ installs: [
      { installId: A, model: 'SM-S921U', current: true, live: true }, { installId: B, model: 'sdk_gphone64', live: true },
    ] }) }, isPhone);
    expect(two.map((d) => [d.id, d.name, d.fleetId ?? null])).toEqual([
      [`phone#${A}`, 'Phone · SM-S921U', 'phone'], [`phone#${B}`, 'Phone · sdk_gphone64', 'phone'], ['office-tv', 'Office TV', null],
    ]);
    expect(expandPhoneInstalls(devices, { phone: view() }, isPhone).map((d) => d.id)).toEqual(['phone', 'office-tv']);
    expect(splitInstallTarget(`phone#${B}`)).toEqual({ deviceId: 'phone', installId: B });
    expect(splitInstallTarget('office-tv')).toEqual({ deviceId: 'office-tv', installId: null });
    expect(splitInstallTarget('phone#x')).toEqual({ deviceId: 'phone', installId: null });
  });
  it('an item the phone kept automatically while listening says "Kept automatically", on the item and the phone page', () => {
    const v = view({ kept: report([
      { contentId: 'plex:7', title: 'A book', state: 'ready', bytes: 230e6, done: 14, total: 14, auto: true },
      { contentId: 'plex:8', title: 'An album', state: 'ready', bytes: 90e6, done: 9, total: 9 },
    ]) });
    const auto = keepStatus(v, T, { id: 'plex:7' });
    expect(auto).toMatchObject({ state: 'ready', kept: true, auto: true, line: 'On Phone · 230 MB · Kept automatically' });
    expect(keepEntries(T, auto)).toEqual([{ kind: `unkeepOn:phone@${A}`, label: 'Remove from Phone' }]);
    expect(keepStatus(v, T, { id: 'plex:8' }).line).toBe('On Phone · 90 MB');
    const downloading = keepStatus(view({ kept: report([{ contentId: 'plex:7', state: 'downloading', done: 1, total: 14, auto: true }]) }), T, { id: 'plex:7' });
    expect(downloading.line).toBe('Downloading 1 of 14 on Phone · Kept automatically');
    const page = phonePage({ id: 'phone', name: 'Phone' }, v);
    const rows = page.installs[0].items;
    expect(rows.find((r) => r.contentId === 'plex:7')).toMatchObject({ auto: true });
    expect(rows.find((r) => r.contentId === 'plex:7').status.line).toMatch(/Kept automatically$/);
    expect(rows.find((r) => r.contentId === 'plex:8').status.auto).toBeUndefined();
  });
});
