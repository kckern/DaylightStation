import React from 'react';
import { SEGMENTS, activeSegmentsFor, segmentNames, segmentPoints } from './segmentedSecretGeometry.js';
import './SegmentedSecretText.scss';

// A physical red decoder filter preserves the warm signal segments while
// substantially dimming the cool mask segments. Every cell stays filled so
// whitespace cannot reveal a word boundary without the decoder.
const SIGNAL_COLORS = Object.freeze(['var(--gp-segment-signal-1)', 'var(--gp-segment-signal-2)', 'var(--gp-segment-signal-3)', 'var(--gp-segment-signal-4)']);
const MASK_COLORS = Object.freeze(['var(--gp-segment-mask-1)', 'var(--gp-segment-mask-2)', 'var(--gp-segment-mask-3)']);
const TARGET_LINE_LENGTH = 18;

function colorIndex(seed, glyphIndex, segmentName, paletteLength) {
  let hash = 2166136261;
  for (const character of `${seed}:${segmentName}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + glyphIndex) % paletteLength;
}

export function balanceSecretLines(text, targetLength = TARGET_LINE_LENGTH) {
  const value = String(text || '');
  const lineCount = Math.max(1, Math.ceil(value.length / targetLength));
  if (lineCount === 1) return [value];

  const lines = [];
  let start = 0;
  for (let line = 0; line < lineCount - 1; line += 1) {
    const remainingLines = lineCount - line;
    const idealBreak = start + (value.length - start) / remainingLines;
    const wordBreaks = [...value].flatMap((character, index) => (
      character === ' ' && index >= start ? [index + 1] : []
    ));
    const candidates = wordBreaks.filter(index => index > start && index < value.length);
    const end = candidates.length > 0
      ? candidates.reduce((best, candidate) => (
        Math.abs(candidate - idealBreak) < Math.abs(best - idealBreak) ? candidate : best
      ))
      : Math.min(value.length, start + targetLength);
    lines.push(value.slice(start, end));
    start = end;
  }
  lines.push(value.slice(start));
  return lines;
}

function Glyph({ character, index, seed }) {
  const active = new Set(activeSegmentsFor(character));
  return (
    <svg className="segmented-secret-text__glyph" viewBox="0 0 50 100" aria-hidden="true">
      {segmentNames.map((name, segmentIndex) => {
        const isSignal = active.has(name);
        const palette = isSignal ? SIGNAL_COLORS : MASK_COLORS;
        return <polygon key={name} points={segmentPoints(SEGMENTS[name])}
          className={isSignal ? 'is-signal' : 'is-mask'}
          data-segment={name}
          style={{ '--segment-color': palette[colorIndex(seed, index, `${isSignal ? 'signal' : 'mask'}:${name}:${segmentIndex}`, palette.length)] }} />;
      })}
    </svg>
  );
}

export default function SegmentedSecretText({ text, label = 'Secret clue', accessibleText = null }) {
  const value = String(text || '').toUpperCase();
  const lines = balanceSecretLines(value);
  let glyphIndex = 0;
  return (
    <div className="segmented-secret-text" role="img" aria-label={accessibleText || `${label}: ${value}`}>
      {lines.map((line, lineIndex) => (
        <span className="segmented-secret-text__line" key={`${lineIndex}:${line}`}>
          {[...line].map(character => {
            const index = glyphIndex;
            glyphIndex += 1;
            return <Glyph key={index} character={character} index={index} seed={value} />;
          })}
        </span>
      ))}
    </div>
  );
}
