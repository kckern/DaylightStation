export const defaultParticipantSettings = () => ({schema:'party-games-participant-setup/v1',autostart:true,charades:{default_clue_mode:'text',clue_modes:{}}});

/** Preserve untouched keys, remap copied identities and remove deleted identities. */
export function remapParticipantKeys({settings,keyMap}) {
  const copy=structuredClone(settings);
  const modes={};
  for (const [key,value] of Object.entries(copy.charades.clue_modes)) {
    const next=Object.hasOwn(keyMap,key) ? keyMap[key] : key;
    if (next === null) continue;
    if (typeof next !== 'string' || !next || Object.hasOwn(modes,next)) throw Object.assign(new Error('Invalid participant mapping'),{code:'invalid_session_setup'});
    modes[next]=value;
  }
  copy.charades.clue_modes=modes;
  return copy;
}
