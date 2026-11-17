import React, {useId} from 'react';

const modes = {text:'Text', reader:'Reader', image:'Image'};
export function isPartyGamesParticipantPreview(data) {
  return Array.isArray(data?.participants) && data.participants.length > 0 && data.participants.every(person =>
    typeof person?.name === 'string' && person.name.trim() && Object.hasOwn(modes, person.clue_mode));
}

/** Displays only the consumer's public, pinned review fields. */
export function PartyGamesParticipantPreview({summary}) {
  const instructionsId=useId();
  return <><p id={instructionsId}>Use up and down to review participants; continue to reach the controls.</p><ul className="tv-action-dialog__participants" aria-label="Participants and clue modes" aria-describedby={instructionsId} data-tv-scroll tabIndex={0}>
    {summary.data.participants.map((person, index) => <li key={index}><span>{person.name}</span><span>Clue: {modes[person.clue_mode]}</span></li>)}
  </ul></>;
}
