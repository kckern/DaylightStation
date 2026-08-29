import path from 'node:path';
import { loadYamlFromPath } from '#system/utils/FileIO.mjs';

export class DevRequestForwarder {
  #dataDir;
  #devHost;
  #environmentHost;
  #logger;

  constructor({ dataDir, devHost, environmentHost, logger = console } = {}) {
    this.#dataDir = dataDir;
    this.#devHost = devHost;
    this.#environmentHost = environmentHost;
    this.#logger = logger;
  }

  getTargetHost() {
    if (this.#dataDir) {
      const config = loadYamlFromPath(path.join(this.#dataDir, 'system', 'config', 'dev.yml'));
      if (config?.host) return config.host;
    }
    return this.#devHost || this.#environmentHost || null;
  }

  async forward({ method, originalUrl, contentType, secretToken, forwardedFor, body }) {
    const targetHost = this.getTargetHost();
    if (!targetHost) {
      const error = new Error('LOCAL_DEV_HOST not configured');
      error.code = 'DEV_HOST_NOT_CONFIGURED';
      throw error;
    }

    let targetPath = originalUrl;
    if (!targetPath.startsWith('/api/v1') && !targetPath.startsWith('/dev')) {
      targetPath = `/api/v1${targetPath}`;
    }
    const targetUrl = `http://${targetHost}${targetPath}`;

    this.#logger.info?.('devProxy.forwarding', { method, originalUrl, targetUrl });

    try {
      const options = {
        method,
        headers: {
          'content-type': contentType || 'application/json',
          'x-telegram-bot-api-secret-token': secretToken || '',
          'x-forwarded-for': forwardedFor || '',
          'x-proxy-source': 'daylight-ddd',
        },
      };
      if (method !== 'GET' && method !== 'HEAD' && body) options.body = JSON.stringify(body);

      const response = await fetch(targetUrl, options);
      const responseContentType = response.headers.get('content-type') || '';
      return {
        status: response.status,
        contentType: responseContentType,
        body: responseContentType.includes('application/json')
          ? await response.json()
          : await response.text(),
        json: responseContentType.includes('application/json'),
      };
    } catch (cause) {
      this.#logger.error?.('devProxy.forward.failed', { targetUrl, error: cause.message });
      const error = new Error(cause.message, { cause });
      error.code = 'DEV_PROXY_FAILED';
      error.targetUrl = targetUrl;
      throw error;
    }
  }
}
