import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attributeAllowed, checkSvg, elementAllowed, MAX_POSTER_BYTES } from './svgSafety.mjs';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const w = (inner, attrs = '') => `<svg ${NS} ${XL}${attrs}>${inner}</svg>`;
const ESC = '\x1b';

/** What the poster serializer emits from an OSMD engraving (VexFlow SVGContext output). */
const OSMD_LIKE = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240" viewBox="0 0 1000 300" data-daylight-poster="generated">
  <rect x="0" y="0" width="1000" height="300" fill="#ffffff"/>
  <g>
    <g>
      <path stroke-width="1" fill="none" stroke="#000000" stroke-dasharray="none" d="M10 40L990 40"/>
      <g><path d="M 30 50 C 31 49 33 48 35 49 Z" fill="black" stroke="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/></g>
      <rect x="1" y="1" width="2" height="2" fill="black" fill-opacity="1" stroke-width="0.3" stroke="black"/>
      <text stroke-width="0.3" fill="black" stroke="none" stroke-dasharray="none" font-family="'Times New Roman', serif"
        font-size="12px" font-weight="normal" font-style="normal" x="12" y="30">1 &amp; 2 &#9837;</text>
      <g visibility="hidden" pointer-events="none"><path d="M0 0"/></g>
    </g>
  </g>
