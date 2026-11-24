import { usePianoUser } from '../../PianoUserContext.jsx';
import { usePianoKioskConfigOptional } from '../../PianoConfig.jsx';
import { passageTomatoesFor } from '../../pianoConfigModel.js';

// Who is playing, or null outside the kiosk's user provider (the office screen mounts the
// path without one). usePianoUser reads its context before it throws, so the hook order holds.
function usePlayerOptional() {
  try { return usePianoUser(); } catch { return null; }
}

/**
 * Whether the Learn path draws a tomato on a passage not yet started, for whoever is
 * playing: `sheetmusic.learn.tomatoes` ('learners' by default: the kids, not the
 * grown-ups). Off without a known player.
 */
export default function usePassageTomatoes() {
  const player = usePlayerOptional();
  const learn = usePianoKioskConfigOptional()?.config?.sheetmusic?.learn;
  if (!player) return false;
  const profile = (player.users ?? []).find((item) => item.id === player.currentUser) ?? player.currentProfile ?? null;
  return passageTomatoesFor(learn, profile);
}
