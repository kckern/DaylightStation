import os from 'node:os';
import path from 'node:path';
import { removeFileAsync, writeBinaryExclusiveAsync } from '#system/utils/FileIO.mjs';
import { shortId } from '#system/utils/id.mjs';
import { transcribeEscPosItems } from '#system/utils/escposTranscript.mjs';
import { codesFrom as receiptCodesFrom } from './DocumentReceiptRasterAdapter.mjs';
import { IReceiptArtifactPrinter } from '#apps/school/ports/IReceiptArtifactPrinter.mjs';
import { readPrintOutcome } from '#domains/core/utils/printOutcome.mjs';

/** Prints retained PNG bytes while preserving transcript/codes and confirmation semantics. */
export class RetainedReceiptPrinter extends IReceiptArtifactPrinter {
  constructor({ printer, textRenderer = null, logger = console } = {}) {
    super();
    if (!printer?.print) throw new Error('RetainedReceiptPrinter requires printer');
    this.printer = printer;
    this.textRenderer = textRenderer;
    this.logger = logger;
  }

  async print({ bytes, representation, jobName, sourceDocument = null }) {
    if (representation?.mediaType !== 'image/png') {
      return { printed: false, confirmed: false, faulted: false, reason: 'unsupported_representation' };
    }
    let transcript;
    let codes;
    if (sourceDocument && this.textRenderer) {
      try {
        const textJob = await this.textRenderer.render(sourceDocument, {});
        transcript = transcribeEscPosItems(textJob.items);
        codes = receiptCodesFrom(textJob);
      } catch (error) {
        this.logger.warn?.('school.receipt.artifact-transcript-unavailable', { jobName, error: error.message });
      }
    }
    const temporaryPath = path.join(os.tmpdir(), `school-retained-receipt-${shortId(16)}.png`);
    await writeBinaryExclusiveAsync(temporaryPath, bytes);
    try {
      const outcome = await this.printer.print({
        items: [{ type: 'image', path: temporaryPath, width: representation.width ?? 384,
          height: representation.height ?? 1, align: 'left', threshold: 128 }],
        footer: { paddingLines: 3, autoCut: true }, jobName,
        ...(typeof transcript === 'string' ? { transcript } : {}),
        ...(codes ? { codes } : {}),
      });
      const claim = readPrintOutcome(outcome);
      const dispatched = outcome === true || outcome?.dispatched === true;
      const reason = claim.confirmed ? null : claim.printed ? 'unverified'
        : claim.faulted && dispatched ? 'printer_fault' : 'printer_refused';
      const evidence = {
        jobName,
        ...claim,
        reason,
        dispatched,
        verification: outcome === true ? 'verified' : outcome?.verification ?? null,
        faults: outcome?.faults ?? null,
        statusAnswered: outcome?.printerState?.answered ?? null,
        statusError: outcome?.printerState?.error ?? null,
      };
      this.logger[claim.confirmed ? 'info' : 'warn']?.('school.receipt.artifact-print', evidence);
      return evidence;
    } finally {
      await removeFileAsync(temporaryPath, { force: true }).catch(() => {});
    }
  }
}
