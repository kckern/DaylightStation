// A second Immich server is proxied under its own name: the passthrough
// handlers discover it from the proxy service, and the router mounts it at
// /proxy/<name> beside the default /proxy/immich.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProxyRouter, createProxyPassthroughHandlers } from '#backend/src/4_api/v1/routers/proxy.mjs';
import { ProxyService } from '#backend/src/0_system/proxy/ProxyService.mjs';
import { ImmichProxyAdapter } from '#adapters/proxy/ImmichProxyAdapter.mjs';

describe('proxy router: additional Immich instances', () => {
  it('discovers every non-default Immich proxy by kind', () => {
    const proxyService = new ProxyService({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
    proxyService.register(new ImmichProxyAdapter({ host: 'http://main', apiKey: 'a' }));
    proxyService.register(new ImmichProxyAdapter({ host: 'http://family', apiKey: 'b', serviceName: 'familyphotos' }));

    const handlers = createProxyPassthroughHandlers(proxyService);

    expect(typeof handlers.immich).toBe('function');
    expect(Object.keys(handlers.immichInstances)).toEqual(['familyphotos']);
    expect(proxyService.getAdapter('familyphotos').getBaseUrl()).toBe('http://family');
  });

  it('mounts each instance at its own route', async () => {
    const seen = [];
    const app = express();
    app.use('/proxy', createProxyRouter({
      passthroughHandlers: {
        immich: (req, res) => { seen.push(['immich', req.url]); res.end('main'); },
        immichInstances: {
          familyphotos: (req, res) => { seen.push(['familyphotos', req.url]); res.end('family'); },
        },
      },
    }));

    const family = await request(app).get('/proxy/familyphotos/assets/abc/thumbnail?size=preview');
    const main = await request(app).get('/proxy/immich/assets/xyz/thumbnail');

    expect(family.text).toBe('family');
    expect(main.text).toBe('main');
    expect(seen).toEqual([
      ['familyphotos', '/assets/abc/thumbnail?size=preview'],
      ['immich', '/assets/xyz/thumbnail'],
    ]);
  });
});
