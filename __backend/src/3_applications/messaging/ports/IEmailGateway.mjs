export class IEmailGateway {
  isConfigured() { throw new Error('IEmailGateway.isConfigured must be implemented'); }
  async getInboxMessages(_options) { throw new Error('IEmailGateway.getInboxMessages must be implemented'); }
  async harvestEmails() { throw new Error('IEmailGateway.harvestEmails must be implemented'); }
  getMetrics() { throw new Error('IEmailGateway.getMetrics must be implemented'); }
}
