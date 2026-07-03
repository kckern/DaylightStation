import { AbcRenderer } from './renderers/AbcRenderer.jsx';
import { SvgStaffRenderer } from './renderers/SvgStaffRenderer.jsx';
import { MusicXmlRenderer } from './renderers/MusicXmlRenderer.jsx';
import { ChordStaffRenderer } from './renderers/ChordStaffRenderer.jsx';

/**
 * Notation — renderer-selecting facade over the MusicNotation framework.
 *
 * One music model, pluggable renderers:
 *   - 'chord' → ChordStaffRenderer (VexFlow; compact self-centering live chord)
 *   - 'abc' → AbcRenderer (abcjs grand-staff; melodic drills / scrolling)
 *   - 'svg' → SvgStaffRenderer (hand-rolled SVG; game target staves)
 *   - 'musicxml' → MusicXmlRenderer (OpenSheetMusicDisplay; engraved scores)
 *
 * Props are forwarded to the chosen renderer (see each renderer for its API).
 *
 * @param {'chord'|'abc'|'svg'|'musicxml'} renderer
 */
export function Notation({ renderer = 'abc', ...props }) {
  switch (renderer) {
    case 'chord':
      return <ChordStaffRenderer {...props} />;
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
