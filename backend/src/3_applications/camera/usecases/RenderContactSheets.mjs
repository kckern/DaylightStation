/**
 * Render a day's contact sheets from downloaded segments.
 *
 * Shared by both archive pipelines: the plan decides WHAT spans get a sheet
 * (see 2_domains/camera/sheetPlan), this decides WHERE the frames come from.
 *
 * Spans are rendered by seeking within the segment they start in, rather than
 * by concatenating the day and seeking a global offset. NVR segments do not
 * butt together perfectly — a real day showed an 18:59:54 -> 19:00:14 gap — so
 * a concatenated timeline drifts from wall-clock by the accumulated gaps, and
 * every sheet after the first gap would carry a timestamp that no longer
 * matches its frames. Per-segment seeking cannot drift.
 *
 * @module 3_applications/camera/usecases/RenderContactSheets
 */

import path from 'path';
import { mkdir } from 'fs/promises';

import { sampleRateFor, sheetName } from '#domains/camera/sheetPlan.mjs';
import { buildSheetMetadata, buildSheetDescription } from '#domains/camera/sheetMetadata.mjs';

/**
 * @param {Object} args
 * @param {Array<{start:Date,end:Date,path:string}>} args.segments - local files
 * @param {Array<Object>} args.plan - from planContactSheets
 * @param {string} args.camera
 * @param {string} args.outDir
 * @param {Object} args.encoder - ArchiveEncoder
 * @param {Array<Object>} [args.detections] - ledger records for the day
 * @param {Object} args.profile - grid/tileWidth/quality/frames
 * @param {Object} [args.provenance]
 * @returns {Promise<{written:string[], skipped:number, clamped:number}>}
 */
export async function renderContactSheets({
  segments,
  plan,
  camera,
  outDir,
  encoder,
  detections = [],
  profile,
  provenance = {},
  logger = console,
}) {
  await mkdir(outDir, { recursive: true });

  const [cols, rows] = String(profile.grid ?? '6x6').split('x').map(Number);
  const frames = profile.frames ?? cols * rows;
  const ordered = [...segments].sort((a, b) => a.start - b.start);

  const written = [];
  let skipped = 0;
  let clamped = 0;

  for (const entry of plan) {
    const segment = ordered.find((s) => s.start < entry.end && s.end > entry.start);
    if (!segment) {
      // A planned hour with no footage behind it — a recording gap. Expected
      // occasionally; silently producing nothing would hide it.
      logger.debug?.('camera.sheet.no_footage', { camera, at: entry.start.toISOString() });
      skipped++;
      continue;
    }

    const from = new Date(Math.max(entry.start, segment.start));
    let to = new Date(Math.min(entry.end, segment.end));
    if (to < entry.end) clamped++;

    const seekSeconds = Math.max(0, (from - segment.start) / 1000);
    const durationSeconds = Math.max(1, (to - from) / 1000);
    const name = sheetName(entry);
    const outPath = path.join(outDir, `${name}.jpg`);

    try {
      const rendered = await encoder.encodeContactSheet({
        inputPath: segment.path,
        outPath,
        fps: sampleRateFor(
          durationSeconds * 1000,
          frames,
          profile.sourceFps ?? 10,
          profile.minFrameGapSeconds ?? 0,
        ),
        spanStart: from,
        seekSeconds,
        durationSeconds,
        profile,
      });

      if (!rendered) {
        // No frames in that span — nothing to tag, nothing to record.
        skipped++;
        continue;
      }

      await encoder.writeSheetMetadata({
        filePath: outPath,
        dateTaken: from,
        description: buildSheetDescription({ camera, entry, detections }),
        yaml: buildSheetMetadata({
          camera,
          entry,
          detections,
          provenance,
          sampling: {
            grid: profile.grid,
            frames,
            tileWidth: profile.tileWidth,
            spanSeconds: Math.round(durationSeconds),
          },
        }),
      });

      written.push(path.basename(outPath));
    } catch (err) {
      // One bad span must not cost the day its remaining sheets.
      logger.warn?.('camera.sheet.failed', { camera, sheet: name, error: err.message });
      skipped++;
    }
  }

  logger.info?.('camera.sheets.rendered', { camera, written: written.length, skipped, clamped });
  return { written, skipped, clamped };
}

export default renderContactSheets;
