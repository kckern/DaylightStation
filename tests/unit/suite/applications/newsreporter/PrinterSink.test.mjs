import { describe, it, expect } from '@jest/globals';
import { PrinterSink } from '#apps/newsreporter/sinks/PrinterSink.mjs';
import { isSink } from '#apps/newsreporter/ports/ISink.mjs';

const fakeRenderer = () => ({
  renderCalls: [],
  textCalls: [],
  render(sections, template, ctx) { this.renderCalls.push({ sections, template, ctx }); return { items: ['JOB'], footer: {} }; },
  renderText(sections, template, ctx) { this.textCalls.push({ sections, template, ctx }); return 'PREVIEW_TEXT'; },
});

const fakeRegistry = (printResult, capture = {}) => ({
  resolveCalls: capture.resolveCalls = [],
  printCalls: capture.printCalls = [],
  resolve(name) {
    this.resolveCalls.push(name);
    const printCalls = this.printCalls;
    return { print: async (job) => { printCalls.push(job); return printResult; } };
  },
});

const captureLogger = () => {
  const events = [];
  return { events, info: (e, d) => events.push({ e, d }), debug: () => {}, warn: () => {}, error: () => {} };
};

const sections = [{ type: 'heading', text: 'X' }];
const cfg = { template: { header: 'H' }, printer: 'thermal-1' };

describe('PrinterSink', () => {
  it('is a valid ISink', () => {
    const sink = new PrinterSink({ renderer: fakeRenderer(), printerRegistry: fakeRegistry(true), logger: captureLogger() });
    expect(isSink(sink)).toBe(true);
  });

  it('renders, prints, and returns ok on success', async () => {
    const renderer = fakeRenderer();
    const registry = fakeRegistry(true);
    const logger = captureLogger();
    const sink = new PrinterSink({ renderer, printerRegistry: registry, logger });
    const result = await sink.emit(sections, cfg, {});
    expect(result).toEqual({ status: 'ok' });
    expect(registry.resolveCalls).toEqual(['thermal-1']);
    expect(registry.printCalls).toEqual([{ items: ['JOB'], footer: {} }]);
    expect(renderer.renderCalls).toHaveLength(1);
    const log = logger.events.find(({ e }) => e === 'newsreporter.sink.emit');
    expect(log.d).toMatchObject({ type: 'printer', printer: 'thermal-1', status: 'ok' });
  });

  it('returns error when print resolves false', async () => {
    const logger = captureLogger();
    const sink = new PrinterSink({ renderer: fakeRenderer(), printerRegistry: fakeRegistry(false), logger });
    const result = await sink.emit(sections, cfg, {});
    expect(result).toEqual({ status: 'error' });
    expect(logger.events.find(({ e }) => e === 'newsreporter.sink.emit').d).toMatchObject({ status: 'error' });
  });

  it('does NOT print on dryRun and returns the text preview', async () => {
    const renderer = fakeRenderer();
    const registry = fakeRegistry(true);
    const sink = new PrinterSink({ renderer, printerRegistry: registry, logger: captureLogger() });
    const result = await sink.emit(sections, cfg, { dryRun: true });
    expect(result).toEqual({ status: 'ok', detail: { preview: 'PREVIEW_TEXT' } });
    expect(registry.printCalls).toHaveLength(0);
    expect(registry.resolveCalls).toHaveLength(0);
    expect(renderer.textCalls).toHaveLength(1);
  });

  it('uses ctx.printerOverride over cfg.printer when resolving', async () => {
    const registry = fakeRegistry(true);
    const sink = new PrinterSink({ renderer: fakeRenderer(), printerRegistry: registry, logger: captureLogger() });
    await sink.emit(sections, cfg, { printerOverride: 'override-printer' });
    expect(registry.resolveCalls).toEqual(['override-printer']);
  });

  it('propagates a resolve() throw (misconfig)', async () => {
    const registry = { resolve() { throw new Error('no such printer'); } };
    const sink = new PrinterSink({ renderer: fakeRenderer(), printerRegistry: registry, logger: captureLogger() });
    await expect(sink.emit(sections, cfg, {})).rejects.toThrow(/no such printer/);
  });
});
