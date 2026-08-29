export class IEpaperDisplay {
  getCached() { throw new Error('IEpaperDisplay.getCached must be implemented'); }
  async render(_data) { throw new Error('IEpaperDisplay.render must be implemented'); }
  getStatus() { throw new Error('IEpaperDisplay.getStatus must be implemented'); }
}
