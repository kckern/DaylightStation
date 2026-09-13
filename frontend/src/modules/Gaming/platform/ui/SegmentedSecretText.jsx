import React from 'react';
import { SEGMENTS, activeSegmentsFor, segmentNames, segmentPoints } from './segmentedSecretGeometry.js';
import { generateDecoderArtifacts } from './imageDecoderArtifacts.js';
import './SegmentedSecretText.scss';

const COLUMNS = 16;
const MIN_ROWS = 3;
// The interference is independent of the clue, including its whitespace.
const ARTIFACTS = generateDecoderArtifacts('secret-text-field', 180);
const MASK_COLORS = ['var(--gp-segment-signal-1)', 'var(--gp-segment-signal-2)', 'var(--gp-segment-signal-3)', 'var(--gp-text-decoder-bubble)'];

function maskedLayout(value) {
  const cells = [];
  for (const word of value.trim().split(/\s+/)) {
    const column = cells.length % COLUMNS;
    if (column && word.length + 1 > COLUMNS - column) {
      while (cells.length % COLUMNS) cells.push(' ');
    } else if (column) cells.push(' ');
    cells.push(...word);
  }
  const rows = Math.max(MIN_ROWS, Math.ceil(cells.length / COLUMNS));
  while (cells.length < rows * COLUMNS) cells.push(' ');
  return { cells, rows };
}

export default function SegmentedSecretText({ text, label = 'Secret clue', accessibleText = null }) {
  const value = String(text || '').toUpperCase();
  const { cells, rows } = maskedLayout(value);
  const width = COLUMNS * 56;
  const height = rows * 108;
  return (
    <div className="segmented-secret-text" role="img" aria-label={accessibleText || `${label}: ${value}`}>
      <svg className="segmented-secret-text__field" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <rect width={width} height={height} className="segmented-secret-text__background" />
        {cells.map((character, index) => (
          <g key={index} className="segmented-secret-text__glyph" transform={`translate(${index % COLUMNS * 56 + 3} ${Math.floor(index / COLUMNS) * 108 + 4})`}>
            {activeSegmentsFor(character).map(name => <polygon key={name} points={segmentPoints(SEGMENTS[name])} className="is-signal" />)}
          </g>
        ))}
        <g className="segmented-secret-text__camouflage">
          {cells.map((_, index) => <g key={index} transform={`translate(${index % COLUMNS * 56 + 3} ${Math.floor(index / COLUMNS) * 108 + 4})`}>
            {segmentNames.map((name, segment) => <polygon key={name} points={segmentPoints(SEGMENTS[name])} style={{fill:MASK_COLORS[(index * 7 + segment * 3) % MASK_COLORS.length]}} />)}
          </g>)}
        </g>
        <g className="segmented-secret-text__interference" transform={`scale(${width / 100} ${height / 100})`}>
          {ARTIFACTS.map(artifact => <ellipse key={artifact.id} className={`segmented-secret-text__artifact is-${artifact.kind}`}
            cx={artifact.cx} cy={artifact.cy} rx={artifact.rx} ry={artifact.ry} opacity={artifact.opacity}
            transform={`rotate(${artifact.rotation} ${artifact.cx} ${artifact.cy})`} />)}
        </g>
      </svg>
    </div>
  );
}
