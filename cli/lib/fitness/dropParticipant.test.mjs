/**
 * dropParticipant — remove a contaminating participant from a stored session.
 *
 * Built for the 2026-07-25 case: an outdoor run's heart-rate strap drifted
 * through ANT+ range of the garage receiver, enrolling its wearer as a full
 * participant of the kids' session and dragging a Strava link in with them.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { dropParticipant } from './dropParticipant.mjs';

let baseDir;
let sessionsRoot;
let sessionFile;

/** The garage session, contaminated exactly the way the real one was. */
const contaminatedSession = () => ({
  version: 3,
  sessionId: '20260725132556',
  timezone: 'America/Los_Angeles',
  session: {
    id: '20260725132556',
    date: '2026-07-25',
    start: '2026-07-25 13:25:56.135',
    end: '2026-07-25 16:41:15.601',
    duration_seconds: 11719,
  },
  participants: {
    'kid-one': { display_name: 'Kid One', hr_device: '10001', is_primary: true },
    'kid-two': { display_name: 'Kid Two', hr_device: '10002', is_primary: true },
    'drive-by': {
      display_name: 'Drive By',
      hr_device: '10000',
      is_primary: true,
      strava: { activityId: 19465331355, type: 'Run', deviceName: 'Garmin Forerunner 245 Music' },
    },
  },
  treasureBox: { totalCoins: 4179, buckets: { green: 772, yellow: 2688, orange: 639, red: 80 } },
  summary: {
    participants: {
      'kid-one': { coins: 1642, hr_avg: 119, zone_minutes: { active: 83.83 } },
      'kid-two': { coins: 1695, hr_avg: 123, zone_minutes: { active: 33 } },
      'drive-by': { coins: 59, hr_avg: 117, zone_minutes: { warm: 0.67 } },
    },
    media: [
      { contentId: 'plex:665664', title: 'A T-Rex and Tangled Ideas' },
      { contentId: 'plex:665672', title: 'Webcaster Disaster', primary: true },
    ],
    coins: { total: 4179, buckets: { green: 772, yellow: 2688, orange: 639, red: 80 } },
  },
  strava: { last_reconciled_at: '2026-07-26T00:23:23.831Z' },
  strava_notes: { text: '🖥️ Super Wings — Webcaster Disaster', source: 'strava_description' },
  timeline: {
    interval_seconds: 5,
    tick_count: 2346,
    encoding: 'rle',
    series: {
      'device:10001:heart-rate': JSON.stringify([[120, 2346]]),
      'kid-one:hr': JSON.stringify([[120, 2346]]),
      'kid-one:coins': JSON.stringify([[1642, 2346]]),
      'device:10000:heart-rate': JSON.stringify([[null, 1770], [150, 30], [null, 546]]),
      'drive-by:hr': JSON.stringify([[null, 1770], [150, 30], [null, 546]]),
      'drive-by:zone': JSON.stringify([[null, 1770], ['w', 30], [null, 546]]),
      'drive-by:coins': JSON.stringify([[null, 1770], [59, 576]]),
      'global:coins': JSON.stringify([[4179, 2346]]),
    },
    events: [
      { timestamp: 1785011154286, type: 'media', data: { contentId: 'plex:665664' } },
      {
        timestamp: 1785021838296,
        type: 'challenge',
        data: { challengeId: 'c0', result: 'success', metUsers: ['drive-by'], missingUsers: ['kid-one'] },
      },
    ],
  },
});

async function setUp(session = contaminatedSession()) {
  baseDir = await mkdtemp(path.join(tmpdir(), 'drop-participant-'));
  sessionsRoot = path.join(baseDir, 'fitness', 'log');
  const dateDir = path.join(sessionsRoot, '2026-07-25');
  await mkdir(dateDir, { recursive: true });
  sessionFile = path.join(dateDir, '20260725132556.yml');
  await writeFile(sessionFile, yaml.dump(session), 'utf8');
}

const readSession = async () => yaml.load(await readFile(sessionFile, 'utf8'));

beforeEach(() => setUp());
afterEach(() => { baseDir = null; });

describe('dropParticipant — dry run', () => {
  it('reports what it would remove without touching the file', async () => {
    const before = await readFile(sessionFile, 'utf8');

    const report = await dropParticipant({ file: sessionFile, participant: 'drive-by' });

    expect(report.wrote).toBe(false);
    expect(report.backupPath).toBe(null);
    expect(await readFile(sessionFile, 'utf8')).toBe(before);
  });

  it('lists the participant series and the device series it would remove', async () => {
    const report = await dropParticipant({ file: sessionFile, participant: 'drive-by' });

    expect(report.removed.seriesKeys.sort()).toEqual(
      ['drive-by:coins', 'drive-by:hr', 'drive-by:zone']
    );
    expect(report.removed.deviceSeriesKeys).toEqual(['device:10000:heart-rate']);
  });
});

