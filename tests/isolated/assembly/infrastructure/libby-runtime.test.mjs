import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguredLibbyRuntime, createLibbyRuntime } from '#composition/modules/libby.mjs';
import { createContentRegistry } from '#composition/bootstrap.mjs';
import { createApiRouters } from '#composition/modules/contentApi.mjs';
import loadConfig from '#system/config/configLoader.mjs';
import { ConfigService } from '#system/config/ConfigService.mjs';

describe('Libby runtime composition', () => {
  it('constructs Libby only for explicit household opt-in and uses one credential owner everywhere', () => {
    const disabledFactory = vi.fn();
    expect(createConfiguredLibbyRuntime({
      configService: { getHouseholdAppConfig: () => null }, dataPath: '/data', factory: disabledFactory,
    })).toEqual({ config: null, runtime: null });
    expect(disabledFactory).not.toHaveBeenCalled();

    const factory = vi.fn(() => ({ client: {}, leases: {} }));
    const configured = createConfiguredLibbyRuntime({
      configService: { getHouseholdAppConfig: (_id, app) => app === 'libby' ? { enabled: true, credential_owner: 'reader' } : null },
      householdId: 'home', dataPath: '/data', factory,
    });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ dataPath: '/data', username: 'reader' }));
    expect(configured.config).toEqual({ username: 'reader' });
    expect(configured.runtime).toEqual({ client: {}, leases: {} });
  });

  it('loads opt-in through the documented grouped household config path and normal reload API', () => {
    scratch = mkdtempSync(path.join(tmpdir(), 'libby-config-'));
    const write = (relative, contents) => {
      const target = path.join(scratch, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents, 'utf8');
    };
    write('household/household.yml', 'name: Fixture\nusers: [reader]\n');
    write('household/media/libby.yml', 'enabled: true\ncredential_owner: reader\n');
    const configService = new ConfigService(loadConfig(scratch));
    const factory = vi.fn(() => ({ client: {}, leases: {} }));

    expect(configService.getHouseholdAppConfigPath('default', 'libby')).toBe(path.join(scratch, 'household/media/libby.yml'));
    expect(configService.reloadHouseholdAppConfig('default', 'libby')).toEqual({ enabled: true, credential_owner: 'reader' });
    const configured = createConfiguredLibbyRuntime({ configService, householdId: 'default', dataPath: scratch, factory });
    expect(configured.config).toEqual({ username: 'reader' });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ username: 'reader' }));

    write('household/media/libby.yml', 'enabled: false\ncredential_owner: reader\n');
    configService.reloadHouseholdAppConfig('default', 'libby');
    const disabledFactory = vi.fn();
    expect(createConfiguredLibbyRuntime({ configService, householdId: 'default', dataPath: scratch, factory: disabledFactory }))
      .toEqual({ config: null, runtime: null });
    expect(disabledFactory).not.toHaveBeenCalled();

    const absentRoot = mkdtempSync(path.join(tmpdir(), 'libby-config-absent-'));
    try {
      const target = path.join(absentRoot, 'household/household.yml');
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, 'name: Fixture\nusers: [reader]\n', 'utf8');
      const absentService = new ConfigService(loadConfig(absentRoot));
      const absentFactory = vi.fn();
      expect(createConfiguredLibbyRuntime({ configService: absentService, householdId: 'default', dataPath: absentRoot, factory: absentFactory }))
        .toEqual({ config: null, runtime: null });
      expect(absentFactory).not.toHaveBeenCalled();
    } finally {
      rmSync(absentRoot, { recursive: true, force: true });
    }
  });

  it('rejects enabled Libby configuration without a safe credential owner', () => {
    const base = { dataPath: '/data', factory: vi.fn() };
    for (const credential_owner of [undefined, '../reader', '.', '..', true, 123]) {
      const value = { enabled: true, credential_owner };
      expect(() => createConfiguredLibbyRuntime({ ...base, configService: { getHouseholdAppConfig: () => value } }))
        .toThrow('credential_owner');
    }
  });

  it('uses the same strict owner validation in direct runtime construction', () => {
    for (const username of ['.', '..', true, 123]) {
      expect(() => createLibbyRuntime({ dataPath: '/data', username, fetch: vi.fn() })).toThrow('valid username');
    }
    const runtime = createLibbyRuntime({ dataPath: '/data', username: 'reader.one', fetch: vi.fn() });
    expect(runtime.credentialPath).toBe(path.join('/data', 'users', 'reader.one', 'auth', 'libby.yml'));
    expect(runtime.credentialPath.startsWith(path.join('/data', 'users', 'reader.one') + path.sep)).toBe(true);
    runtime.leases.dispose();
  });
  let scratch;
  afterEach(() => { if (scratch) { rmSync(scratch, { recursive: true, force: true }); scratch = null; } });
  it('composes browser fallback into opaque queue leases without passing account capabilities', async () => {
    const fetch = vi.fn(async (url) => {
      if (url.endsWith('/chip/sync')) return Response.json({ loans: [{ id: '2', cardId: '1', websiteId: '12',
        type: { id: 'audiobook' }, title: 'Composed Book', expireDate: '2099-10-01T00:00:00Z' }] });
      if (url.includes('/open/audiobook/')) return Response.json({ urls: { web: 'https://fixture.listen.libbyapp.com/book/' }, message: 'm=fixture-capability' });
      if (url === 'http://127.0.0.1:3333/v1/operations/libby.bootstrap-loan') return Response.json({
        title: 'Book', subtitle: 'Browser subtitle', author: 'Browser author', narrator: 'Narrator', duration: 60,
        parts: [{ key: 'part1-mp3', index: 0, title: 'Opening chapter', duration: 60, contentLength: 1200,
          mimeType: 'audio/mpeg', upstreamUrl: 'https://audioclips.cdn.overdrive.com/signed/part1', headers: {} }],
      });
      throw new Error('Unexpected fixture request');
    });
    const runtime = createLibbyRuntime({ dataPath: '/fixture-data', username: 'reader', fetch, browserBaseUrl: 'http://127.0.0.1:3333' });
    vi.spyOn(runtime.credentials, 'getSnapshot').mockReturnValue({ token: 'fixture-token' });
    try {
      const { registry } = createContentRegistry({ libby: { username: 'reader' } }, { libbyClient: runtime.client, libbyLeaseService: runtime.leases });
      const items = await registry.get('libby').resolvePlayables('loan/1/2');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ title: 'Opening chapter', duration: 60,
        metadata: { parentTitle: 'Composed Book', subtitle: 'Browser subtitle', author: 'Browser author', narrator: 'Narrator' } });
      expect(JSON.stringify(items)).not.toMatch(/listen\.libbyapp|audioclips\.cdn\.overdrive|fixture-token|fixture-capability|signed|upstreamUrl|headers/);
      expect(runtime.leases.resolve(items[0].mediaUrl.split('/').at(-1))).toMatchObject({ kind: 'found', lease: { part: { key: 'part1-mp3', headers: {} } } });
      const options = fetch.mock.calls[2][1];
      expect(Object.keys(JSON.parse(options.body)).sort()).toEqual(['message', 'operationId', 'webUrl']);
      expect(options.body).not.toMatch(/fixture-token|credential|auth|cardId|titleId/);
      expect(options.headers.Authorization).toBeUndefined();
    } finally { runtime.leases.dispose(); }
  });
  it('registers a loan as an ordered audio queue with same-origin artwork and book metadata', async () => {
    const fetch = async (url, options = {}) => {
      if (url === 'https://sentry.libbyapp.com/chip/sync') return Response.json({ loans: [{
        id: '3070848', cardId: '77089338', websiteId: '12', type: { id: 'audiobook' },
        title: 'Forensic History', subtitle: 'Crimes, Frauds, and Scandals',
        firstCreatorName: 'Fixture Author', expireDate: '2099-10-01T00:00:00Z',
        covers: { cover510Wide: { href: 'https://img3.od-cdn.com/fixture-cover.jpg' } },
      }] });
      if (url === 'https://sentry.libbyapp.com/open/audiobook/card/77089338/title/3070848?website_id=12') return Response.json({
        urls: { web: 'https://fixture.listen.libbyapp.com/book/', openbook: 'https://fixture.listen.libbyapp.com/openbook.json' },
      });
      if (url === 'https://fixture.listen.libbyapp.com/book/' && options.method === 'HEAD') return new Response(null, {
        headers: { 'set-cookie': 'session=fixture-private; Path=/; Secure' },
      });
      if (url === 'https://fixture.listen.libbyapp.com/openbook.json') return Response.json({
        creator: [{ role: 'narrator', name: 'Fixture Narrator' }],
        spine: [
          { path: 'part1.mp3', 'media-type': 'audio/mpeg', 'audio-duration': 61.5 },
          { path: 'part2.mp3', 'media-type': 'audio/mpeg', 'audio-duration': 42 },
        ],
      });
      throw new Error('Unexpected fixture request');
    };
    const runtime = createLibbyRuntime({ dataPath: '/fixture-data', username: 'reader', fetch });
    vi.spyOn(runtime.credentials, 'getSnapshot').mockReturnValue({ token: 'fixture-token' });
    const { registry } = createContentRegistry({ libby: { username: 'reader' } }, {
      libbyClient: runtime.client, libbyLeaseService: runtime.leases,
    });
    const items = await registry.get('libby').resolvePlayables('loan/77089338/3070848');
    expect(items).toHaveLength(2);
    expect(items.map(({ mediaType }) => mediaType)).toEqual(['audio', 'audio']);
    expect(items.map(({ thumbnail }) => thumbnail)).toEqual([
      '/api/v1/proxy/libby/cover/77089338/3070848', '/api/v1/proxy/libby/cover/77089338/3070848',
    ]);
    expect(items[0]).toMatchObject({
      title: 'Part 1', duration: 61.5,
      metadata: { parentTitle: 'Forensic History', subtitle: 'Crimes, Frauds, and Scandals', partIndex: 0, author: 'Fixture Author', narrator: 'Fixture Narrator' },
    });
    expect(items[1]).toMatchObject({ title: 'Part 2', duration: 42, metadata: { partIndex: 1 } });
    for (const item of items) {
      expect(item.mediaUrl).toMatch(/^\/api\/v1\/proxy\/libby\/stream\/[A-Za-z0-9_-]+$/);
      expect(runtime.leases.resolve(item.mediaUrl.split('/').at(-1)).kind).toBe('found');
    }
    expect(JSON.stringify(items)).not.toMatch(/listen\.libbyapp\.com|od-cdn\.com|Bearer |fixture-token|fixture-private/);
    scratch = mkdtempSync(path.join(tmpdir(), 'libby-queue-composition-'));
    const { routers } = createApiRouters({
      registry, mediaProgressMemory: { findProgress: async () => null, listSourceProgress: async () => [] },
      menuMemoryRepository: { load: () => ({}), save: () => undefined },
      dataPath: scratch, mediaBasePath: path.join(scratch, 'media'),
      configService: { getAppConfig: () => ({}), getHouseholdAppConfig: () => ({}), reloadHouseholdAppConfig: () => ({}), getStreamingProfiles: () => [] },
      logger: { child() { return this; }, debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    const app = express();
    app.use('/api/v1/queue', routers.queue);
    app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
    const result = await request(app).get('/api/v1/queue/libby/loan/77089338/3070848');
    expect(result.body.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ count: 2, totalDuration: 103.5 });
    expect(result.body.items).toMatchObject([
      { title: 'Part 1', mediaType: 'audio', duration: 61.5, thumbnail: '/api/v1/proxy/libby/cover/77089338/3070848',
        metadata: { parentTitle: 'Forensic History', subtitle: 'Crimes, Frauds, and Scandals', partIndex: 0, author: 'Fixture Author', narrator: 'Fixture Narrator' } },
      { title: 'Part 2', mediaType: 'audio', duration: 42, thumbnail: '/api/v1/proxy/libby/cover/77089338/3070848', metadata: { partIndex: 1 } },
    ]);
    for (const item of result.body.items) {
      expect(item.mediaUrl).toMatch(/^\/api\/v1\/proxy\/libby\/stream\/[A-Za-z0-9_-]+$/);
      expect(runtime.leases.resolve(item.mediaUrl.split('/').at(-1)).kind).toBe('found');
      expect(item.metadata).toMatchObject({
        parentTitle: 'Forensic History', subtitle: 'Crimes, Frauds, and Scandals',
        author: 'Fixture Author', narrator: 'Fixture Narrator',
      });
    }
    expect(JSON.stringify(result.body)).not.toMatch(/listen\.libbyapp\.com|od-cdn\.com|Bearer |fixture-token|fixture-private/);
  });

  it('threads the cover service through content API composition to the HTTP route', async () => {
    scratch = mkdtempSync(path.join(tmpdir(), 'libby-cover-composition-'));
    const { registry } = createContentRegistry({});
    const { routers } = createApiRouters({
      registry, mediaProgressMemory: { findProgress: async () => null },
      menuMemoryRepository: { load: () => ({}), save: () => undefined },
      dataPath: scratch, mediaBasePath: path.join(scratch, 'media'),
      configService: { getAppConfig: () => ({}), getHouseholdAppConfig: () => ({}), reloadHouseholdAppConfig: () => ({}), getStreamingProfiles: () => [] },
      libbyCoverService: { open: async () => ({ kind: 'opened', body: new Response('image').body, contentType: 'image/jpeg', cleanup: () => {} }) },
      logger: { child() { return this; }, debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
    });
    const app = express();
    app.use('/proxy', routers.proxy);
    const result = await request(app).get('/proxy/libby/cover/1/2');
    expect(result.status).toBe(200);
    expect(result.body).toEqual(Buffer.from('image'));
  });

  it('opens CDN artwork through the composed cover service without authorizing CDN audio', async () => {
    const loan = { id: '2', cardId: '1', websiteId: '12', type: { id: 'audiobook' }, covers: { cover510Wide: { href: 'https://img3.od-cdn.com/cover.jpg' } } };
    const fetch = vi.fn(async (url) => {
      if (url.endsWith('/chip/sync')) return Response.json({ loans: [loan] });
      if (url === 'https://img3.od-cdn.com/cover.jpg') return new Response('image', { headers: { 'content-type': 'image/jpeg' } });
      return Response.json({ urls: { web: 'https://img3.od-cdn.com/book/', openbook: 'https://img3.od-cdn.com/openbook.json' } });
    });
    const runtime = createLibbyRuntime({ dataPath: '/fixture-data', username: 'reader', fetch });
    vi.spyOn(runtime.credentials, 'getSnapshot').mockReturnValue({ token: 'fixture-token' });
    const opened = await runtime.coverService.open({ cardId: '1', titleId: '2' });
    expect(opened.kind).toBe('opened');
    expect(opened.contentType).toBe('image/jpeg');
    expect(await new Response(opened.body).text()).toBe('image');
    await opened.cleanup();
    await expect(runtime.client.openLoan({ cardId: '1', titleId: '2' })).rejects.toMatchObject({ code: 'LIBRARY_MEDIA_ORIGIN_REJECTED' });
  });

  it('shares one lease registry and uses the selected user credential file', () => {
    const runtime = createLibbyRuntime({
      dataPath: '/data',
      username: 'reader',
      fetch: vi.fn(),
      logger: { warn: vi.fn() },
    });

    expect(runtime.credentialPath).toBe(path.join('/data', 'users', 'reader', 'auth', 'libby.yml'));
    expect(runtime.client).toBeDefined();
    expect(runtime.leases).toBeDefined();
    expect(runtime.streamService).toBeDefined();
  });

  it('rejects unsafe user path segments', () => {
    expect(() => createLibbyRuntime({ dataPath: '/data', username: '../reader', fetch: vi.fn() }))
      .toThrow('valid username');
  });
});
