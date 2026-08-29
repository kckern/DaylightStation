export class AdminNotificationOperations {
  constructor({ configuration, ledger }) { this.configuration = configuration; this.ledger = ledger; }
  readConfiguration() { return this.configuration.getConfig(); }
  updateConfiguration(changes) { return this.configuration.updateConfig(changes); }
  recentEvents(limit) { return this.ledger.recentEvents(limit); }
}
