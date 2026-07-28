# School math rendering spike — results

**Date:** 2026-07-27
**Question (architecture spec §11, delivery item 1):** can the pure-JS stack
(MathJax → SVG → svg-to-pdfkit → pdfkit) produce print-grade vector math for the
School document system?

**Verdict: PASS.** TeX-quality glyphs, pure vector (zero embedded raster images,
verified with `pdfimages -list`), crisp at 300dpi, on the full roadmap §4.1 stress
corpus: nested fractions, radicals, 3×3 matrices, long expressions, inequalities,
trig, long-division (`\enclose{longdiv}`), multi-line `aligned`, mixed numbers with
text labels, summation with limits, small inline sizes.

Stack: `mathjax-full@^3.2.2` (TeX input + SVG output, `fontCache: 'none'`,
`AllPackages`), `svg-to-pdfkit@^0.1.8`, `pdfkit@^0.18.0` — the last two already
repo dependencies; only `mathjax-full` is new.

> **Updated 2026-07-27 during implementation (B2).** Three corrections found
> while productionizing this recipe — a fourth mandatory rule, and two places
> where the reference implementation below is subtly wrong. Read
> "Corrections from implementation" before copying any code from this document.

## Three preprocessing rules (all required)

svg-to-pdfkit misinterprets MathJax's SVG as emitted. The document renderer MUST
apply these to every MathJax SVG before `SVGtoPDF()`:

1. **Size from the viewBox, never the width/height attributes.** MathJax emits
   `width="8.221ex"`; svg-to-pdfkit misparses `ex` units and then *ignores* the
   `options.width/height` overrides, drawing ~1.4× too large. Strip both
   attributes and compute pt dimensions from the viewBox — MathJax uses **1000
   viewBox units per em**, so `widthPt = vbW / 1000 * fontSizePt`. Verified
   pixel-exact at 150dpi against a drawn reference box.
2. **Promote inline `style="stroke-width: N;"` to a `stroke-width="N"`
   attribute.** menclose notations (long division's vinculum/paren) carry their
   stroke width as inline CSS while inheriting `stroke-width="0"` from the parent
   group's attribute; svg-to-pdfkit honors only attributes, so the enclosure
   strokes at width 0 — silently invisible.
3. **Replace `currentColor` with the actual ink color.** svg-to-pdfkit does not
   resolve `currentColor`; stroked (fill="none") paths vanish without it. Glyph
   paths survive only because fill has different fallback behavior.

Reference implementation (spike-verified):

```javascript
function texToSvg(texSrc, { display = true, fontSizePt = 12, ink = '#000000' } = {}) {
  const node = mjDocument.convert(texSrc, { display });
  const svgNode = node.children[0];
  const [, , vbW, vbH] = adaptor.getAttribute(svgNode, 'viewBox').split(/\s+/).map(Number);
  const widthPt = (vbW / 1000) * fontSizePt;
  const heightPt = (vbH / 1000) * fontSizePt;
  const svgString = adaptor.outerHTML(svgNode)
    .replace(/ width="[^"]+"/, '')
    .replace(/ height="[^"]+"/, '')
    .replace(/style="stroke-width:\s*([\d.]+);?"/g, 'stroke-width="$1"')
    .replace(/currentColor/g, ink);
  return { svgString, widthPt, heightPt };
}
// place with: SVGtoPDF(doc, svgString, x, y, { width: widthPt, height: heightPt, assumePt: true })
```

## Corrections from implementation (2026-07-27)

The live implementation is `backend/src/1_rendering/school/documents/mathSvg.mjs`;
where it differs from this document, **it is right and this document was wrong**.

### 4. Drop the `noundefined` TeX extension — this is a fourth mandatory rule

Under stock `AllPackages`, bad TeX does **not** reliably produce an error node.
Only *syntax* errors (`\frac{`) emit `merror` / `data-mjx-error`. An **undefined
control sequence** — a macro typo, or `\require{...}` itself, the single most
likely authoring mistake — is swallowed by the `noundefined` extension and
rendered as **red literal text** (`<g data-mml-node="mtext" fill="red">`).

That is exactly the "red error text printed on a child's worksheet" failure this
module exists to prevent, and error-node detection alone does not catch it. The
fix is to build the TeX input with `AllPackages.filter(p => p !== 'noundefined')`,
after which undefined macros emit `data-mjx-error` and the renderer throws.

**Any other code in this repo that constructs its own MathJax document must
apply the same filter**, or it will silently print red glyphs instead of failing.

A defensive check for the red-text signature is retained in case that config
ever drifts back. It does not false-positive on legitimate `\color{red}{…}` /
`\textcolor{red}{…}`, because MathJax puts the colour on the `mstyle` node
rather than on `mtext`.

Note this also makes the §"`\require` never works server-side" claim above
*enforceable*: before the filter, `\require{enclose} x` rendered as red text
rather than throwing.

### 5. Strip width/height from the ROOT tag only

The reference implementation's `.replace(/ width="[^"]+"/, '')` is fragile.
`\overline`, `\overrightarrow`, and extensible delimiters emit **nested `<svg>`
elements carrying their own `width`/`height`/`viewBox`/`x`/`y` in viewBox units**.
Those must survive — stripping globally collapses the stretchy rules. Confine
the strip to the root element.

### 6. Parse the style attribute per-declaration

Rule 2's stroke-width promotion is narrower than described: only
`\enclose{longdiv}` uses inline CSS. `\cancel` and `\enclose{circle}` already
emit `stroke-width` as a proper attribute. Promote by parsing individual
declarations rather than regex-matching the whole attribute value, so a future
`style="stroke-width: N; fill: none;"` still promotes correctly.

### Still unverified (carry into the PDF renderer work)

- svg-to-pdfkit's handling of the **nested `<svg>` viewport** (own viewBox plus
  x/y offset) used by stretchy accents. The spike's visual pass covered radicals
  and matrices; `\overline` / `\overrightarrow` specifically were not in it.
- The WinAnsi-only limitation of pdfkit's base-14 fonts (below) still applies to
  document themes.

## Other findings

- **Baseline/depth:** the viewBox's negative y-origin encodes depth below the
  baseline (`depthPt = (vbY + vbH) / 1000 * fontSizePt`). The layout engine needs
  this for baseline-aligned inline math; the spike only top-aligned.
- **`\require{...}` never works server-side** — it is a browser lazy-loader
  macro. `enclose` (and everything else needed so far) is already in
  `AllPackages`; author TeX without `\require`.
- **Measured sizes are trustworthy for layout.** After rule 1, reserved box ==
  drawn extent exactly, so the measure-then-place two-pass design in the
  architecture spec (§4) is buildable on these numbers. The earlier ex-based
  sizing caused both the overlap and phantom-overflow bugs in spike round 1 —
  exactly the class of defect the golden page tests must pin.
- **pdfkit base-14 fonts are WinAnsi-only** — a `→` in a Helvetica label prints
  as a substitute glyph. Document themes must register TTFs (the thermal
  renderers already bundle Roboto Condensed) before using any non-ASCII text.
- Spike artifacts (script, stress PDF, calibration probes) lived in the session
  scratchpad (`mathspike/`); this document + the recipe above are the durable
  record.

## Consequence for the architecture spec

Delivery item 1's rendering-spike gate is satisfied. The document system can
proceed on the pure-JS stack (decision A3) with `mathjax-full` added as a backend
dependency and the three rules above implemented as a dedicated, unit-tested
SVG-normalization step in `1_rendering/school/`.
