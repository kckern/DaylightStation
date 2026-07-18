/**
 * Sheet metadata tests.
 *
 * The forensic value of this block rests on one property: a reader must be able
 * to tell an observed Home Assistant detection from a reverse-engineered
 * filename bit from a bare bitrate guess. If source/confidence were ever
 * dropped, the metadata would present heuristics as fact — worse than having no
 * metadata at all.
 */

import { describe, it, expect } from 'vitest';
import { buildSheetMetadata, buildSheetDescription } from './sheetMetadata.mjs';

const at = (h, m = 0, s = 0) => new Date(2026, 6, 17, h, m, s);
const entry = { kind: 'event', start: at(18, 0), end: at(18, 1), labels: ['person'] };

const det = (h, m, labels, source, confidence) => ({
  ts: at(h, m).toISOString(),
  endTs: at(h, m, 30).toISOString(),
  labels,
  source,
  confidence,
});

describe('buildSheetMetadata', () => {
  it('records source and confidence for every detection', () => {
    const yaml = buildSheetMetadata({
      camera: 'doorbell',
      entry,
      detections: [det(18, 0, ['person'], 'ha', 'high')],
    });
    expect(yaml).toContain('source: ha');
    expect(yaml).toContain('confidence: high');
  });

  it('distinguishes an HA observation from a density guess in the same span', () => {
    const yaml = buildSheetMetadata({
      camera: 'driveway-camera',
      entry,
      detections: [det(18, 0, ['person'], 'ha', 'high'), det(18, 0, [], 'density', 'low')],
    });
    expect(yaml).toContain('source: ha');
    expect(yaml).toContain('source: density');
    expect(yaml).toContain('detectionCount: 2');
  });

  it('excludes detections outside the span', () => {
    const yaml = buildSheetMetadata({
      camera: 'doorbell',
      entry,
      detections: [det(3, 0, ['person'], 'ha', 'high')],
    });
    expect(yaml).toContain('detectionCount: 0');
  });

  it('includes provenance so a stray file can be traced back', () => {
    const yaml = buildSheetMetadata({
      camera: 'doorbell',
      entry,
      provenance: { pipeline: 'A', source: 'nvr', channel: 0 },
    });
    expect(yaml).toContain('pipeline: A');
    expect(yaml).toContain('channel: 0');
  });

  it('states plainly that it is not tamper-evident', () => {
    const yaml = buildSheetMetadata({ camera: 'doorbell', entry });
    expect(yaml).toMatch(/NOT tamper-evident/i);
  });

  it('records the timezone offset so local timestamps are unambiguous', () => {
    const yaml = buildSheetMetadata({ camera: 'doorbell', entry });
    expect(yaml).toMatch(/timezoneOffsetMinutes: -?\d+/);
  });

  it('truncates rather than overflowing the EXIF segment limit', () => {
    const many = Array.from({ length: 200 }, (_, i) => det(18, 0, ['person'], 'ha', 'high'));
    const yaml = buildSheetMetadata({ camera: 'doorbell', entry, detections: many });
    expect(yaml).toContain('detectionCount: 200');
    expect(yaml).toContain('detectionsTruncated:');
    expect(Buffer.byteLength(yaml)).toBeLessThan(64_000);
  });

  it('notes the part when an event was split', () => {
    const yaml = buildSheetMetadata({
      camera: 'driveway-camera',
      entry: { ...entry, part: 2, parts: 3 },
    });
    expect(yaml).toContain('part: 2 of 3');
  });
});

describe('buildSheetDescription', () => {
  it('summarises the labels present', () => {
    const d = buildSheetDescription({
      camera: 'doorbell',
      entry,
      detections: [det(18, 0, ['person'], 'ha', 'high')],
    });
    expect(d).toContain('doorbell');
    expect(d).toContain('person');
  });

  it('says so explicitly when an hour had nothing', () => {
    const d = buildSheetDescription({
      camera: 'doorbell',
      entry: { kind: 'hour', start: at(3), end: at(4), labels: [] },
      detections: [],
    });
    expect(d).toContain('no detections');
  });
});
