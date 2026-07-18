/**
 * Forensic metadata embedded in each contact sheet.
 *
 * A sheet frequently ends up separated from the archive — copied into a chat,
 * attached to an email, handed to someone else. Embedding provenance means the
 * image stays self-describing: which camera, which span, what was detected,
 * and — critically — HOW confident each detection was.
 *
 * That last part matters most. The ledger mixes a documented Home Assistant AI
 * detection with a reverse-engineered filename bit and a bare bitrate-density
 * guess. Flattening those into "person" would misrepresent a heuristic as an
 * observation. Every embedded detection carries its `source` and `confidence`.
 *
 * NOT TAMPER-EVIDENT. EXIF is trivially editable, so this supports an
 * investigation; it does not prove anything. The stronger artifact is the
 * append-only ledger JSONL, which is written to several destinations and never
 * rewritten in place.
 *
 * @module 2_domains/camera/sheetMetadata
 */

import { exifTimestamp } from './sheetPlan.mjs';

/** EXIF APP1 has a hard 64KB ceiling; stay well inside it. */
const MAX_DETECTIONS = 60;

/**
 * Build the YAML block embedded as EXIF UserComment.
 *
 * @param {Object} args
 * @param {string} args.camera
 * @param {{kind:string,start:Date,end:Date,labels:string[],part?:number,parts?:number}} args.entry
 * @param {Array<Object>} [args.detections] - ledger records overlapping the span
 * @param {Object} [args.provenance] - { pipeline, source, channel, streamType, commit }
 * @param {Object} [args.sampling] - { grid, frames, fps, tileWidth }
 * @returns {string} YAML
 */
export function buildSheetMetadata({ camera, entry, detections = [], provenance = {}, sampling = {} }) {
  const overlapping = detections
    .filter((d) => overlaps(d, entry))
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const shown = overlapping.slice(0, MAX_DETECTIONS);
  const lines = [];

  lines.push('# DaylightStation camera archive — contact sheet');
  lines.push('# Descriptive metadata, NOT tamper-evident. Authoritative record');
  lines.push('# is the append-only ledger JSONL.');
  lines.push(`camera: ${camera}`);
  lines.push(`kind: ${entry.kind}`);
  lines.push(`start: ${exifTimestamp(entry.start)}`);
  lines.push(`end: ${exifTimestamp(entry.end)}`);
  lines.push(`durationSec: ${Math.round((entry.end - entry.start) / 1000)}`);
  lines.push(`timezoneOffsetMinutes: ${-entry.start.getTimezoneOffset()}`);
  if (entry.parts) lines.push(`part: ${entry.part} of ${entry.parts}`);

  if (entry.labels?.length) lines.push(`labels: [${entry.labels.join(', ')}]`);

  if (Object.keys(sampling).length) {
    lines.push('sampling:');
    for (const [k, v] of Object.entries(sampling)) lines.push(`  ${k}: ${v}`);
  }

  if (Object.keys(provenance).length) {
    lines.push('provenance:');
    for (const [k, v] of Object.entries(provenance)) lines.push(`  ${k}: ${v}`);
  }

  lines.push(`detectionCount: ${overlapping.length}`);
  if (overlapping.length > shown.length) {
    lines.push(`detectionsTruncated: ${overlapping.length - shown.length}`);
  }

  if (shown.length) {
    lines.push('detections:');
    for (const d of shown) {
      lines.push(`  - ts: ${d.ts}`);
      if (d.endTs) lines.push(`    endTs: ${d.endTs}`);
      lines.push(`    labels: [${(d.labels ?? []).join(', ')}]`);
      // source/confidence are the point: they separate an HA observation from
      // a filename-bit inference or a bitrate guess.
      lines.push(`    source: ${d.source ?? 'unknown'}`);
      lines.push(`    confidence: ${d.confidence ?? 'unknown'}`);
      if (d.densityMBPerMin != null) lines.push(`    densityMBPerMin: ${d.densityMBPerMin}`);
    }
  }

  return lines.join('\n');
}

/** Short one-line summary for EXIF ImageDescription. */
export function buildSheetDescription({ camera, entry, detections = [] }) {
  const overlapping = detections.filter((d) => overlaps(d, entry));
  const labels = new Set();
  for (const d of overlapping) for (const l of d.labels ?? []) labels.add(l);
  const what = labels.size ? [...labels].join(',') : entry.kind === 'hour' ? 'no detections' : 'motion';
  const { start } = entry;
  const hhmm = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
  return `${camera} ${hhmm} — ${what} (${overlapping.length} detections)`;
}

function overlaps(detection, entry) {
  const dStart = new Date(detection.ts).getTime();
  const dEnd = new Date(detection.endTs ?? detection.ts).getTime();
  return dStart < entry.end.getTime() && dEnd > entry.start.getTime();
}
