import React from 'react';
import PropTypes from 'prop-types';
import './FeedbackCornerButton.scss';

/**
 * FeedbackCornerButton — an unobtrusive mic glyph tucked into a corner of the
 * Fitness home/menu view. Tapping it opens the voice-feedback overlay. Sized as
 * a generous tap target for the large garage touchscreen TV, but visually quiet
 * so it never competes with the primary nav/content controls.
 */
const MicGlyph = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
    />
  </svg>
);

const FeedbackCornerButton = ({ onOpen }) => (
  <button
    type="button"
    className="fitness-feedback-trigger"
    data-testid="fitness-feedback-trigger"
    aria-label="Leave voice feedback"
    onPointerDown={(e) => { e.preventDefault(); onOpen?.(); }}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
  >
    <span className="fitness-feedback-trigger__icon"><MicGlyph /></span>
  </button>
);

FeedbackCornerButton.propTypes = {
  onOpen: PropTypes.func.isRequired,
};

export default FeedbackCornerButton;
