/** Runs configured display-on effects after trigger content is approved. */
export class NotifyApprovedScreen {
  constructor({ scriptsForScreen, homeAutomation, logger = console } = {}) {
    if (typeof scriptsForScreen !== 'function') throw new Error('NotifyApprovedScreen requires scriptsForScreen');
    this.scriptsForScreen = scriptsForScreen;
    this.homeAutomation = homeAutomation;
    this.logger = logger;
  }

  async execute(targetScreen) {
    const scripts = this.scriptsForScreen(targetScreen) || [];
    if (!this.homeAutomation?.callService) return;
    for (const scriptId of scripts) {
      try {
        await this.homeAutomation.callService('script', 'turn_on', { entity_id: scriptId });
        this.logger.info?.('trigger.ingress.barcode.display.on', { targetScreen, scriptId });
      } catch (error) {
        this.logger.warn?.('trigger.ingress.barcode.display.failed', {
          targetScreen, scriptId, error: error.message,
        });
      }
    }
  }
}

export default NotifyApprovedScreen;
