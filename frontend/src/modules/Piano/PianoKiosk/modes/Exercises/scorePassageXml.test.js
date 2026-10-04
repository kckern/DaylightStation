import { describe, expect, it } from 'vitest';
import { excerptMusicXml } from './scorePassageXml.js';

const measures = (count, { labels = [], prefix = '' } = {}) => Array.from({ length: count }, (_, index) => `
  <measure number="${labels[index] ?? index + 1}">
    ${index === 0 ? `${prefix}<attributes><divisions>4</divisions><key><fifths>1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef><transpose><chromatic>2</chromatic></transpose></attributes><direction><sound tempo="96"/></direction>` : ''}
    ${index === 1 ? '<attributes><key><fifths>-1</fifths></key></attributes><direction><sound tempo="84"/></direction>' : ''}
    ${index === 2 ? '<print new-system="yes" new-page="yes"/>' : ''}
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
  </measure>`).join('');

const score = ({ count = 8, labels = [] } = {}) => `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Upper</part-name></score-part><score-part id="P2"><part-name>Lower</part-name></score-part></part-list>
  <part id="P1">${measures(count, { labels })}</part>
  <part id="P2">${measures(count, { labels })}</part>
</score-partwise>`;

const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const directMeasures = (part) => [...part.children].filter((node) => node.localName === 'measure');

describe('excerptMusicXml', () => {
  it('extracts exactly five canonical bars from every part and preserves their printed labels', () => {
    const result = excerptMusicXml(score({ labels: ['X', '9', '10', '11', '12', '13', '14', '15'] }), { start: 2, end: 6 });
    const document = parse(result.musicXml);

    expect([...document.getElementsByTagName('part')].map((part) => directMeasures(part).map((measure) => measure.getAttribute('number'))))
      .toEqual([['10', '11', '12', '13', '14'], ['10', '11', '12', '13', '14']]);
    expect(result.originalMeasureIndices).toEqual([2, 3, 4, 5, 6]);
  });

  it('carries effective notation attributes and tempo into a mid-piece excerpt', () => {
    const result = excerptMusicXml(score(), { start: 2, end: 3 });
    const first = directMeasures(parse(result.musicXml).getElementsByTagName('part')[0])[0];
    const attributes = first.querySelector('attributes');

    expect(attributes.querySelector('divisions')?.textContent).toBe('4');
    expect(attributes.querySelector('key fifths')?.textContent).toBe('-1');
    expect(attributes.querySelector('time beats')?.textContent).toBe('3');
    expect(attributes.querySelector('staves')?.textContent).toBe('2');
    expect([...attributes.querySelectorAll('clef')].map((clef) => clef.getAttribute('number'))).toEqual(['1', '2']);
    expect(attributes.querySelector('transpose chromatic')?.textContent).toBe('2');
    expect(first.querySelector('direction sound')?.getAttribute('tempo')).toBe('84');
    expect(result.inheritedTempoMap).toEqual([{ onsetQuarter: 0, bpm: 84 }]);
  });

  it('removes full-score system and page breaks from selected measures', () => {
    const result = excerptMusicXml(score(), { start: 2, end: 3 });
    const print = parse(result.musicXml).querySelector('print');
    expect(print?.hasAttribute('new-system')).toBe(false);
    expect(print?.hasAttribute('new-page')).toBe(false);
  });

  it('returns explicit invalid and empty answers instead of engraving unrelated music', () => {
    expect(excerptMusicXml('<score-partwise><broken>', { start: 0, end: 1 })).toEqual({
      musicXml: null, originalMeasureIndices: [], inheritedTempoMap: [], error: 'invalid-xml',
    });
    expect(excerptMusicXml(score({ count: 2 }), { start: 4, end: 6 })).toEqual({
      musicXml: null, originalMeasureIndices: [], inheritedTempoMap: [], error: 'passage-empty',
    });
  });
});
