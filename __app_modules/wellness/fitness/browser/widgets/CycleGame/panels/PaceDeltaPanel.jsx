import React from 'react';
import PropTypes from 'prop-types';
import { formatDistance } from "../../../lib/cycleGame/formatDistance.js";
import { ArrowUpIcon, ArrowDownIcon } from "../home/icons.jsx";
import "./PaceDeltaPanel.scss";

const sizeClass = (zoneBox) => {
  const h = zoneBox && Number.isFinite(zoneBox.height) ? zoneBox.height : null;
  if (h == null) return 'cg-pace--md';
  if (h < 160) return 'cg-pace--sm';
  if (h < 260) return 'cg-pace--md';
  const w = zoneBox && Number.isFinite(zoneBox.width) ? zoneBox.width : 0;
  if (h >= 380 && w >= 640) return 'cg-pace--xl';
  return 'cg-pace--lg';
};

// How the rival reads in a sentence ("your best", "Rider A's best", "par pace").
const rivalPhrase = (kind, name) => {
  if (kind === 'self') return 'your best';
  if (kind === 'household') return `${name}'s best`;
  if (kind === 'par') return 'par pace';
  return name;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Solo-race pace readout: one big "how far ahead or behind the rival" number.
 * Direction is carried by a word and an arrow as well as colour. Pure
 * presentational; the layout slot reserves the space, so a null delta still
 * renders a placeholder.
 */
export default function PaceDeltaPanel({ delta = null, rivalName = '', rivalKind = 'self', zoneBox = null, paused = false }) {
  const phrase = rivalPhrase(rivalKind, rivalName);
  const size = `${sizeClass(zoneBox)}${paused ? ' is-paused' : ''}`;
  // The rider is off the pedals or has no signal: the gap is not moving, so say
  // so in words (not only by dimming) and mute the ahead/behind colour.
  const pausedTag = paused ? <div className="cg-pace__paused" data-testid="pace-delta-paused">paused</div> : null;

  if (!delta) {
    return (
      <div className={`cg-pace ${size}`} data-testid="pace-delta" role="status" aria-live="off"
        aria-label={`No pace comparison yet against ${phrase}`}>
        <div className="cg-pace__main"><span className="cg-pace__headline">—</span></div>
        <div className="cg-pace__rival">{`vs ${phrase}`}</div>
        {pausedTag}
      </div>
    );
  }

  const inSeconds = Number.isFinite(delta.gapS);
  const n = inSeconds ? Math.abs(Math.round(delta.gapS)) : Math.abs(Math.round(delta.gapM || 0));
  const level = n === 0;
  const ahead = inSeconds ? delta.gapS > 0 : delta.gapM >= 0;
  const state = level ? 'is-level' : (ahead ? 'is-ahead' : 'is-behind');
  const headline = level ? 'Level' : (inSeconds ? `${n} s` : formatDistance(Math.abs(delta.gapM)));
  const unit = inSeconds ? plural(n, 'second', 'seconds') : plural(n, 'metre', 'metres');
  const label = level
    ? `Level with ${phrase}`
    : `${unit} ${ahead ? 'ahead of' : 'behind'} ${phrase}`;

  return (
    <div className={`cg-pace ${size} ${state}`} data-testid="pace-delta" role="status" aria-live="off" aria-label={label}>
      <div className="cg-pace__main">
        <span className="cg-pace__headline">{headline}</span>
        {!level && (
          <span className="cg-pace__direction">
            <span className="cg-pace__arrow">{ahead ? <ArrowUpIcon /> : <ArrowDownIcon />}</span>
            <span className="cg-pace__dir">{ahead ? 'ahead' : 'behind'}</span>
          </span>
        )}
      </div>
      <div className="cg-pace__rival">{`vs ${phrase}`}</div>
      {pausedTag}
    </div>
  );
}

PaceDeltaPanel.propTypes = {
  delta: PropTypes.shape({
    gapM: PropTypes.number,
    gapS: PropTypes.number,
    ahead: PropTypes.bool
  }),
  rivalName: PropTypes.string,
  rivalKind: PropTypes.string,
  zoneBox: PropTypes.shape({ width: PropTypes.number, height: PropTypes.number }),
  /** The live rider is parked or has no signal: dim, mute the direction colour, say "paused". */
  paused: PropTypes.bool
};
