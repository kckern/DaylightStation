import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkSvg, MAX_POSTER_BYTES } from './svgSafety.mjs';

const wrap = (body, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs} width="800" height="240" viewBox="0 0 1000 300">${body}</svg>`;

/** The shape OSMD/VexFlow emits: nested groups, glyph paths, rects, a little text. */
const OSMD_LIKE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="240" viewBox="0 0 1000 300" data-daylight-poster="generated">
  <rect x="0" y="0" width="1000" height="300" fill="#fff"/>
  <!-- staff -->
  <g class="staffline">
    <g class="vf-measure">
      <path stroke-width="1" fill="none" stroke="#000000" d="M10 40L990 40"/>
      <g class="vf-stavenote"><path d="M 30 50 C 31 49 33 48 35 49 Z" fill="black"/></g>
      <text font-family="Times New Roman" font-size="12px" x="12" y="30">1</text>
      <use href="#glyph1" x="4"/>
      <rect x="1" y="1" width="2" height="2" fill="url(#grad)" style="fill: url( '#grad' )"/>
      <image href="data:image/png;base64,AAAA" width="1" height="1"/>
    </g>
  </g>
</svg>
`;

const code = (text) => checkSvg(text).code ?? 'ok';

describe('checkSvg', () => {
  it('accepts an OSMD-like engraving', () => {
    assert.deepEqual(checkSvg(OSMD_LIKE), { ok: true });
  });

  it('accepts a minimal svg with a leading BOM', () => {
    assert.equal(code(`﻿${wrap('<g/>')}`), 'ok');
  });

  it('rejects text that is not an svg document', () => {
    assert.equal(code(''), 'not-svg');
    assert.equal(code(null), 'not-svg');
    assert.equal(code('<html><body/></html>'), 'not-svg');
    assert.equal(code('hello'), 'not-svg');
    assert.equal(code(wrap('<g>')), 'not-svg'); // unclosed
    assert.equal(code(wrap('<g></h>')), 'not-svg'); // mismatched
    assert.equal(code(`${wrap('')}<svg/>`), 'not-svg'); // two roots
    assert.equal(code(`${wrap('')}trailing`), 'not-svg');
    assert.equal(code(wrap('<path d=unquoted/>')), 'not-svg');
    assert.equal(code(wrap('<path d="a"fill="b"/>')), 'not-svg');
    assert.equal(code(wrap('<path d="a<b"/>')), 'not-svg');
    assert.equal(code(wrap('<!-- open')), 'not-svg');
  });

  it('rejects script elements, any case or prefix', () => {
    assert.equal(code(wrap('<script>alert(1)</script>')), 'script');
    assert.equal(code(wrap('<SCRIPT/>')), 'script');
    assert.equal(code(wrap('<svg:script/>')), 'script');
  });

  it('rejects foreignObject', () => {
    assert.equal(code(wrap('<foreignObject><div/></foreignObject>')), 'foreign-object');
  });

  it('rejects style elements', () => {
    assert.equal(code(wrap('<style>@import url(http://x/a.css);</style>')), 'style');
  });

  it('rejects on* attributes on any element, the root included', () => {
    assert.equal(code(wrap('<g onclick="x()"/>')), 'event-handler');
    assert.equal(code(wrap('<g ONLOAD=\'x()\'/>')), 'event-handler');
    assert.equal(code(wrap('', ' onload="x()"')), 'event-handler');
  });

  it('rejects hrefs that leave the document', () => {
    assert.equal(code(wrap('<use href="http://evil/x.svg#a"/>')), 'external-href');
    assert.equal(code(wrap('<use xlink:href="javascript:alert(1)"/>')), 'external-href');
    assert.equal(code(wrap('<a href=" //evil"/>')), 'external-href');
    assert.equal(code(wrap('<image href="data:text/html,<b>"/>')), 'not-svg'); // < in value
    assert.equal(code(wrap('<image href="data:text/html,x"/>')), 'external-href');
    assert.equal(code(wrap('<rect fill="url(http://evil/p.svg#a)"/>')), 'external-href');
    assert.equal(code(wrap('<rect style="fill:url(#ok);stroke:url(evil.svg)"/>')), 'external-href');
  });

  it('rejects DOCTYPE, ENTITY and processing instructions', () => {
    assert.equal(code(`<!DOCTYPE svg [<!ENTITY a "b">]>${wrap('')}`), 'doctype');
    assert.equal(code(wrap('<!ENTITY a "b">')), 'doctype');
    assert.equal(code(`<?xml-stylesheet href="http://x/a.css"?>${wrap('')}`), 'processing-instruction');
    assert.equal(code(wrap('<?php echo 1 ?>')), 'processing-instruction');
  });

  it('rejects anything over the size cap', () => {
    const pad = 'M0 0'.repeat(Math.ceil(MAX_POSTER_BYTES / 4));
    assert.equal(code(wrap(`<path d="${pad}"/>`)), 'too-large');
    // Multi-byte text counts in UTF-8 bytes, not characters.
    const wide = 'é'.repeat(Math.ceil(MAX_POSTER_BYTES / 2) - 50);
    assert.equal(code(wrap(`<text>${wide}</text>`)), 'too-large');
  });

  it('stays linear on hostile inputs at the size cap', () => {
    const fill = (unit, budget = MAX_POSTER_BYTES - 200) => unit.repeat(Math.floor(budget / unit.length));
    const hostile = [
      `<svg>${fill('<g a="')}`,
      `<svg>${fill('<!-')}`,
      `<svg>${fill('<g ')}`,
      `<svg>${fill('<g>')}`,
      `<svg><rect fill="${fill('url(#')}"/></svg>`,
      `<svg>${fill('<g x="url(#a)url(#a)" y=\'1\'>')}`,
      `<svg>${fill('<![CDATA[')}`,
      `<svg>${fill('</')}`,
      fill(' '),
    ];
    for (const text of hostile) {
      const t0 = performance.now();
      checkSvg(text);
      const ms = performance.now() - t0;
      assert.ok(ms < 100, `${text.slice(0, 20)}… took ${ms.toFixed(1)} ms`);
    }
  });
});
