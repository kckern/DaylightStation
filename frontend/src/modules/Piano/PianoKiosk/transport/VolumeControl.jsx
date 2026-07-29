import { useState } from 'react';
import TransportButton from './TransportButton.jsx';
import VolumeSheet from './VolumeSheet.jsx';

/**
 * VolumeControl — the compact volume affordance: one `volume` icon button that
 * opens VolumeSheet. Every player renders THIS (course videos, karaoke,
 * playalong, music, sheet music) so volume looks and works identically
 * everywhere. `onOpenChange` lets auto-hiding hosts pin their chrome.
 */
export default function VolumeControl({ disabled = false, className = '', onOpenChange }) {
  const [open, setOpen] = useState(false);
  const set = (v) => { setOpen(v); onOpenChange?.(v); };
  return (
    <>
      <TransportButton
        icon="volume"
        ariaLabel="Volume"
        on={open}
        disabled={disabled}
        className={className}
        onPress={() => set(true)}
      />
      <VolumeSheet open={open} onClose={() => set(false)} />
    </>
  );
}
