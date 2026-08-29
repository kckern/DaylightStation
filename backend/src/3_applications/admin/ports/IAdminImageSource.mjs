export class IAdminImageSource {
  async download(_url) { throw new Error('IAdminImageSource.download must be implemented'); }
}
