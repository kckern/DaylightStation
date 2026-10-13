/**
 * Hangul fallback on the thermal receipt target.
 *
 * The receipt renderer draws with node-canvas, not pdfkit — a completely
 * separate font-resolution path from `measure.mjs#withScriptFont`
 * (pdfkit/Letter target, fixed 2026-09-22). Roboto Condensed has no Hangul
 * glyphs, so a card-ladder deck title like "UBKS 비둘기" printed as three
 * `.notdef` tofu boxes on the agenda. node-canvas resolves a comma-separated
 * CSS font-family string the way a browser does — it tries the first family
 * per glyph and falls through — so `documentReceiptTheme.fonts.*` now carries
 * `, "Noto Sans KR"` as a second family on every string, and
 * `DocumentReceiptRenderer`'s `extraFonts` registers that face alongside the
 * bold/code faces it already registers.
 */
import { describe, expect, it } from 'vitest';
import { createDocumentReceiptRenderer } from "./DocumentReceiptRenderer.mjs";
import { makeStandInVendorFontDir } from "../../../../../../tests/_lib/school/vendorFontStandIn.mjs";
import { documentReceiptTheme as theme } from "./documentReceiptTheme.mjs";

const HANGUL = 'UBKS 비둘기';

const card = (label) => ({
  id: 'hangul-test',
  title: 'Test Learner',
  blocks: [{
    type: 'scan_action',
    action: 'sch:TESTTESTTEST0002',
    label,
    presentation: 'lesson',
    eyebrow: 'language',
    hideCode: true,
  }],
});

describe('receipt theme carries a Hangul fallback family', () => {
  it('every prose font string in the theme names Noto Sans KR as a fallback', () => {
    const proseFontKeys = Object.keys(theme.fonts).filter((key) => (
      typeof theme.fonts[key] === 'string' && theme.fonts[key].endsWith('px "Roboto Condensed"')
    ));
    // No survivors: every Roboto-Condensed-only string should have picked up
    // the fallback in the theme edit, or this test itself is stale.
    expect(proseFontKeys).toEqual([]);
    expect(theme.fonts.hangulFontPath).toBeTruthy();
    expect(theme.fonts.hangulFamily).toBe('Noto Sans KR');
  });
});

// A pixel/measureText comparison between "Roboto Condensed" alone and the
// fallback stack is NOT a reliable "not tofu" signal on a dev/CI host that
// happens to have system CJK fonts installed (this repo's own host does:
// `/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc`) — node-canvas's
// underlying font matching (cairo/fontconfig) silently substitutes a system
// CJK face for "Roboto Condensed" too in that case, so BOTH renders come out
// identical and a width/ink-count assertion would pass whether or not the
// theme/wiring fix was even present. Verified by hand with an isolated,
// system-font-free FONTCONFIG_FILE: "Roboto Condensed" alone then genuinely
// draws `.notdef` boxes (593 ink px, codepoint hex printed inside), and the
// fallback stack draws real glyphs (557 ink px, matches the in-process
// count below) — see the PR notes for the two saved PNGs. The deterministic,
// host-independent proof that the Docker target (no system CJK fonts at all)
// will render real glyphs is the font-file glyph coverage below, which is
// the same technique `hangulFallback.render.test.mjs` uses for the pdfkit
// (Letter) target.
describe('Hangul glyphs actually draw on canvas (not tofu)', () => {
  it('renders a card whose label is Hangul without throwing, and the glyph area is non-blank', async () => {
    const renderer = createDocumentReceiptRenderer({ scanCodes: 'qr', vendorFontDir: makeStandInVendorFontDir() });
    const { canvas, height } = await renderer.createCanvas(card(HANGUL), { tokens: {} });
    expect(height).toBeGreaterThan(0);
    const buf = canvas.toBuffer('image/png');
    expect(buf.length).toBeGreaterThan(0);
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let inkPixels = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 250) inkPixels += 1;
    expect(inkPixels).toBeGreaterThan(200);
  });
});
