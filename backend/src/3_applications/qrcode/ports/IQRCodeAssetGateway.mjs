/** Asset capability used by QR-code generation. */
export class IQRCodeAssetGateway {
  async loadCommandIcon(_command) { throw new Error('loadCommandIcon must be implemented'); }
  async loadOptionBadges(_options) { throw new Error('loadOptionBadges must be implemented'); }
  async loadDefaultLogo() { throw new Error('loadDefaultLogo must be implemented'); }
  async fetchThumbnail(_url) { throw new Error('fetchThumbnail must be implemented'); }
}
