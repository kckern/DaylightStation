/**
 * Adapter-shape tests. Offline — no camera, no NVR, no network.
 *
 * These cover the two places the Reolink API is quietly inconsistent between
 * devices, both of which are invisible if you only ever test one camera.
 */

import { describe, it, expect } from 'vitest';
import { toDownloadSource, toReolinkTime, parseTriggerBits, makeSource } from './reolink.lib.mjs';

describe('toDownloadSource', () => {
  it('strips the driveway absolute mount prefix', () => {
    expect(toDownloadSource('/mnt/sda/Mp4Record/2026-07-17/RecS0A_x.mp4')).toBe(
      'Mp4Record/2026-07-17/RecS0A_x.mp4',
    );
  });

  it('leaves the doorbell relative form untouched', () => {
    expect(toDownloadSource('Mp4Record/2026-07-17/RecS07_x.mp4')).toBe(
      'Mp4Record/2026-07-17/RecS07_x.mp4',
    );
  });

  it('handles other mount letters', () => {
    expect(toDownloadSource('/mnt/sdb/Mp4Record/a.mp4')).toBe('Mp4Record/a.mp4');
  });
});

describe('toReolinkTime', () => {
  it('converts a local Date into Reolink 1-based month fields', () => {
    expect(toReolinkTime(new Date(2026, 6, 17, 18, 1, 3))).toEqual({
      year: 2026,
      mon: 7,
      day: 17,
      hour: 18,
      min: 1,
      sec: 3,
    });
  });
});

describe('parseTriggerBits', () => {
  const driveway = { person: 35, vehicle: 38, motion: 36 };

  it('extracts labels from a real driveway filename', () => {
    const out = parseTriggerBits(
      '/mnt/sda/Mp4Record/2026-07-17/RecS0A_DST20260717_180103_180141_0_8D28C000000000_1B9195.mp4',
      driveway,
    );
    expect(out).not.toBeNull();
    expect(out.flags).toBe('8D28C000000000');
    expect(Array.isArray(out.labels)).toBe(true);
  });

  it('distinguishes two real filenames with different flag fields', () => {
    // Real names from the 2026-07-17 driveway fixture. 0x...C0... sets bit 38
    // (vehicle) while 0x...90... sets bit 36 (motion) — the flag field is
    // parts[5], so the leading five fields must be present for this to parse.
    const a = parseTriggerBits('RecS0A_DST20260717_180103_180141_0_8D28C000000000_1B9195.mp4', driveway);
    const b = parseTriggerBits('RecS0A_DST20260717_014348_014416_0_8D289000000000_9423B.mp4', driveway);
    expect(a.labels).toContain('vehicle');
    expect(b.labels).toContain('motion');
    expect(a.labels).not.toEqual(b.labels);
  });

  it('returns null for NVR records, which carry no name at all', () => {
    expect(parseTriggerBits(null, driveway)).toBeNull();
  });

  it('returns null rather than throwing on an unparseable field', () => {
    expect(parseTriggerBits('a_b_c_d_e_ZZZZ_f.mp4', driveway)).toBeNull();
    expect(parseTriggerBits('too_short.mp4', driveway)).toBeNull();
  });

  it('yields no labels when the camera has no bit map (doorbell)', () => {
    const out = parseTriggerBits('x_0_0_0_0_0_3914C00000_z.mp4', {});
    expect(out.labels).toEqual([]);
  });
});

describe('makeSource', () => {
  it('marks the camera profile as carrying trigger names and the NVR as not', () => {
    const client = {};
    expect(makeSource({ kind: 'camera', client, channel: 0 }).hasTriggerNames).toBe(true);
    expect(makeSource({ kind: 'nvr', client, channel: 1 }).hasTriggerNames).toBe(false);
  });

  it('rejects an unknown source kind rather than failing later', () => {
    expect(() => makeSource({ kind: 'ftp', client: {}, channel: 0 })).toThrow(/Unknown source kind/);
  });

  it('resolves an NVR fragment before downloading it (two-step)', async () => {
    const calls = [];
    const client = {
      nvrResolveFragment: async (args) => {
        calls.push(['resolve', args]);
        return { name: 'fragment_02_2_20260717110000.mp4', sizeBytes: 4443106 };
      },
      download: async (args) => {
        calls.push(['download', args]);
        return 4443106;
      },
    };
    const source = makeSource({ kind: 'nvr', client, channel: 1 });
    await source.fetch({ start: new Date(2026, 6, 17, 18, 0), end: new Date(2026, 6, 17, 18, 1), destPath: '/tmp/x.mp4' });

    expect(calls.map((c) => c[0])).toEqual(['resolve', 'download']);
    expect(calls[1][1].source).toBe('fragment_02_2_20260717110000.mp4');
  });
});