describe('dropParticipant — write', () => {
  it('removes the participant from participants and summary', async () => {
    await dropParticipant({ file: sessionFile, participant: 'drive-by', write: true });

    const session = await readSession();
    expect(Object.keys(session.participants).sort()).toEqual(['kid-one', 'kid-two']);
    expect(session.summary.participants['drive-by']).toBeUndefined();
    expect(session.summary.participants['kid-one']).toBeDefined();
  });

  it('removes the participant and device series but leaves everyone else alone', async () => {
    await dropParticipant({ file: sessionFile, participant: 'drive-by', write: true });

    const keys = Object.keys((await readSession()).timeline.series);
    expect(keys.some(k => k.startsWith('drive-by:'))).toBe(false);
    expect(keys).not.toContain('device:10000:heart-rate');
    expect(keys).toContain('kid-one:hr');
    expect(keys).toContain('device:10001:heart-rate');
    expect(keys).toContain('global:coins');
  });

  it('drops the session strava link and the echoed strava_notes with it', async () => {
    const report = await dropParticipant({ file: sessionFile, participant: 'drive-by', write: true });

    const session = await readSession();
    expect(session.strava).toBeUndefined();
    expect(session.strava_notes).toBeUndefined();
    expect(report.removed.sessionStrava).toBe(true);
    expect(report.removed.stravaNotes).toBe(true);
    expect(report.removed.activityId).toBe(19465331355);
  });

  it('strips the participant out of challenge rosters', async () => {
    const report = await dropParticipant({ file: sessionFile, participant: 'drive-by', write: true });

    const challenge = (await readSession()).timeline.events.find(e => e.type === 'challenge');
    expect(challenge.data.metUsers).toEqual([]);
    expect(challenge.data.missingUsers).toEqual(['kid-one']);
    expect(report.removed.challengeMentions).toBe(1);
  });

  it('writes a backup outside any date directory', async () => {
    const report = await dropParticipant({ file: sessionFile, participant: 'drive-by', write: true });

    expect(report.backupPath).toContain('_participant_backups');
    // The session lister globs every *.yml inside YYYY-MM-DD dirs, so a backup
    // left in one would load as a duplicate sessionId.
    expect(path.basename(path.dirname(report.backupPath))).toBe('_participant_backups');
    const backup = yaml.load(await readFile(report.backupPath, 'utf8'));
    expect(backup.participants['drive-by']).toBeDefined();
  });

  it('leaves the minted household coins untouched and says so', async () => {
    const report = await dropParticipant({ file: sessionFile, participant: 'drive-by', write: true });

    const session = await readSession();
    expect(session.treasureBox.totalCoins).toBe(4179);
    expect(session.summary.coins.total).toBe(4179);
    expect(report.kept.treasureBoxCoins).toBe(4179);
  });

  it('keeps the primary media flag where it was', async () => {
    await dropParticipant({ file: sessionFile, participant: 'drive-by', write: true });

    const media = (await readSession()).summary.media;
    expect(media.find(m => m.primary)?.contentId).toBe('plex:665672');
  });
});

describe('dropParticipant — refusals', () => {
  it('refuses a participant that is not in the session', async () => {
    await expect(dropParticipant({ file: sessionFile, participant: 'nobody' }))
      .rejects.toThrow(/not a participant/i);
  });

  it('refuses to empty the session', async () => {
    await setUp({
      ...contaminatedSession(),
      participants: { 'drive-by': { hr_device: '10000' } },
    });

    await expect(dropParticipant({ file: sessionFile, participant: 'drive-by' }))
      .rejects.toThrow(/only participant/i);
  });

  it('takes an explicitly named device series when the participant declares none', async () => {
    // Real sessions often omit hr_device for some participants (20260725132556
    // declares it for one of four), and the raw `device:<id>:heart-rate` feed is
    // not byte-identical to `<id>:hr`, so ownership cannot be inferred safely.
    const session = contaminatedSession();
    delete session.participants['drive-by'].hr_device;
    await setUp(session);

    const report = await dropParticipant({
      file: sessionFile,
      participant: 'drive-by',
      alsoDevices: ['10000'],
      write: true,
    });

    expect(report.removed.deviceSeriesKeys).toEqual(['device:10000:heart-rate']);
    expect(report.declaredDevice).toBe(null);
    expect(Object.keys((await readSession()).timeline.series))
      .not.toContain('device:10000:heart-rate');
  });

  it('refuses to take a device another participant declares', async () => {
    await expect(dropParticipant({
      file: sessionFile,
      participant: 'drive-by',
      alsoDevices: ['10001'], // kid-one's strap
    })).rejects.toThrow(/10001/);
  });

  it('keeps a device series that another participant also uses', async () => {
    const session = contaminatedSession();
    session.participants['kid-two'].hr_device = '10000';
    await setUp(session);

    const report = await dropParticipant({ file: sessionFile, participant: 'drive-by' });
    expect(report.removed.deviceSeriesKeys).toEqual([]);
  });
});
