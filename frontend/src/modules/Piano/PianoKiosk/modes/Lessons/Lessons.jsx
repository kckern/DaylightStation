import { Notation } from '../../../../MusicNotation/Notation.jsx';
import { TheoryLessons } from './theory/TheoryLessons.jsx';

/**
 * Lessons mode — two families:
 *   1. Notation-driven song lessons (MusicXML → notation + scoring). SHELL only;
 *      the MusicXmlRenderer (OSMD) + scoring loop are future work.
 *   2. Music-theory lessons (tonal-backed): chord ID, intervals, scales,
 *      progressions. Catalog wired (TheoryLessons); runners are skeletons.
 */
export function Lessons() {
  return (
    <section className="piano-mode piano-mode--lessons">
      <h2>Lessons</h2>

      <div className="piano-lessons__section">
        <h3>Songs (notation)</h3>
        {/* Seam for MusicXML notation lessons — renders via the MusicNotation
            facade so the OSMD renderer drops in here without restructuring. */}
        <Notation renderer="musicxml" />
      </div>

      <div className="piano-lessons__section">
        <TheoryLessons />
      </div>
    </section>
  );
}

export default Lessons;
