import { useState } from 'react';
import Icon from '../../ui/icons/Icon.jsx';
import { usePianoMix } from '../usePianoMix.js';
import { STEPS, stepToLevel, levelToStep } from '../volumeCurve.js';
import TransportSheet from './TransportSheet.jsx';
import TransportButton from './TransportButton.jsx';
import StepGrid from './StepGrid.jsx';

/**
 * VolumeSheet — THE kiosk volume affordance (audit F6): Media (the media
 * element's own volume) and MIDI (the piano voice's CC7) as five-step
 * StepGrids, plus the Log/Linear curve toggle. Successor to VolumeModal,
 * rebuilt on the transport primitives; opened everywhere via VolumeControl.
 */
function ChannelCard({ icon, name, level, onLevel, curve, warning }) {
  return (
    <div className="piano-volsheet__card">
      <div className="piano-volsheet__cardhead">
        <Icon name={icon} />
        <span>{name}</span>
      </div>
      <StepGrid
        steps={STEPS.map((label) => ({ label }))}
        activeIndex={levelToStep(level, curve)}
        onPick={(i) => onLevel(stepToLevel(i, curve))}
        ariaLabel={name}
      />
      {warning && <p className="piano-volsheet__warning" role="alert">{warning}</p>}
    </div>
  );
}

export default function VolumeSheet({ open, onClose }) {
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel, mediaOutput } = usePianoMix();
  // The bridge checked the tablet's OS media volume and could not bring it up:
  // the slider below would be multiplying against zero.
  const mediaWarning = mediaOutput?.silent
    ? `Tablet speaker volume is ${mediaOutput.musicIndex}/${mediaOutput.musicMax} and couldn’t be raised.`
    : null;
  const [curve, setCurve] = useState('log');
  return (
    <TransportSheet open={open} title="Volume" onClose={onClose}>
      <ChannelCard icon="volume" name="Media Volume" level={mediaLevel} onLevel={setMediaLevel} curve={curve} warning={mediaWarning} />
      <ChannelCard icon="piano" name="MIDI Volume" level={pianoLevel} onLevel={setPianoLevel} curve={curve} />
      <div className="piano-volsheet__curve" role="group" aria-label="Volume curve">
        <TransportButton label="Linear" on={curve === 'linear'} onPress={() => setCurve('linear')} />
        <TransportButton label="Log" on={curve === 'log'} onPress={() => setCurve('log')} />
      </div>
    </TransportSheet>
  );
}
