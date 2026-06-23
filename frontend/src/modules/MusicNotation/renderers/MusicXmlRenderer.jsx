/**
 * MusicXmlRenderer — renders a MusicXML score as engraved notation.
 *
 * SHELL/SEAM: notation-driven song lessons will render MusicXML here. The
 * intended backend is OpenSheetMusicDisplay (OSMD), which engraves MusicXML to
 * SVG and exposes a cursor for follow-along scoring; alternatively MusicXML can
 * be converted to ABC and reuse AbcRenderer. That choice is deferred — for now
 * this is a placeholder so the Notation facade ('musicxml') and the Lessons shell
 * can reference the seam without restructuring later.
 *
 * Future prop contract (proposed):
 *   @param {string} musicXml - raw MusicXML document
 *   @param {number} [cursorBeat] - playhead position for follow-along
 *   @param {object} [scoring] - per-note correct/incorrect overlay
 */
export function MusicXmlRenderer({ musicXml }) {
  return (
    <div className="musicxml-renderer musicxml-renderer--placeholder">
      <p>
        MusicXML notation rendering is not implemented yet
        {musicXml ? ' (score provided).' : '.'} Planned via OpenSheetMusicDisplay (OSMD).
      </p>
    </div>
  );
}

export default MusicXmlRenderer;
