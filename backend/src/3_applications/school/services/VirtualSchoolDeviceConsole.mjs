/** Semantic console over the gated virtual hardware doubles. */
export class VirtualSchoolDeviceConsole {
  constructor({ laserPrinter = null, thermalPrinter = null, scanner = null, playback = null,
    omrReader = null, getFormMap = null } = {}) {
    this.laser = laserPrinter;
    this.thermal = thermalPrinter;
    this.scanner = scanner;
    this.playback = playback;
    this.omr = omrReader;
    this.getFormMap = getFormMap;
  }

  get available() { return Boolean(this.laser || this.thermal || this.scanner || this.playback || this.omr); }
  get capturesAvailable() { return Boolean(this.laser || this.thermal); }
  get scannerAvailable() { return Boolean(this.scanner); }
  get playbackAvailable() { return Boolean(this.playback); }
  get omrAvailable() { return Boolean(this.omr && this.getFormMap); }
  get faultsAvailable() { return this.capturesAvailable; }

  status() {
    return { devices: {
      laser: this.laser ? { present: true, fault: this.laser.getFault(), jobs: this.laser.listJobs().length } : { present: false },
      thermal: this.thermal ? { present: true, fault: this.thermal.getFault(), receipts: this.thermal.listReceipts().length } : { present: false },
      scanner: this.scanner ? { present: true, scans: this.scanner.listScans().length, lastScan: this.scanner.lastScan() } : { present: false },
      playback: this.playback ? { present: true, dispatches: this.playback.listDispatches().length } : { present: false },
      omr: this.omr ? { present: true, sheets: this.omr.listSheets().length, forms: Boolean(this.getFormMap) } : { present: false },
    } };
  }

  listCaptures() {
    const laser = (this.laser?.listJobs() || []).map((job) => ({
      kind: 'laser', id: job.jobId, at: job.at, title: job.jobName, requestedBy: job.requestedBy,
      copies: job.copies, pageCount: job.pageCount, bytes: job.bytes, contentType: 'application/pdf',
    }));
    const thermal = (this.thermal?.listReceipts() || []).map((receipt) => ({
      kind: 'thermal', id: receipt.receiptId, at: receipt.at,
      title: (receipt.transcript ?? '').split('\n').find((line) => line.trim()) || null,
      itemCount: receipt.itemCount, imageCount: receipt.images?.length ?? 0,
      bytes: Buffer.byteLength(receipt.transcript ?? '', 'utf8'), transcript: receipt.transcript ?? '',
      contentType: 'application/json',
    }));
    return [...laser, ...thermal].sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.id.localeCompare(a.id));
  }

  async capture(kind, id) {
    if (kind === 'laser') {
      if (!this.laser) return { kind: 'device_not_wired', device: 'laser' };
      const job = await this.laser.readJob(id);
      return job ? { kind: 'laser', job } : { kind: 'not_found', capture: 'laser', id };
    }
    if (kind === 'thermal') {
      if (!this.thermal) return { kind: 'device_not_wired', device: 'thermal' };
      const receipt = this.thermal.readReceipt(id);
      return receipt ? { kind: 'thermal', receipt } : { kind: 'not_found', capture: 'receipt', id };
    }
    return { kind: 'invalid_kind' };
  }

  scan(code, options) { return this.scanner.scan(code, options); }
  scans() { return { scans: this.scanner.listScans(), cards: this.scanner.listCards() }; }
  dispatches() { return this.playback.listDispatches(); }
  complete(dispatchId) { return this.playback.playToEnd(dispatchId); }
  interrupt(dispatchId) { return this.playback.interrupt(dispatchId); }
  advance(dispatchId, seconds) { return this.playback.advance(dispatchId, seconds); }

  async #form(formId) {
    if (typeof formId !== 'string' || !formId.trim()) return { kind: 'invalid' };
    const formMap = await this.getFormMap(formId);
    return formMap ? { kind: 'found', formMap } : { kind: 'not_found' };
  }
  async formLayout(formId) {
    const form = await this.#form(formId);
    return form.kind === 'found'
      ? { kind: 'found', formVersion: form.formMap.formVersion, layout: this.omr.formLayout(form.formMap) }
      : form;
  }
  async submitOmr({ formId, answers, ambiguous, blank }) {
    const form = await this.#form(formId);
    return form.kind === 'found' ? {
      kind: 'submitted', formVersion: form.formMap.formVersion,
      sheet: this.omr.scanSheet({ formMap: form.formMap, chosen: answers, ambiguous, blank }),
    } : form;
  }
  sheets() { return this.omr.listSheets(); }

  setFault(device, fault) {
    const target = device === 'laser' ? this.laser : device === 'thermal' ? this.thermal : null;
    if (!target) return { kind: 'not_wired' };
    target.setFault(fault);
    return { kind: 'set', fault: target.getFault() };
  }
}

export default VirtualSchoolDeviceConsole;
