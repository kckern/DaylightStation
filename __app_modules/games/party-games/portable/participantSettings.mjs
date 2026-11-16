export const defaultParticipantSettings = () => ({schema:'party-games-participant-setup/v1',autostart:true,charades:{default_clue_mode:'text',clue_modes:{}}});
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function invalid(field) {
  throw Object.assign(new Error('Invalid participant settings'), {code:'invalid_session_setup',field});
}

/** Preserve incomplete settings and remap known participant keys without inventing fields. */
export function remapParticipantKeys({settings,keyMap}) {
  if (!isRecord(settings)) invalid('settings');
  const copy=structuredClone(settings);
  if (!Object.hasOwn(copy,'charades')) return copy;
  if (!isRecord(copy.charades)) invalid('settings.charades');
  if (!Object.hasOwn(copy.charades,'clue_modes')) return copy;
  if (!isRecord(copy.charades.clue_modes)) invalid('settings.charades.clue_modes');
  const modes={};
  for (const [key,value] of Object.entries(copy.charades.clue_modes)) {
    const next=Object.hasOwn(keyMap,key) ? keyMap[key] : key;
    if (next === null) continue;
    if (typeof next !== 'string' || !next || Object.hasOwn(modes,next)) invalid('settings.charades.clue_modes');
    Object.defineProperty(modes,next,{value,enumerable:true,configurable:true,writable:true});
  }
  copy.charades.clue_modes=modes;
  return copy;
}
