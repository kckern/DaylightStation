import path from 'node:path';
import imageSize from 'image-size';
import { readBinaryFromPath, readTextFromPath } from '#system/utils/FileIO.mjs';
import { IQRCodeAssetGateway } from '#apps/qrcode/ports/IQRCodeAssetGateway.mjs';

const COMMAND_ICONS = Object.freeze({
  pause: 'pause.svg', play: 'play.svg', next: 'next.svg', prev: 'prev.svg',
  ffw: 'ffw.svg', rew: 'rew.svg', stop: 'stop.svg', off: 'off.svg',
  blackout: 'blackout.svg', volume: 'vol_up.svg', speed: 'speed.svg',
});
const OPTION_ICONS = Object.freeze({ shuffle: 'shuffle.svg', continuous: 'continuous.svg' });

export class QRCodeAssetAdapter extends IQRCodeAssetGateway {
  #buttonsDir; #defaultLogoPath; #internalBaseUrl; #fetch; #logger;

  constructor({ mediaPath, defaultLogoPath, internalBaseUrl, fetchImpl = globalThis.fetch, logger = console } = {}) {
    super();
    if (!mediaPath) throw new Error('QRCodeAssetAdapter requires mediaPath');
    if (!internalBaseUrl) throw new Error('QRCodeAssetAdapter requires internalBaseUrl');
    if (typeof fetchImpl !== 'function') throw new Error('QRCodeAssetAdapter requires fetchImpl');
    this.#buttonsDir = path.join(mediaPath, 'img/buttons');
    this.#defaultLogoPath = defaultLogoPath || path.join(mediaPath, 'img/favicon.ico');
    this.#internalBaseUrl = internalBaseUrl.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
    this.#logger = logger;
  }

  async loadCommandIcon(command) {
    const filename = COMMAND_ICONS[command];
    if (!filename) return null;
    try {
      const svg = readTextFromPath(path.join(this.#buttonsDir, filename));
      return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    } catch { return null; }
  }

  async loadOptionBadges(options) {
    const badges = [];
    for (const option of options) {
      const filename = OPTION_ICONS[option.split('=')[0]];
      if (!filename) continue;
      try {
        const svg = readTextFromPath(path.join(this.#buttonsDir, filename));
        const match = svg.match(/<path[^>]*d="([^"]*)"[^>]*\/>/);
        if (match) badges.push(match[1]);
      } catch { /* missing badges are optional */ }
    }
    return badges;
  }

  async loadDefaultLogo() {
    try {
      const buffer = readBinaryFromPath(this.#defaultLogoPath);
      const extension = path.extname(this.#defaultLogoPath).slice(1);
      const mime = extension === 'ico' ? 'image/x-icon'
        : extension === 'svg' ? 'image/svg+xml' : `image/${extension}`;
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch { return null; }
  }

  async fetchThumbnail(url) {
    try {
      const fullUrl = url.startsWith('/') ? `${this.#internalBaseUrl}${url}` : url;
      const response = await this.#fetch(fullUrl);
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) return null;
      let contentType = response.headers.get('content-type') || 'image/jpeg';
      if (buffer[0] === 0x89 && buffer[1] === 0x50) contentType = 'image/png';
      else if (buffer[0] === 0xFF && buffer[1] === 0xD8) contentType = 'image/jpeg';
      let aspect = 1;
      try {
        const dimensions = imageSize(buffer);
        if (dimensions.width && dimensions.height) aspect = dimensions.width / dimensions.height;
      } catch { /* square fallback */ }
      return { dataUri: `data:${contentType};base64,${buffer.toString('base64')}`, aspect };
    } catch (err) {
      this.#logger.debug?.('qrcode.thumbnail.fetchFailed', { url, error: err.message });
      return null;
    }
  }
}
