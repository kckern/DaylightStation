import { describe, it, expect } from 'vitest';
import {
  braceSpan, angleSpan, variableDefs, looksLikeMusic, hasAudibleContent, isSpacerTrack,
  splitScores, staffMap, movementHint, tempoOf, buildCanonical, normalize,
} from './normalize.mjs';

// The three staff shapes that actually occur in the Mutopia corpus. Every test
// below is derived from a real file, not invented syntax.
const BURGMULLER = `\\version "2.18.2"
\\include "nederlands.ly"
\\header { title = "La Candeur" }
Global =  {\\key c\\major \\time 4/4}
vOne =  \\relative c''' {
  \\repeat volta 2 { g8-5_\\p ( e-3 d  c) g' ( e d  c) }
}
vTwo =  \\relative c'' { s1 s s s \\stemDown r8 es ( d  c) s1 s }
vThree =  \\relative c { c4 e g e }
\\score { {
\\context PianoStaff <<
  \\set PianoStaff.instrumentName = \\markup{\\large "1. "}
  \\context Staff = "up" <<
    \\Global \\clef treble
    \\context Voice=VoiceI \\vOne
    \\context Voice=VoiceII \\vTwo
  >>
  \\context Staff = "down" <<
    \\Global \\clef bass
    \\context Voice=VoiceIII \\vThree
  >>
>>
}
\\layout {}
  \\midi { \\tempo 4 = 152 }
}`;

// Clementi: bare variable reference after the Staff declaration, and THREE
// \score blocks in one \book — i.e. three movements in one file.
const CLEMENTI = `\\version "2.18.2"
upperfirst = \\relative c'' { \\clef treble \\key c \\major \\time 2/2 c4^\\markup {Spiritoso} e8 c g4 g }
lowerfirst = \\relative c { \\clef bass \\key c \\major \\time 2/2 c4 r r2 }
uppersecond = \\relative c'' { \\clef treble c2^\\markup {Andante} f4 }
lowersecond = \\relative c { \\clef bass f2 a4 }
\\book {
    \\score {
       \\new PianoStaff <<
          \\new Staff = "upper" \\upperfirst
          \\new Staff = "lower" \\lowerfirst >>
  \\midi { \\tempo 4 = 156 }
    \\layout { }}
   \\score {
       \\new PianoStaff <<
          \\new Staff = "upper" \\uppersecond
          \\new Staff = "lower" \\lowersecond
       >>
  \\midi { \\tempo 4 = 92 }
        \\layout { }}
        }`;

describe('braceSpan / angleSpan', () => {
  it('finds the matching close brace across nesting', () => {
    const s = 'x = { a { b } c } tail';
    const span = braceSpan(s, 3);
    expect(s.slice(span.open, span.close + 1)).toBe('{ a { b } c }');
  });

  it('returns null when braces are unbalanced rather than throwing', () => {
    expect(braceSpan('{ a { b }')).toBeNull();
  });

  it('finds the matching >> across nesting', () => {
    const s = '<< a << b >> c >>';
    const span = angleSpan(s);
    expect(s.slice(span.open, span.close + 1)).toBe(s);
  });
});

describe('variableDefs', () => {
  it('collects top-level music and settings variables', () => {
    const defs = variableDefs(BURGMULLER);
    expect([...defs.keys()].sort()).toEqual(['Global', 'vOne', 'vThree', 'vTwo']);
    expect(defs.get('Global')).toBe('{\\key c\\major \\time 4/4}');
  });

  it('ignores in-score assignments like \\set PianoStaff.instrumentName', () => {
    expect(variableDefs(BURGMULLER).has('instrumentName')).toBe(false);
  });
});

describe('looksLikeMusic', () => {
  it('is true for note bodies and false for settings blocks', () => {
    expect(looksLikeMusic('{\\key c\\major \\time 4/4}')).toBe(false);
    expect(looksLikeMusic("\\relative c { c4 e g }")).toBe(true);
  });

  it('counts spacer rests and chords as music', () => {
    expect(looksLikeMusic('\\relative c\'\' { s1 s s }')).toBe(true);
    expect(looksLikeMusic('\\relative c { <c e g>4 }')).toBe(true);
  });
});

