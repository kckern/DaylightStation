import { useContext, useEffect } from 'react';
import { SoundContext } from '../../PianoSoundContext.jsx';
import { addressFor } from '../../devices/voicePatches.js';
import getLogger from '../../../../../../../frontend/src/lib/logging/Logger.js';

const PERCUSSIVE = /wood\s?block/i;

/**
 * While `active`, the keyboard plays a percussive voice (the device catalog's Woodblock) so a tap sounds like a
 * tap. It is an AUDITION: the selected voice is never changed, and leaving (unmount, or `active` going false)
 * calls `resync()`, which puts the real voice back (the Patch finder's own pattern). Best effort: a piano with
 * no such voice, no output, or no sound provider plays on in its own voice and the rung is unchanged.
 */
export function useRhythmVoice(active) {
  const sound = useContext(SoundContext);
  const audition = sound?.auditionAddress;
  const resync = sound?.resync;
  const device = sound?.device;
  const patches = sound?.voicePatches;
  useEffect(() => {
    if (!active) return undefined;
    const log = getLogger().child({ component: 'rhythm-voice' });
    const voice = (device?.voiceGroups ?? []).flatMap((group) => group.voices ?? []).find((item) => PERCUSSIVE.test(item.name ?? ''));
    const address = voice ? addressFor(voice, patches) : null;
    if (!audition || !address) { log.info('piano.learn.rhythm-voice', { applied: false, reason: !audition ? 'no-sound-provider' : 'no-voice' }); return undefined; }
    const sent = audition(address);
    log.info('piano.learn.rhythm-voice', { applied: true, voice: voice.name, sent });
    return () => { resync?.(); log.info('piano.learn.rhythm-voice', { applied: false, restored: true }); };
  }, [active, audition, resync, device, patches]);
}

export default useRhythmVoice;
