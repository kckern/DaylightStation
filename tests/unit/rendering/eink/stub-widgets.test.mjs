import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { render } from '#rendering/eink/index.mjs';
import { registerBuiltins } from '#rendering/eink/widgets/builtins.mjs';
import * as registry from '#rendering/eink/widgets/registry.mjs';

// Real font files live in the repo so the canvas can register the base face.
const FONT_DIR = path.resolve('backend/assets/fonts');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // \x89PNG

describe('eink canned widgets', () => {
  it('registers the skeleton stub widgets as builtins', () => {
    registerBuiltins();
    for (const name of ['date', 'calendar', 'schedule', 'todos']) {
      expect(registry.has(name)).toBe(true);
    }
  });

  it('renders a YAML-style layout of stub widgets to a PNG', async () => {
    // A column layout exercising the layout manager + each canned renderable.
    const layout = {
      direction: 'column',
      gap: 12,
      padding: 16,
      children: [
        { widget: 'header', basis: 120, props: { title: 'Kitchen' } },
        {
          direction: 'row',
          gap: 12,
          grow: 1,
          children: [
            { widget: 'date', grow: 1 },
            { widget: 'calendar', grow: 1 },
          ],
        },
        {
          direction: 'row',
          gap: 12,
          grow: 1,
          children: [
            { widget: 'schedule', grow: 1 },
            { widget: 'todos', grow: 1 },
          ],
        },
      ],
    };

    // No data sources — stubs fall back to sample content.
    const png = await render(
      { width: 800, height: 600, layout, data: {} },
      { fontDir: FONT_DIR, dataOverride: {} },
    );

    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.length).toBeGreaterThan(1000);
    expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  });

  it('falls back to the placeholder for an unknown widget name', async () => {
    const layout = { children: [{ widget: 'does-not-exist' }] };
    const png = await render(
      { width: 400, height: 200, layout, data: {} },
      { fontDir: FONT_DIR, dataOverride: {} },
    );
    expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
  });

  // PNG colour-type byte lives at offset 25 (IHDR data starts at 16: w,h,bitdepth,
  // then colortype at 25). 0 = grayscale, 2 = RGB, 6 = RGBA.
  const colorType = (png) => png[25];

  it('emits an 8-bit GRAYSCALE PNG by default (mono panels)', async () => {
    const layout = { children: [{ widget: 'date', grow: 1 }] };
    const png = await render(
      { width: 400, height: 200, layout, data: {} },
      { fontDir: FONT_DIR, dataOverride: {} },
    );
    expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    expect(png[24]).toBe(8);          // bit depth 8
    expect(colorType(png)).toBe(0);   // grayscale
  });

  it('emits a 24-bit RGB PNG (no alpha) when grayscale:false (Spectra-6 panels)', async () => {
    const layout = { children: [{ widget: 'date', grow: 1 }] };
    const png = await render(
      { width: 400, height: 200, layout, data: {} },
      { fontDir: FONT_DIR, dataOverride: {}, grayscale: false },
    );
    expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    expect(png[24]).toBe(8);          // bit depth 8
    // colour-type 2 = truecolour RGB. We drop the alpha plane the firmware ignores
    // (it dithers RGB on-device), keeping the chroma a colour panel needs.
    expect(colorType(png)).toBe(2);
  });
});
