/**
 * `IReceiptRenderer` over the canvas-based `DocumentReceiptRenderer`: turns a
 * validated receipt document into the ESC/POS **image** job
 * `ThermalPrinterAdapter.print()` accepts — the designed layout, with a real
 * scannable QR baked into the pixels, instead of plain ESC/POS text items.
 *
 * WHY THIS EXISTS RATHER THAN JUST POINTING THE COMPOSITION AT THE CANVAS
 * RENDERER DIRECTLY. `DocumentReceiptRenderer.createCanvas()` returns a
 * `{canvas, width, height}` — a picture. `ReceiptPrinting` needs an
 * `IReceiptRenderer`: something that returns a `PrintJob` (`{items, footer}`),
 * because that is the shape `ThermalPrinterAdapter.print()` accepts and the
 * only shape a thermal printer's wire protocol has. Something has to bridge
 * "a canvas" to "an ESC/POS image item with a real filesystem path", and this
 * is that bridge — not a second document renderer, a translation of the one
 * that already exists.
 *
 * TWO THINGS A BARE IMAGE ITEM CANNOT CARRY ON ITS OWN, both restored here:
 *
 *  - **An operator transcript.** ESC/POS has no way to embed decodable text
 *    inside a raster; a receipt that is nothing but `{type:'image'}` leaves
 *    `VirtualThermalPrinterAdapter`'s `.txt` capture — and a production log
 *    line reviewing what a child was told — empty. This renderer also runs
 *    the injected `escPosRenderer` (never printed; the ESC/POS items it
 *    produces are consumed only as words, via `transcribeEscPosItems`) and
 *    hands the result over as `transcript`, per `IReceiptRenderer`'s
 *    `RenderedReceipt.transcript`. `VirtualThermalPrinterAdapter` and the
 *    real `ThermalPrinterAdapter` both know to treat that string as
 *    authoritative rather than trying to decode it back out of a bitmap.
 *  - **What a child can scan.** The QR in the raster is pixels, not a
 *    `qrcode` item — nothing that reads `items` for scannable actions (the
 *    school e2e harness's `barcodesInLastReceipt`, chiefly) can see it there.
 *    The same `escPosRenderer` pass already resolved every `scan_action`/
 *    `media_action` to its printed code, so those are threaded through too,
 *    as `codes: [{token, label}]`.
 *
 * FALLS BACK TO THE ESC/POS RENDERER ON A RASTER FAILURE. A child standing at
 * a printer with nothing is the exact failure this subsystem exists to
 * prevent (spec §6.2's "a scan never succeeds silently"), and a raster is
 * strictly more that can go wrong than plain text: font registration, canvas
 * allocation, the `qrcode` encoder, a scratch-disk write. None of that should
 * cost a household the fallback ESC/POS receipt this composition already
 * knows how to draw. `ReceiptPrinting` itself never learns the raster path
 * even tried and failed — from its side this renderer just occasionally
 * returns a text job instead of an image one, which is exactly the posture
 * "every receipt reports itself unprinted rather than lying" already expects
 * a renderer to be able to have.
 *
 * @module rendering/school/documents/DocumentReceiptRasterRenderer
 */
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { writeBinary, deleteFile } from '#system/utils/FileIO.mjs';
import { transcribeEscPosItems } from '#system/utils/escposTranscript.mjs';

/** `{barcode|qrcode}` items → `{token,label}` pairs, in printed order. */
function codesFrom(job) {
  const codes = [];
  for (const item of job?.items ?? []) {
    if (item.type === 'barcode' || item.type === 'qrcode') {
      codes.push({ token: String(item.content), label: String(item.label ?? '') });
    }
  }
  return codes;
}

/**
 * @param {object} deps
 * @param {{createCanvas: Function}} deps.canvasRenderer - `DocumentReceiptRenderer`'s
 *   `createCanvas(document, opts) -> {canvas, width, height}`
 * @param {{render: Function}} [deps.escPosRenderer] - the text+barcode
 *   renderer (`IReceiptRenderer`-shaped, see `3_applications/school/ports/
 *   IDocumentRenderer.mjs`). Doubles as the transcript/codes source on a
 *   successful raster AND as the whole fallback path on a failed one; absent,
 *   a raster failure propagates (no household runs without an ESC/POS
 *   renderer wired unless the `escpos` module itself failed to load, in which
 *   case there is nothing left to fall back to anyway).
 * @param {string} [deps.tmpDir] - scratch directory for the rendered PNG.
 *   `ThermalPrinterAdapter`'s image item reads a filesystem path (there is no
 *   in-memory item type for raw bytes), so the canvas has to touch disk once
 *   between rendering and printing regardless of who is asking.
 * @param {object} [deps.logger]
 * @returns {{render: (document: object, opts?: object) => Promise<{items: object[], footer: object, transcript: string, codes: object[], cleanup: Function}>}}
 *   the `RenderedReceipt` shape `IReceiptRenderer` declares, `transcript`/`codes`
 *   populated and a `cleanup()` added for the scratch PNG.
 */
export function createDocumentReceiptRasterRenderer({
  canvasRenderer, escPosRenderer = null, tmpDir = os.tmpdir(), logger = console,
} = {}) {
  if (!canvasRenderer) {
    throw new Error('createDocumentReceiptRasterRenderer requires canvasRenderer');
  }

  async function renderRaster(document, opts) {
    const { canvas, width, height } = await canvasRenderer.createCanvas(document, opts);
    const buffer = canvas.toBuffer('image/png');
    const tempPath = path.join(tmpDir, `school-receipt-${crypto.randomUUID()}.png`);
    writeBinary(tempPath, buffer);

    // Transcript/codes are a NICE-TO-HAVE on top of an already-successful
    // raster: the three documents this console actually prints never carry a
    // block the ESC/POS renderer refuses (spec note in the composition root),
    // but a future one that does must not sink a raster that already worked.
    // Degrading to an empty transcript here is not the "unprinted" failure
    // mode — the paper is still correct — so it is logged and swallowed, not
    // propagated.
    let transcript = '';
    let codes = [];
    if (escPosRenderer) {
      try {
        const textJob = await escPosRenderer.render(document, opts);
        transcript = transcribeEscPosItems(textJob.items);
        codes = codesFrom(textJob);
      } catch (err) {
        logger.debug?.('school.receipt.raster-transcript-unavailable', {
          id: document?.id, error: err.message,
        });
      }
    }

    return {
      items: [{
        type: 'image', path: tempPath, width, height, align: 'left', threshold: 128,
      }],
      footer: { paddingLines: 3, autoCut: true },
      transcript,
      codes,
      // `ReceiptPrinting` calls this once the job has actually reached the
      // printer (success or failure) — the scratch PNG has done its one job
      // by then. Best-effort: a stray temp file is disk clutter, never a
      // reason to report a print that went through as failed.
      cleanup: async () => { deleteFile(tempPath); },
    };
  }

  /**
   * @param {object} document
   * @param {object} [opts]
   * @returns {Promise<{items: object[], footer: object, transcript: string, codes: object[], cleanup: Function}>}
   */
  async function render(document, opts = {}) {
    try {
      return await renderRaster(document, opts);
    } catch (err) {
      if (!escPosRenderer) throw err;
      logger.warn?.('school.receipt.raster-fallback', { id: document?.id, error: err.message });
      return escPosRenderer.render(document, opts);
    }
  }

  return { render };
}

export default { createDocumentReceiptRasterRenderer };
