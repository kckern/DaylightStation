import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Beam, StaveNote, Stave, Voice, Formatter, Renderer } from 'vexflow';

const OUT = '/private/tmp/claude-501/-Users-kckern-Documents-GitHub-DaylightStation/67f45ad7-1e4c-4ce1-ba26-bc42d45ba89e/scratchpad/probe.txt';

describe('probe beam directly', () => {
  it('minimal beam', () => {
    const out = [];
    const host = document.createElement('div');
    const renderer = new Renderer(host, Renderer.Backends.SVG);
    renderer.resize(500, 300);
    const ctx = renderer.getContext();
    const stave = new Stave(10, 40, 400);
    stave.setContext(ctx).draw();
    const notes = [
      new StaveNote({ keys: ['c/4'], duration: '8', clef: 'treble', auto_stem: true }),
      new StaveNote({ keys: ['e/4'], duration: '8', clef: 'treble', auto_stem: true }),
    ];
    const voice = new Voice({ num_beats: 2, beat_value: 4 }).setStrict(false).addTickables(notes);
    new Formatter().joinVoices([voice]).format([voice], 350);
    let beam;
    try { beam = new Beam(notes, true); out.push('ctor OK'); }
    catch (e) { out.push('ctor THREW: ' + e.message); }
    voice.draw(ctx, stave);
    try { beam.setContext(ctx).draw(); out.push('draw OK'); }
    catch (e) { out.push('draw THREW: ' + e.message + '\n' + e.stack); }
    out.push('beams in dom: ' + host.querySelectorAll('.vf-beam').length);
    out.push('classes: ' + [...new Set([...host.querySelectorAll('[class]')].map(e => e.getAttribute('class')))].join(' | '));
    writeFileSync(OUT, out.join('\n'));
  });
});
