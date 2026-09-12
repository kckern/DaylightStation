import PropTypes from 'prop-types';

/**
 * The drill surface's two rows, column-aligned per syllable — the model above,
 * the learner's answer directly beneath, one grid column each:
 *
 *     저녁    혼자    살아요     ░░░
 *     ────    ────    ──────
 *     저녁    혼_
 *              ▁
 *
 * A CSS grid and not two independent lines of text: the whole point is that a
 * child can see WHICH syllable they are on and which one is wrong, and two
 * separately-flowing lines drift apart the moment a syllable is missing or a
 * glyph is a different width. One column per entry keeps them locked.
 *
 * Every decision about what belongs in a column — and whether it is drawn at
 * all — is `columnsFor` in `glyphStrip.js`; this renders what it decided and
 * holds no state of its own. `caret` is the only exception: a strip that is
 * not the learner's live focus (a review, a second sentence on screen) should
 * not show a cursor.
 *
 * Accessibility: the strip is decorative duplication of the input's own value,
 * so `role="presentation"`. The input keeps its label and remains the
 * accessible control — a screen reader reading the same sentence twice, once
 * character by character, is noise. A `blind` column renders no text at all
 * rather than hiding it in CSS: in listen mode the model must not be in the
 * DOM, or the drill is a reading exercise for anyone who can reach it.
 */
export default function GlyphStrip({ columns, caret = true }) {
  return (
    <div className="lang-strip" role="presentation">
      {columns.map((col, i) => (
        <div key={i} className={`lang-strip__col is-${col.state}`}>
          <span className="lang-strip__want" aria-hidden={col.state === 'blind'}>
            {col.state === 'blind' ? '' : col.want}
          </span>
          <span className="lang-strip__got">{col.got ?? ''}</span>
          {caret && col.state === 'current' && <span className="lang-strip__caret" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

GlyphStrip.propTypes = {
  /** Straight out of `columnsFor` — one entry per target syllable, in order. */
  columns: PropTypes.arrayOf(PropTypes.shape({
    /** The model syllable belonging in this column. */
    want: PropTypes.string.isRequired,
    /** What the learner has there — the pending syllable on the live column. */
    got: PropTypes.string,
    state: PropTypes.oneOf(['done', 'wrong', 'current', 'next', 'hidden', 'blind']).isRequired,
  })).isRequired,
  /** False on a strip that is not the learner's live focus. */
  caret: PropTypes.bool,
};
