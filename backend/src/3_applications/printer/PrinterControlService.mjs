function tier(outcome) {
  if (typeof outcome !== 'object' || outcome === null) return {};
  return { dispatched: outcome.dispatched === true, verified: outcome.verified === true,
    verification: outcome.verification ?? null, faults: outcome.faults ?? null, printerState: outcome.printerState ?? null };
}
export class PrinterControlService {
  #fleet; #readOutcome;
  constructor({ fleet, readPrintOutcome }) { this.#fleet = fleet; this.#readOutcome = readPrintOutcome; }
  list() { return this.#fleet.list(); }
  locationError(location) { try { this.#fleet.resolve(location); return null; } catch (error) { return { kind: 'not_found', error: error.message }; } }
  #with(location, operation) {
    let adapter;
    try { adapter = this.#fleet.resolve(location); } catch (error) { return { kind: 'not_found', error: error.message }; }
    return operation(adapter);
  }
  ping(location) { return this.#with(location, adapter => adapter.ping()); }
  status(location) { return this.#with(location, adapter => adapter.getStatus()); }
  async #print(location, create, successMessage, failureMessage, extra = {}, includeJob = true) {
    return this.#with(location, async adapter => {
      const printJob = create(adapter); const outcome = await adapter.print(printJob); const success = this.#readOutcome(outcome).printed;
      return { success, ...tier(outcome), message: success ? successMessage : failureMessage, ...(includeJob ? { printJob } : {}), ...extra };
    });
  }
  text(location, text, options) { return this.#print(location, a => a.createTextPrint(text, options), 'Text printed successfully', 'Print failed'); }
  image(location, imagePath, options) { return this.#print(location, a => a.createImagePrint(imagePath, options), 'Image printed successfully', 'Print failed'); }
  receipt(location, data) { return this.#print(location, a => a.createReceiptPrint(data), 'Receipt printed successfully', 'Print failed'); }
  table(location, data) { return this.#print(location, a => a.createTablePrint(data), 'Table printed successfully', 'Print failed'); }
  print(location, job) { return this.#print(location, () => job, 'Print job completed successfully', 'Print failed'); }
  async feedStatus(location) { const status = await this.status(location); return status?.kind === 'not_found' ? status : { success: status.success, feedButtonEnabled: status.feedButtonEnabled, note: 'Feed button status cannot be queried directly from most ESC/POS printers' }; }
  feedButton(location, enabled) { return this.#print(location, a => a.setFeedButton(enabled), enabled ? 'Feed button enabled successfully' : 'Feed button disabled successfully', enabled ? 'Feed button enable failed' : 'Feed button disable failed', { enabled }, false); }
}
