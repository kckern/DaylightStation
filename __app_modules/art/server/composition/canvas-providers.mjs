import { FilesystemCanvasAdapter, ImmichCanvasAdapter } from '../adapters/canvas/index.mjs';
import { ImmichClient } from '../../../../__capabilities/content-catalog/server/adapters/providers/gallery/immich/ImmichClient.mjs';

export function registerArtCanvasSources({ registry, config, httpClient, app }) {
  // Register canvas-filesystem adapter if configured
  const canvasBasePath = config.canvas?.filesystem?.basePath;
  if (canvasBasePath) {
    registry.register(new FilesystemCanvasAdapter({
      basePath: canvasBasePath,
      proxyPath: config.canvas?.proxyPath || '/api/v1/canvas/image'
    }));
    // Make basePath available to canvas image proxy endpoint
    if (app) {
      app.set('canvasBasePath', canvasBasePath);
    }
  }

  // Register canvas-immich adapter if immich is configured and canvas.immich.library is set
  if (config.immich?.host && config.immich?.apiKey && config.canvas?.immich?.library && httpClient) {
    const immichClient = new ImmichClient({
      host: config.immich.host,
      apiKey: config.immich.apiKey
    }, { httpClient });

    registry.register(new ImmichCanvasAdapter({
      library: config.canvas.immich.library,
      proxyPath: config.canvas?.immich?.proxyPath || '/api/v1/proxy/immich-canvas'
    }, { client: immichClient }));
  }

}
