import { describe, it, expect } from '@jest/globals';
import { ReportReceiptRenderer } from '#rendering/newsreporter/ReportReceiptRenderer.mjs';

const r = new ReportReceiptRenderer();

describe('ReportReceiptRenderer', () => {
  it('maps heading + lines to print items', () => {
    const job = r.render(
      [{ type: 'heading', text: 'WC' }, { type: 'lines', lines: ['BRA 2-1 ARG'] }],
      { header: 'WORLD CUP', divider: true, footer: 'daylight', autoCut: true }
    );
    expect(job.items[0]).toMatchObject({ type: 'text', content: 'WORLD CUP', align: 'center' });
    expect(job.items.some(i => i.type === 'line')).toBe(true);
    expect(job.items.some(i => i.content === 'BRA 2-1 ARG')).toBe(true);
    expect(job.footer.autoCut).toBe(true);
  });

  it('header item is bold and double-size, centered', () => {
    const job = r.render([], { header: 'NEWS' });
    expect(job.items[0]).toMatchObject({
      type: 'text',
      content: 'NEWS',
      align: 'center',
      size: { width: 2, height: 2 },
      style: { bold: true },
    });
  });

  it('heading sections are bold centered text', () => {
    const job = r.render([{ type: 'heading', text: 'SCORES' }], {});
    const item = job.items.find(i => i.content === 'SCORES');
    expect(item).toMatchObject({ type: 'text', align: 'center', style: { bold: true } });
  });

  it('note sections are centered text', () => {
    const job = r.render([{ type: 'note', text: 'no games today' }], {});
    expect(job.items.find(i => i.content === 'no games today'))
      .toMatchObject({ type: 'text', align: 'center' });
  });

  it('table sections pre-expand into text rows containing the cells', () => {
    const job = r.render(
      [{ type: 'table', headers: ['Team', 'Pts'], rows: [['BRA', '9'], ['ARG', '6']] }],
      {}
    );
    const textItems = job.items.filter(i => i.type === 'text');
    expect(textItems.some(i => i.content.includes('Team'))).toBe(true);
    expect(textItems.some(i => i.content.includes('BRA'))).toBe(true);
    expect(textItems.some(i => i.content.includes('ARG'))).toBe(true);
  });

  it('footer text renders centered when provided', () => {
    const job = r.render([], { footer: 'daylight station' });
    expect(job.items.find(i => i.content === 'daylight station'))
      .toMatchObject({ type: 'text', align: 'center' });
  });

  it('autoCut defaults to true and respects explicit false', () => {
    expect(r.render([], {}).footer.autoCut).toBe(true);
    expect(r.render([], { autoCut: false }).footer.autoCut).toBe(false);
  });

  it('empty sections + empty template yield a minimal job', () => {
    const job = r.render([], {});
    expect(Array.isArray(job.items)).toBe(true);
    expect(job.footer).toMatchObject({ autoCut: true });
    expect(typeof job.footer.paddingLines).toBe('number');
  });

  it('renderText returns a readable plain-text approximation', () => {
    const text = r.renderText(
      [{ type: 'heading', text: 'SCORES' }, { type: 'lines', lines: ['BRA 2-1 ARG'] }],
      { header: 'WORLD CUP', footer: 'daylight' }
    );
    expect(typeof text).toBe('string');
    expect(text).toContain('WORLD CUP');
    expect(text).toContain('SCORES');
    expect(text).toContain('BRA 2-1 ARG');
    expect(text).toContain('daylight');
  });
});
