import React from 'react';
import PropTypes from 'prop-types';

/**
 * Drawn equipment glyphs: fixed SVG geometry that ships with the code, so a
 * device with no photo on the media mount still gets a picture of itself.
 *
 * - `StepMatGlyph`: a mat seen from above with two footprints.
 * - `GenericEquipmentGlyph`: a dumbbell, the neutral "some piece of fitness
 *   equipment" mark. It replaces the generic media-mount image as the last
 *   resort, because that image is a bicycle and every non-bike device that
 *   missed its own picture was being drawn as a bike.
 * - `GENERIC_EQUIPMENT_FALLBACK_SRC`: the same dumbbell as a data URI, for
 *   `<img onError>` fallbacks that can only swap a `src`.
 *
 * Both components draw in `currentColor`; size and colour come from CSS.
 */

const VIEW_BOX = '0 0 24 24';

// One footprint (ball + heel) for the left foot; the right foot mirrors it.
const FOOT_BALL = { cx: 8.4, cy: 10.4, rx: 2.3, ry: 3.2 };
const FOOT_HEEL = { cx: 8.7, cy: 16, rx: 1.6, ry: 1.7 };

// Dumbbell: handle, two inner plates, two outer plates.
const DUMBBELL_RECTS = [
  { x: 8, y: 11, width: 8, height: 2, rx: 0.5 },
  { x: 5, y: 6.5, width: 3, height: 11, rx: 1 },
  { x: 16, y: 6.5, width: 3, height: 11, rx: 1 },
  { x: 2, y: 9, width: 2.4, height: 6, rx: 1 },
  { x: 19.6, y: 9, width: 2.4, height: 6, rx: 1 },
];

const svgProps = ({ className, title }) => ({
  className,
  viewBox: VIEW_BOX,
  xmlns: 'http://www.w3.org/2000/svg',
  focusable: 'false',
  role: title ? 'img' : undefined,
  'aria-label': title || undefined,
  'aria-hidden': title ? undefined : true,
});

export function StepMatGlyph({ className = '', title }) {
  return (
    <svg {...svgProps({ className, title })} data-glyph="step-mat">
      <rect x="2" y="3" width="20" height="18" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <ellipse {...FOOT_BALL} fill="currentColor" />
      <ellipse {...FOOT_HEEL} fill="currentColor" />
      <ellipse {...FOOT_BALL} cx={24 - FOOT_BALL.cx} fill="currentColor" />
      <ellipse {...FOOT_HEEL} cx={24 - FOOT_HEEL.cx} fill="currentColor" />
    </svg>
  );
}

export function GenericEquipmentGlyph({ className = '', title }) {
  return (
    <svg {...svgProps({ className, title })} data-glyph="equipment">
      {DUMBBELL_RECTS.map((rect) => (
        <rect key={`${rect.x}-${rect.y}`} {...rect} fill="currentColor" />
      ))}
    </svg>
  );
}

const glyphPropTypes = { className: PropTypes.string, title: PropTypes.string };
StepMatGlyph.propTypes = glyphPropTypes;
GenericEquipmentGlyph.propTypes = glyphPropTypes;

// The <img> fallback: the dumbbell inset on a dark plate, so it fills a
// circular or square avatar under `object-fit: cover` without touching the rim.
const fallbackSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
  '<rect width="48" height="48" fill="#1f2328"/>',
  '<g transform="translate(12 12)" fill="#9aa4ad">',
  ...DUMBBELL_RECTS.map(({ x, y, width, height, rx }) => (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}"/>`
  )),
  '</g></svg>',
].join('');

export const GENERIC_EQUIPMENT_FALLBACK_SRC = `data:image/svg+xml,${encodeURIComponent(fallbackSvg)}`;