</svg>`;

const code = (text) => checkSvg(text).code ?? 'ok';

/** The review's "billion laughs" poster: each level a group of `fan` <use>s of the level below. */
function useBomb(levels, fan) {
  let s = `<svg ${NS} width="200" height="200"><defs><g id="a0"><path d="M0 0h1v1z"/></g>`;
  for (let k = 1; k <= levels; k += 1) s += `<g id="a${k}">${`<use href="#a${k - 1}"/>`.repeat(fan)}</g>`;
  return `${s}</defs><use href="#a${levels}"/></svg>`;
}

/** Every case from the security review's bypass harness: all must be refused. */
const BYPASSES = [
  ['<SCRIPT>', w('<SCRIPT>alert(1)</SCRIPT>')],
  ['<svg:script>', '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg:svg>'],
  ['<html:script> (xhtml ns prefix)', w('<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script>')],
  ['XLINK:HREF javascript', w('<a XLINK:HREF="javascript:alert(1)"><text>x</text></a>')],
  ['odd prefix q:href javascript', w('<a xmlns:q="http://www.w3.org/1999/xlink" q:href="javascript:alert(1)"><text>x</text></a>')],
  ['&#106;avascript: href', w('<a href="&#106;avascript:alert(1)"><text>x</text></a>')],
  ['newline inside attr name', w('<g on\nload="alert(1)"/>')],
  ['unquoted attr', w('<g onload=alert(1) />')],
  ['CDATA with <script', w('<g><![CDATA[<script>alert(1)</script>]]></g>')],
  ['comment then script', w('<!-- --><script>alert(1)</script>')],
  ['animate to=javascript:', w('<a href="#x"><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a>')],
  ['set to=javascript:', w('<a xlink:href="#x"><set attributeName="xlink:href" to="javascript:alert(1)"/><text>x</text></a>')],
  ['animate values=javascript:', w('<a href="#x"><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a>')],
  ['<a href=http>', w('<a href="https://evil.example/"><text>x</text></a>')],
  ['<use href=external.svg#x>', w('<use href="external.svg#x"/>')],
  ['<use href=data:image/svg+xml>', w('<use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"/>')],
  ['<image href=http>', w('<image href="http://evil.example/p.png"/>')],
  ['<image href=data:image/png>', w('<image href="data:image/png;base64,AAAA"/>')],
  ['<feImage href=http>', w('<filter id="f"><feImage href="http://evil.example/x"/></filter>')],
  ['style url(http)', w('<g style="background:url(http://evil.example/x)"/>')],
  ['style url( entity-encoded u', w('<g style="background:&#117;rl(http://evil.example/x)"/>')],
  ['fill url( entity-encoded (', w('<g fill="url&#40;http://evil.example/x#a)"/>')],
  ['style CSS-escaped u\\72l(', w('<g style="background:u\\72l(http://evil.example/x)"/>')],
  ['style image-set()', w('<g style="background-image:image-set(\'http://evil.example/x\' 1x)"/>')],
  ['style expression(', w('<g style="width:expression(alert(1))"/>')],
  ['xml:base', w('<g xml:base="http://evil.example/"><use href="#x"/></g>')],
  ['<iframe>', w('<iframe src="https://evil.example/"/>')],
  ['<embed>', w('<embed src="https://evil.example/x.swf"/>')],
  ['<object data>', w('<object data="https://evil.example/x"/>')],
  ['xhtml-ns root + iframe srcdoc', '<svg xmlns="http://www.w3.org/1999/xhtml"><iframe srcdoc="&lt;script&gt;alert(document.domain)&lt;/script&gt;"></iframe></svg>'],
  ['xhtml prefixed iframe srcdoc inside svg', w('<h:iframe xmlns:h="http://www.w3.org/1999/xhtml" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/>')],
  ['xhtml-ns root + img src http', '<svg xmlns="http://www.w3.org/1999/xhtml"><img src="https://evil.example/t.png"/></svg>'],
  ['xhtml-ns root + form action javascript', '<svg xmlns="http://www.w3.org/1999/xhtml"><form action="javascript:alert(1)"><button>go</button></form></svg>'],
  ['xhtml-ns root + meta refresh', '<svg xmlns="http://www.w3.org/1999/xhtml"><meta http-equiv="refresh" content="0;url=https://evil.example/"/></svg>'],
  ['<foreignObject>', w('<foreignObject><div/></foreignObject>')],
  ['<FOREIGNOBJECT>', w('<FOREIGNOBJECT/>')],
  ['<style>', w('<style>@import url(http://x)</style>')],
  ['DOCTYPE entity', `<!DOCTYPE svg [<!ENTITY x "y">]>${w('')}`],
  ['null byte in text', w('<text>a\u0000b</text>')],
  ['null byte inside tag name', w('<scr\u0000ipt>alert(1)</scr\u0000ipt>')],
  ['BOM prefix', `﻿${w('<g/>')}`],
  ['xml decl ISO-2022-JP + ESC trick', `<?xml version="1.0" encoding="ISO-2022-JP"?>${w(`<g>${ESC}$B<!--${ESC}(B<script>alert(1)</script>--></g>`)}`],
  ['xml decl UTF-16', `<?xml version="1.0" encoding="UTF-16"?>${w('<g/>')}`],
  ['ESC in text', w(`<text>a${ESC}b</text>`)],
  ['fullwidth onload', w('<g ｏnload="x"/>')],
  ['href leading space javascript', w('<a href=" javascript:alert(1)"><text>x</text></a>')],
  ['<a href="&#x23;x">', w('<a href="&#x23;x"><text>x</text></a>')],
  ['root <h:svg> in xhtml ns', '<h:svg xmlns:h="http://www.w3.org/1999/xhtml"><h:iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/></h:svg>'],
  ['<handler> (SVG Tiny ev)', w('<handler xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load">alert(1)</handler>')],
  ['animate onbegin', w('<animate onbegin="alert(1)"/>')],
  ['set attributeName=onmouseover', w('<rect><set attributeName="onmouseover" to="alert(1)"/></rect>')],
  ['animate to=data:text/html', w('<a href="#x"><animate attributeName="href" to="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E"/><text>x</text></a>')],
  ['too large', w('<g/>'.padEnd(310000, ' '))],
  ['7-level <use> bomb (10^7 paths from ~1 KB)', useBomb(7, 10)],
  ['<use> to a local id', w('<defs><g id="a"><path d="M0 0"/></g></defs><use href="#a"/>')],
  ['<symbol>', w('<symbol id="s"><path d="M0 0"/></symbol>')],
  ['clip-path reference', w('<defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><g clip-path="url(#c)"/>')],
];

describe('checkSvg: what passes', () => {
  it('accepts the shape the poster serializer emits', () => {
    assert.deepEqual(checkSvg(OSMD_LIKE), { ok: true });
  });

  it('accepts the review harness baseline', () => {
    assert.equal(code(w('<g><path d="M0 0L1 1"/><text font-family="Times New Roman">1</text></g>')), 'ok');
  });
});

describe('checkSvg: every bypass from the security review is refused', () => {
  for (const [name, text] of BYPASSES) {
    it(name, () => {
      const result = checkSvg(text);
      assert.equal(result.ok, false, `${name} was accepted`);
    });
  }
});

describe('checkSvg: specific codes', () => {
  it('requires an <svg> root in the SVG namespace', () => {
    assert.equal(code('<svg><g/></svg>'), 'namespace');
    assert.equal(code('<svg xmlns="http://www.w3.org/1999/xhtml"/>'), 'namespace');
    assert.equal(code('<html xmlns="http://www.w3.org/2000/svg"/>'), 'not-svg');
    assert.equal(code(''), 'not-svg');
    assert.equal(code(null), 'not-svg');
    assert.equal(code(w('<g>')), 'not-svg');
    assert.equal(code(w('<g></h>')), 'not-svg');
    assert.equal(code(`${w('')}<svg ${NS}/>`), 'not-svg');
  });

  it('refuses namespace declarations other than SVG and XLink, anywhere', () => {
    assert.equal(code(w('<g xmlns="http://www.w3.org/1999/xhtml"/>')), 'namespace');
    assert.equal(code(w('<g xmlns:xlink="http://evil.example/"/>')), 'namespace');
    assert.equal(code(w('<g xmlns:foo="http://www.w3.org/2000/svg"/>')), 'namespace');
  });

  it('refuses elements and attributes off the allow-list', () => {
    assert.equal(code(w('<script/>')), 'script');
    assert.equal(code(w('<foreignObject/>')), 'foreign-object');
    assert.equal(code(w('<image/>')), 'element');
    assert.equal(code(w('<a/>')), 'element');
    assert.equal(code(w('<animateTransform/>')), 'element');
    assert.equal(code(w('<svg:g/>')), 'element');
    assert.equal(code(w('<g onclick="x()"/>')), 'event-handler');
    assert.equal(code(w('<g style="fill:red"/>')), 'attribute');
    assert.equal(code(w('<g class="x"/>')), 'attribute');
    assert.equal(code(w('<g xml:space="preserve"/>')), 'attribute');
  });

  it('allows no references at all: no <use>, href or clip-path, no url()', () => {
    const bomb = useBomb(7, 10);
    assert.ok(bomb.length < 1600, `the bomb is ${bomb.length} bytes`);
    assert.equal(code(bomb), 'element');
    assert.equal(code(w('<use/>')), 'element');
    assert.equal(code(w('<symbol/>')), 'element');
    assert.equal(code(w('<clipPath/>')), 'element');
    assert.equal(code(w('<g href="#ok"/>')), 'attribute');
    assert.equal(code(w('<g xlink:href="#ok"/>')), 'attribute');
    assert.equal(code(w('<g clip-path="url(#c)"/>')), 'attribute');
    assert.equal(code(w('<g fill="url(#grad)"/>')), 'external-href');
    assert.equal(code(w('<g fill="URL(#grad)"/>')), 'external-href');
  });

  it('refuses character references in attribute values and unknown entities in text', () => {
    assert.equal(code(w('<g fill="&#98;lack"/>')), 'entity');
    assert.equal(code(w('<text>&nbsp;</text>')), 'entity');
    assert.equal(code(w('<text>&amp;&lt;&gt;&quot;&apos;&#9837;&#x266D;</text>')), 'ok');
    assert.equal(code(w('<text>a & b</text>')), 'entity');
  });

  it('refuses numeric references to characters the raw text may not hold', () => {
    for (const ref of ['&#0;', '&#x0;', '&#27;', '&#x1B;', '&#xFEFF;', '&#xFFFE;', '&#65535;', '&#xD800;', '&#xDFFF;', '&#x110000;', '&#9999999;']) {
      assert.equal(code(w(`<text>${ref}</text>`)), 'entity', ref);
    }
    for (const ref of ['&#9;', '&#10;', '&#13;', '&#32;', '&#x266D;', '&#x1D11E;']) {
      assert.equal(code(w(`<text>${ref}</text>`)), 'ok', ref);
    }
  });

  it('is UTF-8 text only: no declaration, BOM or control characters', () => {
    assert.equal(code(`<?xml version="1.0" encoding="UTF-8"?>${w('')}`), 'processing-instruction');
    assert.equal(code(`﻿${w('')}`), 'bad-char');
    assert.equal(code(w('<text>a\u0001b</text>')), 'bad-char');
    assert.equal(code(w('<text>a￾b</text>')), 'bad-char');
    assert.equal(code(w('<text>a\uD800b</text>')), 'bad-char');
    assert.equal(code(w('<text>tab\tnl\ncr\r 𝄞</text>')), 'ok');
  });

  it('refuses DOCTYPE, CDATA and comments', () => {
    assert.equal(code(`<!DOCTYPE svg>${w('')}`), 'doctype');
    assert.equal(code(w('<![CDATA[x]]>')), 'doctype');
    assert.equal(code(w('<!-- note -->')), 'doctype');
  });

  it('refuses anything over the size cap, in UTF-8 bytes', () => {
    assert.equal(code(w(`<path d="${'M0 0'.repeat(Math.ceil(MAX_POSTER_BYTES / 4))}"/>`)), 'too-large');
    assert.equal(code(w(`<text>${'é'.repeat(Math.ceil(MAX_POSTER_BYTES / 2) - 50)}</text>`)), 'too-large');
  });

  it('exposes the allow-lists the serializer strips to', () => {
    assert.equal(elementAllowed('path'), true);
    assert.equal(elementAllowed('image'), false);
    assert.equal(attributeAllowed('path', 'd', 'M0 0'), true);
    assert.equal(attributeAllowed('g', 'class', 'x'), false);
    assert.equal(attributeAllowed('use', 'href', '#a'), false);
    assert.equal(attributeAllowed('g', 'href', '#a'), false);
    assert.equal(elementAllowed('use'), false);
  });
});

describe('checkSvg: stays linear on hostile inputs at the size cap', () => {
  const fill = (unit, budget = MAX_POSTER_BYTES - 200) => unit.repeat(Math.floor(budget / unit.length));
  const hostile = {
    'open attribute quotes': `<svg ${NS}>${fill('<g a="')}`,
    'open comments': `<svg ${NS}>${fill('<!-')}`,
    'open tags': `<svg ${NS}>${fill('<g ')}`,
    'deep nesting': `<svg ${NS}>${fill('<g>')}`,
    'url( in one attribute': `<svg ${NS}><rect fill="${fill('url(#')}"/></svg>`,
    'url(#a) repeated': `<svg ${NS}><g clip-path="${fill('url(#a)')}"/></svg>`,
    'open CDATA': `<svg ${NS}>${fill('<![CDATA[')}`,
    'stray close tags': `<svg ${NS}>${fill('</')}`,
    'whitespace': fill(' '),
    'many attributes': `<svg ${NS}><g ${Array.from({ length: 20000 }, (_, i) => `a${i}="1"`).join(' ')}/></svg>`,
    'unterminated comment': `<svg ${NS}><!--${'-'.repeat(290000)}`,
    'attributes without end': `<svg${' a="1"'.repeat(48000)}`,
    'long name': `<svg${'x'.repeat(299000)}>`,
    'balanced nesting 40k': `<svg ${NS}>${'<g>'.repeat(30000)}${'</g>'.repeat(30000)}</svg>`,
    'entities in text': `<svg ${NS}><text>${fill('&amp;')}</text></svg>`,
  };
  for (const [name, text] of Object.entries(hostile)) {
    it(name, () => {
      const t0 = performance.now();
      checkSvg(text);
      const ms = performance.now() - t0;
      assert.ok(ms < 100, `${name} took ${ms.toFixed(1)} ms`);
    });
  }
});
