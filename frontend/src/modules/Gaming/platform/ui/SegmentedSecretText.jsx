import React from 'react';
import { SEGMENTS, activeSegmentsFor, segmentNames, segmentPoints } from './segmentedSecretGeometry.js';
import './SegmentedSecretText.scss';

// A physical red decoder filter preserves the warm signal segments while
// substantially dimming the cool mask segments. Every cell stays filled so
// whitespace cannot reveal a word boundary without the decoder.
const SIGNAL_COLORS = Object.freeze(['var(--gp-segment-signal-1)', 'var(--gp-segment-signal-2)', 'var(--gp-segment-signal-3)', 'var(--gp-segment-signal-4)']);
const MASK_COLORS = Object.freeze(['var(--gp-segment-mask-1)', 'var(--gp-segment-mask-2)', 'var(--gp-segment-mask-3)']);

function Glyph({ character, index }) {
  const active = new Set(activeSegmentsFor(character));
  return (
    <svg className="segmented-secret-text__glyph" viewBox="0 0 50 100" aria-hidden="true">
      {segmentNames.map((name, segmentIndex) => {
        const isSignal = active.has(name);
        const palette = isSignal ? SIGNAL_COLORS : MASK_COLORS;
        return <polygon key={name} points={segmentPoints(SEGMENTS[name])}
          className={isSignal ? 'is-signal' : 'is-mask'}
          style={{ '--segment-color': palette[(index * 3 + segmentIndex) % palette.length] }} />;
      })}
    </svg>
  );
}

export default function SegmentedSecretText({ text, label = 'Secret clue', accessibleText = null }) {
  const value = String(text || '').toUpperCase();
  return (
    <div className="segmented-secret-text" role="img" aria-label={accessibleText || `${label}: ${value}`}>
      {[...value].map((character, index) => (
        <Glyph key={index} character={character} index={index} />
      ))}
    </div>
  );
}
