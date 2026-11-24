/** Loads a session and delegates its visual projection to the receipt boundary. */
export class RenderFitnessReceipt {
  constructor({ loadSession, receiptRenderer } = {}) {
    if (typeof loadSession !== 'function' || !receiptRenderer?.createCanvas) {
      throw new Error('RenderFitnessReceipt requires loadSession and receiptRenderer');
    }
    this.loadSession = loadSession;
    this.receiptRenderer = receiptRenderer;
  }

  async execute(sessionId) {
    const session = await this.loadSession(sessionId);
    return session ? this.receiptRenderer.createCanvas(session) : null;
  }
}

export default RenderFitnessReceipt;
