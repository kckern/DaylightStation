import React from 'react';
import PropTypes from 'prop-types';
import FingerprintIcon from './FingerprintIcon.jsx';
import './FingerprintHands.scss';

// Single-path hand silhouette (svgrepo.com/130068, thumb-left). Drawn once and
// mirrored on the X axis for the opposing hand so the two thumbs meet at center.
const HAND_PATH = 'M567.52,142.808c-18.1-2.46-27.659,12.74-28.846,29.688l-13.495,134.416c-0.252,6.244-5.518,11.114-11.769,10.862c-6.244-0.245-11.106-5.51-10.861-11.768l8.186-240.043c0.598-16.984-12.675-31.234-29.657-31.838c-16.984-0.604-31.234,12.675-31.847,29.651l-7.999,238.13c0,5.036-4.085,9.114-9.114,9.114c-5.034,0-9.112-4.079-9.112-9.114l-0.008-271.147C422.998,13.776,409.222,0,392.231,0s-30.767,13.775-30.767,30.759l-0.224,266.091c0,5.719-4.633,10.322-10.357,10.351c-8.366,0.043-10.014-7.826-10.014-7.826c-0.201-0.816-10.258-236.442-10.258-236.442c-0.885-16.969-15.363-30.004-32.325-29.112c-16.971,0.877-30.012,15.365-29.119,32.327l15.919,336.895c1.61,10.121-5.294,19.623-15.415,21.234c-10.129,1.611-19.631-5.279-21.242-15.408l-29.356-119.524c-4.036-16.516-20.688-26.615-37.19-22.587c-16.509,4.042-26.615,20.695-22.58,37.197l48.714,199.186c0.899,3.652,70.445,127.939,95.802,133.902v69.174c0,22.127,17.935,40.061,40.054,40.061h136.235c22.126,0,40.061-17.934,40.061-40.061v-75.789c35.88-45.924,49.54-132.113,50.116-206.328l17.407-248.525C588.87,158.612,584.122,145.066,567.52,142.808z';

// Cropped viewBox: the silhouette's true content is x∈[158,588], full height, so
// the square viewBox wastes ~42% horizontally and the lower half is wrist/palm.
// We crop to the upper hand (fingers + thumb), trimming the side margins AND the
// wrist, so fingertips render large and spread in a short row.
const VIEW_BOX = '140 0 480 495';
const VIEW_ASPECT = 480 / 495; // for the hand box aspect-ratio (must match viewBox)

// Fingertip pad coordinates as % of the CROPPED box (recomputed from the
// full-box calibration thumb[22,44] index[41,13] middle[51,9] ring[61,14]
// little[71,23] via (px*746-x0)/w, (py*746-y0)/h). Left-hand tips mirror x→100-x.
const RIGHT_TIPS = {
  thumb: [5.0, 66.3],
  index: [34.6, 19.6],
  middle: [50.1, 13.6],
  ring: [65.7, 21.1],
  little: [81.2, 34.7],
};
const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'little'];

// Human-readable finger label, e.g. 'right-index' → 'Right index'.
export function fingerLabel(finger) {
  if (!finger) return '';
  return finger
    .split('-')
    .map((part, i) => (i === 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function Hand({ side, enrolledSet, selected, interactive, onFingerTap }) {
  const mirror = side === 'left';
  return (
    <div className={`fp-hand fp-hand--${side}`}>
      <svg
        className="fp-hand__silhouette"
        viewBox={VIEW_BOX}
        preserveAspectRatio="xMidYMin meet"
        style={{ transform: mirror ? 'scaleX(-1)' : 'none' }}
        aria-hidden="true"
      >
        <path d={HAND_PATH} fill="currentColor" />
      </svg>
      {FINGER_ORDER.map((name) => {
        const finger = `${side}-${name}`;
        const [x, y] = RIGHT_TIPS[name];
        const left = mirror ? 100 - x : x;
        const isEnrolled = enrolledSet.has(finger);
        const isSelected = selected === finger;
        const cls = [
          'fp-tip',
          isEnrolled ? 'fp-tip--enrolled' : 'fp-tip--empty',
          isSelected ? 'fp-tip--selected' : null,
        ].filter(Boolean).join(' ');
        const style = { left: `${left}%`, top: `${y}%` };
        const label = `${fingerLabel(finger)} — ${isEnrolled ? 'enrolled' : 'not enrolled'}`;
        const glyph = <span className="fp-tip__glyph"><FingerprintIcon size="100%" /></span>;

        if (interactive) {
          return (
            <button
              key={finger}
              type="button"
              className={cls}
              style={style}
              aria-label={label}
              aria-pressed={isSelected}
              onPointerDown={() => onFingerTap?.(finger, isEnrolled)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFingerTap?.(finger, isEnrolled); }
              }}
            >{glyph}</button>
          );
        }
        return (
          <span key={finger} className={cls} style={style} aria-label={label}>{glyph}</span>
        );
      })}
    </div>
  );
}

Hand.propTypes = {
  side: PropTypes.oneOf(['left', 'right']).isRequired,
  enrolledSet: PropTypes.instanceOf(Set).isRequired,
  selected: PropTypes.string,
  interactive: PropTypes.bool,
  onFingerTap: PropTypes.func,
};

/**
 * A pair of hands with a fingerprint glyph on every fingertip. Enrolled tips glow
 * green; the `selected` tip is highlighted (the print being focused). In
 * `interactive` mode each tip is a button and `onFingerTap(finger, isEnrolled)`
 * fires on activate — the same anatomy serves both the roster (at-a-glance state)
 * and the enroll picker (choose a finger).
 */
export default function FingerprintHands({
  enrolled = [],
  selected = null,
  interactive = false,
  onFingerTap,
  size = 'md',
  className = '',
}) {
  const enrolledSet = React.useMemo(() => new Set(enrolled), [enrolled]);
  return (
    <div className={`fp-hands fp-hands--${size} ${className}`.trim()} role={interactive ? 'group' : 'img'}>
      <Hand side="left" enrolledSet={enrolledSet} selected={selected} interactive={interactive} onFingerTap={onFingerTap} />
      <Hand side="right" enrolledSet={enrolledSet} selected={selected} interactive={interactive} onFingerTap={onFingerTap} />
    </div>
  );
}

FingerprintHands.propTypes = {
  enrolled: PropTypes.arrayOf(PropTypes.string),
  selected: PropTypes.string,
  interactive: PropTypes.bool,
  onFingerTap: PropTypes.func,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  className: PropTypes.string,
};