describe('hasAudibleContent / isSpacerTrack', () => {
  it('separates a dynamics track from a voice that merely rests a lot', () => {
    // Schumann's dynamics variable: invisible skips carrying only marks.
    expect(isSpacerTrack('{ s2\\f s2*3 s1\\p }')).toBe(true);
    // Burgmüller's vTwo: pages of spacers, then a real bar. Still a voice.
    expect(isSpacerTrack("\\relative c'' { s1 s s s r8 es ( d c) }")).toBe(false);
  });

  it('treats audible rests as content but bare spacers as not', () => {
    expect(hasAudibleContent('{ r4 r8 }')).toBe(true);
    expect(hasAudibleContent('{ s1 s2 }')).toBe(false);
  });

  it('does not call a settings block a spacer track', () => {
    expect(isSpacerTrack('{\\key c\\major \\time 4/4}')).toBe(false);
  });
});

describe('splitScores', () => {
  it('returns one entry per \\score, so a \\book yields one per movement', () => {
    expect(splitScores(CLEMENTI)).toHaveLength(2);
    expect(splitScores(BURGMULLER)).toHaveLength(1);
  });

  it('tags which output blocks each score carries', () => {
    const [first] = splitScores(CLEMENTI);
    expect(first.hasLayout).toBe(true);
    expect(first.hasMidi).toBe(true);
    const midiOnly = splitScores('\\score { \\new Staff { c4 } \\midi {} }');
    expect(midiOnly[0]).toMatchObject({ hasLayout: false, hasMidi: true });
  });
});

describe('staffMap', () => {
  it('reads \\context Staff << >> with multiple voices', () => {
    const defs = variableDefs(BURGMULLER);
    const map = staffMap(splitScores(BURGMULLER)[0].body, defs);
    expect(map).toHaveLength(2);
    expect(map[0].clef).toBe('treble');
    expect(map[0].vars).toEqual(['Global', 'vOne', 'vTwo']);
    expect(map[1].clef).toBe('bass');
    expect(map[1].vars).toEqual(['Global', 'vThree']);
  });

  it('reads a bare variable reference after \\new Staff = "upper"', () => {
    const defs = variableDefs(CLEMENTI);
    const map = staffMap(splitScores(CLEMENTI)[0].body, defs);
    expect(map).toHaveLength(2);
    expect(map[0].vars).toEqual(['upperfirst']);
    expect(map[1].vars).toEqual(['lowerfirst']);
  });

  it('drops references that are LilyPond commands, not defined variables', () => {
    const defs = variableDefs(BURGMULLER);
    const map = staffMap(splitScores(BURGMULLER)[0].body, defs);
    expect(map.flatMap((s) => s.vars)).not.toContain('clef');
    expect(map.flatMap((s) => s.vars)).not.toContain('set');
  });
});

describe('movementHint / tempoOf', () => {
  it('lifts a movement name out of the first markup', () => {
    expect(movementHint("c4^\\markup {Spiritoso} e8")).toBe('Spiritoso');
  });

  it('ignores markup that is only an engraving directive', () => {
    expect(movementHint('c4_\\markup{\\italic "cresc."}')).toBeNull();
  });

  it('reads the midi tempo', () => {
    expect(tempoOf('\\midi { \\tempo 4 = 152 }')).toEqual({ unit: 4, bpm: 152 });
    expect(tempoOf('no tempo here')).toBeNull();
  });
});

