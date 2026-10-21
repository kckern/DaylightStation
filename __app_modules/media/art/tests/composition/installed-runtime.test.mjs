import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { createArtContentRuntime } from '../../server/composition/installed-runtime.mjs';
import { registerArtCanvasSources } from '../../server/composition/canvas-providers.mjs';

function fixture() {
  const events = [];
  const root = path.join(os.tmpdir(), 'art-assembly-no-io');
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const rootLogger = { child: ({ module }) => { events.push(`logger:${module}`); return logger; } };
  const configService = {
    getHouseholdAppConfig: (household, app) => { events.push(`config:${household}:${app}`); return {}; },
    getHouseholdPath: suffix => { events.push(`household:${suffix}`); return root; },
  };
  const axios = { get: vi.fn(() => { throw new Error('Assembly must not fetch images'); }) };
  const contentRegistry = { register: vi.fn((source, metadata) => events.push(`register:${source.source}:${metadata.category}`)) };
  return { events, root, args: { configService, rootLogger, axios, contentRegistry, imgBasePath: root, immichConfig: null } };
}

describe('Art installed assembly', () => {
  it('registers the art source before creating the preset API without eager image access', async () => {
    const { args, events } = fixture();
    const runtime = await createArtContentRuntime(args);
    expect(args.axios.get).not.toHaveBeenCalled();
    expect(args.contentRegistry.register).toHaveBeenCalledTimes(1);
    expect(args.contentRegistry.register.mock.calls[0][0].prefixes).toEqual([{ prefix: 'art' }]);
    expect(events).toEqual(['config:null:art', 'household:', 'logger:art-adapter', 'logger:art-content', 'register:art:art', 'household:', 'logger:ambiance-catalog', 'household:', 'logger:ambiance-history', 'logger:ambiance', 'household:', 'logger:art-catalog', 'logger:art-api']);
    expect(typeof runtime.artAdapter.getThumbnailUrl).toBe('function');
    expect(runtime.artRouter.stack.some(layer => layer.route?.path === '/preset/:key')).toBe(true);
  });

  it('constructs optional Immich support lazily even without a registry registration hook', async () => {
    const { args, events } = fixture();
    args.immichConfig = { host: 'https://immich.invalid/', apiKey: 'fixture-only' };
    args.contentRegistry = {};
    const runtime = await createArtContentRuntime(args);
    expect(args.axios.get).not.toHaveBeenCalled();
    expect(events).toEqual(['config:null:art', 'logger:art-immich', 'household:', 'logger:art-adapter', 'household:', 'logger:ambiance-catalog', 'household:', 'logger:ambiance-history', 'logger:ambiance', 'household:', 'logger:art-catalog', 'logger:art-api']);
    expect(runtime.artRouter.stack.length).toBeGreaterThan(0);
  });

  it('registers filesystem then Immich canvas sources and exposes the configured image root', () => {
    const { root } = fixture();
    const events = [];
    const registry = { register: source => events.push(source.source) };
    const app = { set: (key, value) => events.push([key, value]) };
    const httpClient = { get: vi.fn(() => { throw new Error('Registration must not fetch images'); }) };
    registerArtCanvasSources({ registry, app, httpClient, config: { canvas: { filesystem: { basePath: root }, immich: { library: 'fixture-library' } }, immich: { host: 'https://immich.invalid', apiKey: 'fixture-only' } } });
    expect(events).toEqual(['canvas-filesystem', ['canvasBasePath', root], 'canvas-immich']);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('requires a client before registering configured Immich canvas support', () => {
    const registry = { register: vi.fn() };
    registerArtCanvasSources({ registry, config: { canvas: { immich: { library: 'fixture-library' } }, immich: { host: 'https://immich.invalid', apiKey: 'fixture-only' } } });
    expect(registry.register).not.toHaveBeenCalled();
  });
});
