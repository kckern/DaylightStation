import { describe, it, expect } from 'vitest';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';

/**
 * A printed QR is machine-read hardware, and the golden pixel gate cannot see
 * it: adding the symbol at all moved 0.33% of a Letter page, under the suite's
 * 0.5% tolerance, so every snapshot passed both with and without a scannable
 * code. These assertions are the gate for that — the same role `formMap` plays
 * for bubbles.
 */
const withAction = (over = {}) => ({
  id: 'code-doc', seed: 1, target: ['letter'],
  blocks: [
    { type: 'rich_text', md: 'Do the work, then scan below.' },
    { type: 'scan_action', action: 'recovery', label: 'Scan for another copy' },
  ],
  ...over,
});

const render = (doc, opts) => createDocumentPdfRenderer({}).render(doc, opts);

describe('codeMap: printed codes are reported, not just drawn', () => {
  it('reports one entry per scan_action with the token that was printed', async () => {
    const out = await render(withAction(), { tokens: { recovery: 'sch:ABC123' } });
    expect(out.codeMap).toHaveLength(1);
    expect(out.codeMap[0].text).toBe('sch:ABC123');
  });

  it('reports a real QR symbol, not a reserved box', async () => {
    const [code] = (await render(withAction(), { tokens: { recovery: 'sch:ABC123' } })).codeMap;
    // A QR version 1 is 21 modules square; anything smaller is not a symbol.
    expect(code.moduleCount).toBeGreaterThanOrEqual(21);
    // Roughly half of a QR's modules are dark. Zero means an empty box drawn
    // where a code belongs — the exact defect this file exists to catch.
    expect(code.darkModules).toBeGreaterThan(code.moduleCount * 2);
    expect(code.sizePt).toBeGreaterThan(0);
  });

  it('places the code inside the printable page', async () => {
    const [code] = (await render(withAction(), { tokens: { recovery: 'sch:ABC123' } })).codeMap;
    expect(code.xPt).toBeGreaterThan(0);
    expect(code.yPt).toBeGreaterThan(0);
    expect(code.xPt + code.sizePt).toBeLessThanOrEqual(612);
    expect(code.yPt + code.sizePt).toBeLessThanOrEqual(792);
    expect(code.page).toBe(1);
  });

  it('encodes different tokens differently', async () => {
    const a = (await render(withAction(), { tokens: { recovery: 'sch:AAAA1111' } })).codeMap[0];
    const b = (await render(withAction(), { tokens: { recovery: 'sch:BBBB2222' } })).codeMap[0];
    expect(a.text).not.toBe(b.text);
    expect(a.darkModules).not.toBe(b.darkModules);
  });

  it('is empty for a document with no scannable ticket', async () => {
    const plain = { id: 'plain', seed: 1, target: ['letter'], blocks: [{ type: 'rich_text', md: 'No code here.' }] };
    expect((await render(plain)).codeMap).toEqual([]);
  });
});
