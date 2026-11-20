import { describe, it, expect } from 'vitest';
import { checkSvg } from '../../portable/music/svgSafety.mjs';
import { posterCrop, posterSvg, POSTER_MARKER_ATTR } from './posterSvg.js';

/**
 * An OSMD-shaped engraving at zoom 0.5: width/height in px, viewBox in unscaled
 * units (twice the px), three systems of two staves, one staffline group each.
 */
function engraving() {
  const host = document.createElement('div');
  const staff = (system, staffNo) => `
    <g class="staffline" id="Piano1-${staffNo}">
      <g class="vf-measure" id="${system + 1}">
        <path stroke-width="1" fill="none" stroke="#000000" stroke-dasharray="none" d="M20 ${system * 300 + staffNo * 100}L1580 ${system * 300 + staffNo * 100}"/>
        <g class="vf-stavenote" id="vf-auto${system}${staffNo}" pointer-events="bounding-box">
          <path stroke-width="0.3" fill="black" stroke="none" font="10pt Arial" d="M30 ${system * 300 + 40} C 31 39 33 38 35 39 Z" onclick="steal()"/>
        </g>
      </g>
    </g>`;
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 1600 900"
      id="osmdSvgPage1" style="width: 800px; height: 450px">
    <defs><clipPath id="page"><rect x="0" y="0" width="1600" height="900"/></clipPath><linearGradient id="ink"><stop offset="0"/></linearGradient></defs>
    <!-- engraved by OSMD -->
    <text stroke-width="0.3" fill="black" stroke="none" stroke-dasharray="none" font-family='"Times New Roman",&#10;serif' font-size="10pt"
      font-weight="normal" font-style="normal" x="10" y="20" class="vf-measure-number">1 &amp; 2</text>
    <g clip-path="url(#page)" style="fill: red" transform="translate(1,&#9;2)"><use href="#page"/><rect fill="url(#ink)" fill-opacity="0.5" x="0" y="0" width="1" height="1"/></g>
    <a href="https://evil.example/"><text>link</text></a>
    <animate attributeName="href" to="javascript:alert(1)"/>
    ${[0, 1, 2].flatMap((s) => [staff(s, 0), staff(s, 1)]).join('')}
    <script>alert(1)</script>
    <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
    <image href="https://evil.example/a.png" width="1" height="1"/>
  </svg>`;
  return host.querySelector('svg');
}

/** extractPerStaffGeometry's shape for the engraving above, in rendered px. */
const boxes = [0, 1, 2].flatMap((system) => [0, 1].map((staff) => ({
  system, staff, top: system * 150 + staff * 50, left: 10, right: 790, lineSpacing: 5,
})));

describe('posterCrop', () => {
  it('keeps the first systems and cuts halfway to the next one', () => {
    // system 1 bottom staff: top 200 + 4*5 = 220; system 2 top: 300 → 260
    expect(posterCrop(boxes, { systems: 2 })).toEqual({ stafflines: 4, bottom: 260 });
  });

  it('keeps the full height when the score is that short', () => {
    expect(posterCrop(boxes, { systems: 3 })).toEqual({ stafflines: 6, bottom: null });
    expect(posterCrop([], {})).toEqual({ stafflines: null, bottom: null });
  });
});

describe('posterSvg', () => {
  it('keeps the first systems, crops the viewBox in unscaled units and stamps the marker', () => {
    const svg = engraving();
    const { text, bytes, width, height } = posterSvg(svg, posterCrop(boxes, { systems: 2 }));
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    expect(root.getAttribute('width')).toBe('800');
    expect(root.getAttribute('height')).toBe('260');
    expect(root.getAttribute('viewBox')).toBe('0 0 1600 520');
    expect(root.getAttribute(POSTER_MARKER_ATTR)).toBe('generated');
    expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('style')).toBeNull();
    expect(root.querySelectorAll('g.staffline, g[id^="Piano"]')).toHaveLength(0); // classes and ids stripped
    expect(root.querySelectorAll('path')).toHaveLength(8); // 4 staves × 2 paths
    // VexFlow presentation attributes survive; class, unreferenced ids, font, onclick do not.
    const glyph = root.querySelectorAll('path')[1];
    expect(glyph.getAttribute('stroke-width')).toBe('0.3');
    expect(glyph.getAttribute('font')).toBeNull();
    expect(glyph.getAttribute('onclick')).toBeNull();
    expect(root.firstElementChild.localName).toBe('rect');
    expect(root.firstElementChild.getAttribute('fill')).toBe('#ffffff');
    expect({ width, height }).toEqual({ width: 800, height: 260 });
    expect(bytes).toBe(new TextEncoder().encode(text).length);
    // The engraving on screen is untouched.
    expect(svg.querySelectorAll('g.staffline')).toHaveLength(6);
    expect(svg.getAttribute('viewBox')).toBe('0 0 1600 900');
  });

  it('strips everything off the allow-list, keeping referenced ids, and passes checkSvg', () => {
    const { text } = posterSvg(engraving(), posterCrop(boxes));
    for (const banned of ['<script', 'foreignObject', 'onclick', 'evil.example', 'osmdSvgPage1', '<image', '<a ', '<a>', '<animate',
      'linearGradient', 'url(#ink)', ' style=', '<!--', ' class=', ' font=']) {
      expect(text, banned).not.toContain(banned);
    }
    for (const banned of ['clipPath', 'clip-path', '<use', 'href', ' id=', '&quot;', '&#10;', '&#9;', '&#xA;', '&#x9;']) {
      expect(text, banned).not.toContain(banned);
    }
    // Whitespace characters become spaces and the font list loses its quotes.
    expect(text).toContain('font-family="Times New Roman, serif"');
    expect(text).toContain('transform="translate(1, 2)"');
    expect(text).toContain('1 &amp; 2'); // the BEL is gone, the entity kept
    expect(checkSvg(text)).toEqual({ ok: true });
  });

  it('drops lone surrogates and control characters from text, keeping real pairs', () => {
    const svg = engraving();
    svg.querySelector('text').textContent = 'a\uD800b\uDC00c\u0001d\uD834\uDD1E';
    const { text } = posterSvg(svg, posterCrop(boxes));
    expect(text).toContain('>abcd\uD834\uDD1E</text>');
    expect(checkSvg(text)).toEqual({ ok: true });
  });

  it('keeps the full engraving when there is nothing to cut', () => {
    const { text } = posterSvg(engraving(), { stafflines: null, bottom: null });
    const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    expect(root.getAttribute('viewBox')).toBe('0 0 1600 900');
    expect(root.querySelectorAll('path')).toHaveLength(12);
  });

  it('refuses an oversized poster and a missing svg', () => {
    expect(() => posterSvg(engraving(), { maxBytes: 200 })).toThrow(expect.objectContaining({ code: 'too-large' }));
    expect(() => posterSvg(null)).toThrow(expect.objectContaining({ code: 'no-svg' }));
    expect(() => posterSvg(document.createElement('div'))).toThrow(expect.objectContaining({ code: 'no-svg' }));
  });
});
