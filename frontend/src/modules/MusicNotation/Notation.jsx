import { AbcRenderer } from './renderers/AbcRenderer.jsx';
import { SvgStaffRenderer } from './renderers/SvgStaffRenderer.jsx';
import { MusicXmlRenderer } from './renderers/MusicXmlRenderer.jsx';

/**
 * Notation — renderer-selecting facade over the MusicNotation framework.
 *
 * One music model, pluggable renderers:
 *   - 'abc' → AbcRenderer (abcjs grand-staff; live chords)
 *   - 'svg' → SvgStaffRenderer (hand-rolled SVG; game target staves)
 *   - 'musicxml' → FUTURE (OSMD), for notation-driven lessons
 *
 * Props are forwarded to the chosen renderer (see each renderer for its API).
 *
 * @param {'abc'|'svg'|'musicxml'} renderer
 */
export function Notation({ renderer = 'abc', ...props }) {
  switch (renderer) {
    case 'svg':
      return <SvgStaffRenderer {...props} />;
    case 'abc':
      return <AbcRenderer {...props} />;
    case 'musicxml':
      return <MusicXmlRenderer {...props} />;
    default:
      return null;
  }
}

export default Notation;
