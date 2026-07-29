// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createCellRenderers } from './cellRenderers.mjs';

describe('cell renderers', () => {
  const rect = { x: 0, y: 0, w: 108, h: 108 };

  it('qr renderer embeds the item code and its label', async () => {
    const { qr } = createCellRenderers();
    const svg = await qr({ code: 'dl:4', label: 'Mixed' }, rect, {});
    expect(svg).toContain('<svg');
    expect(svg).toContain('Mixed');
  });

  it('label renderer produces text with no QR payload', async () => {
    const { label } = createCellRenderers();
    const svg = await label({ code: 'rs:clear', label: 'Reset' }, rect, {});
    expect(svg).toContain('Reset');
    expect(svg).not.toContain('<rect'); // no QR modules
  });

  it('an unknown kind is absent so the caller can fail loudly', () => {
    const renderers = createCellRenderers();
    expect(renderers.definitely_not_a_kind).toBeUndefined();
  });

  it('label renderer escapes markup so a stray & or < cannot break the SVG', async () => {
    const { label } = createCellRenderers();
    const svg = await label({ code: 'x', label: 'Salt & <Pepper>' }, rect, {});
    expect(svg).toContain('Salt &amp; &lt;Pepper&gt;');
    // Single-pass escaping: the ampersand we introduce must not be escaped again.
    expect(svg).not.toContain('&amp;amp;');
  });

  it('qr renderer uses the injected QR renderer, passing the code as the payload', async () => {
    const calls = [];
    const fake = {
      renderSvg(data, options) {
        calls.push({ data, options });
        return '<svg data-fake="1"></svg>';
      },
    };
    const { qr } = createCellRenderers({ qrRenderer: fake });

    const svg = await qr({ code: 'ct:bowl-lg', label: 'Big bowl', sublabel: '212 g' }, rect, {});

    expect(svg).toBe('<svg data-fake="1"></svg>');
    expect(calls).toHaveLength(1);
    expect(calls[0].data).toBe('ct:bowl-lg');
    expect(calls[0].options).toMatchObject({ label: 'Big bowl', sublabel: '212 g' });
    // Covers are opt-in; without opts.cover no image data may reach the QR renderer.
    expect(calls[0].options.coverData).toBeFalsy();
  });
});