describe('buildCanonical', () => {
  it('synthesizes a two-staff PianoStaff from the \\context shape', () => {
    const defs = variableDefs(BURGMULLER);
    const built = buildCanonical(BURGMULLER, splitScores(BURGMULLER)[0].body, defs, {});
    expect(built.staves).toBe(2);
    expect(built.ly).toContain('\\new PianoStaff');
    expect(built.ly).toContain('\\clef treble');
    expect(built.ly).toContain('\\clef bass');
  });

  it('emits settings sequentially and parallel voices with \\\\', () => {
    const defs = variableDefs(BURGMULLER);
    const { ly } = buildCanonical(BURGMULLER, splitScores(BURGMULLER)[0].body, defs, {});
    // Global leads the staff; the two treble voices are parallel.
    expect(ly).toMatch(/\\new Staff \{ \\clef treble \\Global << \\vOne \\\\ \\vTwo >> \}/);
    // The single bass voice must NOT be wrapped in a parallel group.
    expect(ly).toMatch(/\\new Staff \{ \\clef bass \\Global \\vThree \}/);
  });

  it('carries only the variables the score actually references', () => {
    const defs = variableDefs(CLEMENTI);
    const { ly } = buildCanonical(CLEMENTI, splitScores(CLEMENTI)[0].body, defs, {});
    expect(ly).toContain('upperfirst =');
    expect(ly).not.toContain('uppersecond =');
  });

  it('refuses a staff that resolved to no music rather than emitting a stub', () => {
    const src = 'Global = {\\key c\\major}\n\\score { \\new PianoStaff << \\new Staff { \\Global } >> }';
    const defs = variableDefs(src);
    expect(buildCanonical(src, splitScores(src)[0].body, defs, {})).toBeNull();
  });
});

describe('normalize', () => {
  it('returns one canonical document per movement, with hints and tempo', () => {
    const out = normalize(CLEMENTI);
    expect(out).toHaveLength(2);
    expect(out[0].hint).toBe('Spiritoso');
    expect(out[0].tempo).toEqual({ unit: 4, bpm: 156 });
    expect(out[1].hint).toBe('Andante');
    expect(out[1].tempo).toEqual({ unit: 4, bpm: 92 });
  });

  it('collapses the \\layout + \\midi twin-score idiom into ONE movement', () => {
    // Mutopia's Schumann files typeset the same music twice: once under
    // \layout, once under \midi. Both must not become movements.
    const twin = `${CLEMENTI.slice(0, CLEMENTI.indexOf('\\book'))}
\\score { \\new PianoStaff << \\new Staff = "u" \\upperfirst \\new Staff = "l" \\lowerfirst >> \\layout {} }
\\score { \\new PianoStaff << \\new Staff = "u" \\upperfirst \\new Staff = "l" \\lowerfirst >> \\midi { \\tempo 4 = 60 } }`;
    const out = normalize(twin);
    expect(out).toHaveLength(1);
  });

  it('drops the MIDI twin even when it references EXTRA tracks', () => {
    // The real Schumann shape: the \midi score also pulls in the dynamics
    // track, so its variable signature differs and signature-dedupe alone
    // would not catch it. The layout/midi tagging is what does.
    const src = `\\version "2.18.2"
upper = \\relative c'' { c4 d e f }
lower = \\relative c { c2 g }
dynamics = { s2\\f s2 }
\\score { \\context PianoStaff <<
  \\context Staff=upper \\upper
  \\context Dynamics=dynamics \\dynamics
  \\context Staff=lower << \\clef bass \\lower >>
>> \\layout {} }
\\score { \\unfoldRepeats \\context PianoStaff <<
  \\context Staff=upper \\upper \\dynamics
  \\context Staff=lower << \\lower \\dynamics >>
>> \\midi {} }`;
    const out = normalize(src);
    expect(out).toHaveLength(1);
    // …and the dynamics track must not have become a phantom voice.
    expect(out[0].voices).toBe(2);
    expect(out[0].ly).not.toContain('\\dynamics');
  });

  it('keeps genuine movements, which draw on different variables', () => {
    expect(normalize(CLEMENTI).map((m) => m.signature))
      .toEqual(['upperfirst|lowerfirst', 'uppersecond|lowersecond']);
  });

  it('produces a grand staff for the multi-voice \\context shape', () => {
    const out = normalize(BURGMULLER);
    expect(out).toHaveLength(1);
    expect(out[0].staves).toBe(2);
    expect(out[0].voices).toBe(3); // vOne + vTwo on top, vThree below
  });
});
