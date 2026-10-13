import { describe, it, expect } from '@jest/globals';
import { createSourceRegistry } from "../../../../../__app_modules/media/newsreporter/server/adapters/sources/sourceRegistry.mjs";
import { createSinkRegistry } from "../../../../../__app_modules/media/newsreporter/server/application/sinks/sinkRegistry.mjs";
import { HttpSourceAdapter } from "../../../../../__app_modules/media/newsreporter/server/adapters/sources/HttpSourceAdapter.mjs";
import { PrinterSink } from "../../../../../__app_modules/media/newsreporter/server/application/sinks/PrinterSink.mjs";
import { isSource } from "../../../../../__app_modules/media/newsreporter/server/application/ports/ISource.mjs";
import { isSink } from "../../../../../__app_modules/media/newsreporter/server/application/ports/ISink.mjs";

const fakeHttpClient = { get: async () => ({ status: 200, ok: true, data: [] }) };
const nullLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

describe('createSourceRegistry', () => {
  it('creates an HttpSourceAdapter for type "http"', () => {
    const registry = createSourceRegistry({ httpClient: fakeHttpClient, logger: nullLogger });
    const source = registry.create('http', { id: 's', url: 'http://x' });
    expect(source).toBeInstanceOf(HttpSourceAdapter);
    expect(isSource(source)).toBe(true);
  });

  it.each(['rss', 'harvester', 'agent'])('creates a stub ISource for type "%s"', (type) => {
    const registry = createSourceRegistry({ httpClient: fakeHttpClient, logger: nullLogger });
    const source = registry.create(type, { id: 's' });
    expect(isSource(source)).toBe(true);
  });

  it.each(['rss', 'harvester', 'agent'])('stub "%s" source throws "not implemented" on gather', async (type) => {
    const registry = createSourceRegistry({ httpClient: fakeHttpClient, logger: nullLogger });
    const source = registry.create(type, { id: 's' });
    await expect(source.gather({})).rejects.toThrow(/not implemented/i);
  });

  it('throws on an unknown source type', () => {
    const registry = createSourceRegistry({ httpClient: fakeHttpClient, logger: nullLogger });
    expect(() => registry.create('bogus', {})).toThrow(/unknown.*source type|source type.*bogus/i);
  });
});

describe('createSinkRegistry', () => {
  const renderer = { render: () => ({ items: [] }), renderText: () => '' };
  const printerRegistry = { resolve: () => ({ print: async () => true }) };

  it('creates a PrinterSink for type "printer"', () => {
    const registry = createSinkRegistry({ renderer, printerRegistry, logger: nullLogger });
    const sink = registry.create('printer', {});
    expect(sink).toBeInstanceOf(PrinterSink);
    expect(isSink(sink)).toBe(true);
  });

  it('throws on an unknown sink type', () => {
    const registry = createSinkRegistry({ renderer, printerRegistry, logger: nullLogger });
    expect(() => registry.create('bogus', {})).toThrow(/unknown.*sink type|sink type.*bogus/i);
  });
});
