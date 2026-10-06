import { describe, expect, it } from 'vitest';
import { excerptMusicXml, selectMusicXmlParts } from './scorePassageXml.js';

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
    expect(first.querySelector('direction-type metronome per-minute')?.textContent).toBe('84');
    expect(result.inheritedTempoMap).toEqual([{ onsetQuarter: 0, bpm: 84 }]);
  });

  it('removes full-score system and page breaks from selected measures', () => {
    const result = excerptMusicXml(score(), { start: 2, end: 3 });
    const print = parse(result.musicXml).querySelector('print');
    expect(print?.hasAttribute('new-system')).toBe(false);
    expect(print?.hasAttribute('new-page')).toBe(false);
  });

  it('adds one lab-owned system break to the same local bar in every part', () => {
    const result = excerptMusicXml(score({ count: 6 }), { start: 0, end: 4 }, { systemBreakBefore: 3 });
    const document = parse(result.musicXml);
    const breaks = [...document.querySelectorAll('part')].map((part) => directMeasures(part)
      .map((measure, index) => measure.querySelector('print')?.getAttribute('new-system') === 'yes' ? index : null)
      .filter((index) => index != null));

    expect(breaks).toEqual([[3], [3]]);
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

describe('selectMusicXmlParts', () => {
  const grandStaff = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><clef number="1"><sign>G</sign></clef><clef number="2"><sign>F</sign></clef></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><staff>1</staff></note><backup><duration>1</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><staff>2</staff></note></measure></part></score-partwise>`;

  it.each([
    [['rh'], '5'],
    [['lh'], '3'],
  ])('engraves only %j and remaps it onto one visible staff', (parts, octave) => {
    const document = parse(selectMusicXmlParts(grandStaff, parts).musicXml);
    expect([...document.querySelectorAll('note pitch octave')].map((node) => node.textContent)).toEqual([octave]);
    expect([...document.querySelectorAll('note staff')].map((node) => node.textContent)).toEqual(['1']);
    expect(document.querySelector('staves')?.textContent).toBe('1');
    expect([...document.querySelectorAll('clef')]).toHaveLength(1);
  });

  it('retains both staves for together work', () => {
    const document = parse(selectMusicXmlParts(grandStaff, ['rh', 'lh']).musicXml);
    expect([...document.querySelectorAll('note staff')].map((node) => node.textContent)).toEqual(['1', '2']);
    expect(document.querySelector('staves')?.textContent).toBe('2');
  });

  it('preserves cursor movements that place multiple voices on a retained staff', () => {
    const polyphonic = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note><backup><duration>2</duration></backup><note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>2</voice><staff>1</staff></note><forward><duration>1</duration></forward><note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>3</voice><staff>2</staff></note></measure></part></score-partwise>`;
    const document = parse(selectMusicXmlParts(polyphonic, ['rh']).musicXml);
    expect([...document.querySelectorAll('note voice')].map((node) => node.textContent)).toEqual(['1', '2']);
    expect(document.querySelector('backup duration')?.textContent).toBe('2');
    expect(document.querySelector('forward duration')?.textContent).toBe('1');
  });

  it('retains an explicitly selected third part and removes the other part definitions', () => {
    const threeParts = `<?xml version="1.0"?><score-partwise><part-list>${[1, 2, 3].map((n) => `<score-part id="P${n}"><part-name>P${n}</part-name></score-part>`).join('')}</part-list>${[1, 2, 3].map((n) => `<part id="P${n}"><measure number="1"><note><pitch><step>C</step><octave>${n + 2}</octave></pitch><duration>1</duration></note></measure></part>`).join('')}</score-partwise>`;
    const document = parse(selectMusicXmlParts(threeParts, ['p3']).musicXml);
    expect([...document.querySelectorAll('part')].map((part) => part.getAttribute('id'))).toEqual(['P3']);
    expect([...document.querySelectorAll('score-part')].map((part) => part.getAttribute('id'))).toEqual(['P3']);
  });
});
