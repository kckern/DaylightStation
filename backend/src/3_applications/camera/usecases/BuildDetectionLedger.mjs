/**
 * Pipeline C — the detection ledger.
 *
 * An independent, append-only, text-only record of what the cameras detected,
 * stored separately from any video. It is (a) the trigger index Pipeline A
 * selects against, (b) a durable secondary attestation if video is lost or
 * corrupted, and (c) what makes future re-classification possible without
 * re-downloading anything.
 *
 * This is the only part of the system actively losing data: HA history holds
 * 10 days, camera trigger bits ~14 days, and the NVR records no detections at
 * all. Everything here is cheap on purpose — no downloads, no ffmpeg.
 */

import { toClip } from '#domains/camera/selection.mjs';

/**
 * Build ledger records for one camera-day from every source available.
 *
 * Sources are layered strongest-first; each record carries the `source` that
 * produced it so a weak density guess is never mistaken for an HA detection.
 */
export async function buildLedgerRecords({
  camera, day, cameraSource, nvrSource, haHistory, bitMap, parseTriggerBits,
}) {
  // Pure, but it encodes the recorder's clip-naming convention, so it is the
  // adapter's knowledge. Injected rather than imported (D1).
  if (typeof parseTriggerBits !== 'function') {
    throw new Error('buildLedgerRecords requires a parseTriggerBits function');
  }
  const records = [];

  // Strongest: Home Assistant detections (~10 day window).
  for (const interval of haHistory ?? []) {
    records.push({
      ts: interval.start,
      endTs: interval.end,
      camera,
      labels: [interval.label],
      source: 'ha',
      confidence: 'high',
    });
  }

  // Middle: camera-side motion clips, with trigger bits parsed from filenames
  // (~14 day window; undocumented encoding, hence 'medium').
  if (cameraSource) {
    const clips = (await cameraSource.search(day)).map((r) => toClip(r, { date: day }));
    for (const clip of clips) {
      const parsed = parseTriggerBits(clip.name, bitMap);
      records.push({
        ts: clip.start.toISOString(),
        endTs: clip.end.toISOString(),
        camera,
        labels: parsed?.labels?.length ? parsed.labels : ['motion'],
        source: parsed?.labels?.length ? 'filename-bits' : 'motion-clip',
        confidence: parsed?.labels?.length ? 'medium' : 'low',
        clip: { name: clip.name, sizeBytes: clip.sizeBytes },
        densityMBPerMin: round2(clip.densityMBPerMin),
        flags: parsed?.flags ?? null,
      });
    }
  }

  // Weakest: NVR continuous segments. No detections at all — only an encoded
  // density timeline, which still separates real daytime activity from static
  // night scenes and is the only signal available beyond ~14 days.
  if (nvrSource) {
    const segments = (await nvrSource.search(day)).map((r) => toClip(r, { date: day }));
    for (const seg of segments) {
      records.push({
        ts: seg.start.toISOString(),
        endTs: seg.end.toISOString(),
        camera,
        labels: [],
        source: 'density',
        confidence: 'low',
        densityMBPerMin: round2(seg.densityMBPerMin),
        sizeBytes: seg.sizeBytes,
      });
    }
  }

  return records.sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
