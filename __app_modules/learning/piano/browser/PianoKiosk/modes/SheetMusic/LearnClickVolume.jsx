import { useState } from 'react';
import TransportSheet from '../../transport/TransportSheet.jsx';
import Icon from '../../../ui/icons/Icon.jsx';
import { CLICK_LEVELS } from './clickLevel.js';
import { playClickPair } from './click.js';

/** A speaker with the level's bars: the picture for one click loudness, in the button and the sheet. */
export function ClickLevelPicture({ level }) {
  const rank = CLICK_LEVELS.findIndex((item) => item.id === level.id);
  return <span className="piano-learn-click__picture" aria-hidden="true">
    <Icon name="volume" />
    <span className="piano-learn-click__bars">{CLICK_LEVELS.map((item, index) => <i key={item.id} data-on={index <= rank || undefined} style={{ height: `${40 + index * 20}%` }} />)}</span>
  </span>;
}

/**
 * The click's loudness as one header button (a speaker and its level bars) that opens an opaque sheet of
 * the four levels as big pictures. Each tap sounds two clicks at that level, so it is chosen by ear, and
 * closes the sheet. Usable mid-take: the sheet never pauses the run.
 */
export default function LearnClickVolume({ level, onChange, onOpenChange }) {
  const [open, setOpenState] = useState(false);
  const setOpen = (value) => { setOpenState(value); onOpenChange?.(value); };
  return <>
    <button type="button" className="piano-learn-lab__action piano-learn-click" aria-label={`Click volume: ${level.label}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}><ClickLevelPicture level={level} /></button>
    <TransportSheet open={open} title="Click volume" onClose={() => setOpen(false)} className="piano-learn-click-sheet">
      <div className="piano-learn-click-sheet__levels" role="group" aria-label="Click volume levels">
        {CLICK_LEVELS.map((item) => <button key={item.id} type="button" aria-pressed={item.id === level.id} aria-label={item.label}
          data-autofocus={item.id === level.id ? '' : undefined}
          onClick={() => { playClickPair(item.gain); onChange(item); setOpen(false); }}>
          <ClickLevelPicture level={item} /><span>{item.label}</span>
        </button>)}
      </div>
    </TransportSheet>
  </>;
}
