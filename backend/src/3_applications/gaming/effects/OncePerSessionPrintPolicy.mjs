export class OncePerSessionPrintPolicy {
  constructor({ renderer, printer, receipts }) { Object.assign(this, { renderer, printer, receipts }); this.inFlight = new Map(); }
  async print({ sessionId, content, explicit = true, autoPrint = false }) {
    if (!explicit && !autoPrint) return { status: 'not-requested' };
    const key = `gaming-host-packet:${sessionId}`; const prior = await this.receipts.get(key); if (prior) return { ...prior, duplicate: true };
    if (this.inFlight.has(key)) return { ...(await this.inFlight.get(key)), duplicate: true };
    if (!this.printer) return { status: 'printer-unavailable', key: `gaming-host-packet:${sessionId}` };
    const operation = (async () => { const document = await this.renderer.render(content); const result = await this.printer.print(document, { sessionId }); const receipt = { status: 'printed', key, result }; await this.receipts.put(key, receipt); return receipt; })();
    this.inFlight.set(key, operation); try { return await operation; } finally { this.inFlight.delete(key); }
  }
}
