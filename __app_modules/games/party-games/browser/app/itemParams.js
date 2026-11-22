// A list item that opens Party Games may carry `params`, a plain object this
// app owns. Charades reads three keys:
//   autostart: boolean            seat the participants without the setup screen
//   participants: [id, ...]       household-member and named-guest ids, in order
//   clue_modes: { id: mode }      reader | image; absent ids get text
// Malformed values are dropped so the catalog and URL defaults still apply.
const MODES = ['text', 'reader', 'image'];

export function launchFromParams(params) {
  const out = {};
  if (typeof params?.autostart === 'boolean') out.autostart = params.autostart;
  if (Array.isArray(params?.participants) && params.participants.length
    && params.participants.every(id => typeof id === 'string' && id)) out.participants = [...params.participants];
  return out;
}

// The ids the server checks a Charades presentation against
// (gamingSessionSetup.mjs): seat ids when seats exist, else participant ids.
// createSession sends participants only as seat members, so with no seats
// there are no participants either and the list is empty.
export function seatedParticipantIds(seats = []) {
  return seats.map(seat => String(seat.id));
}

// A `charades-presentation/v1` setup override covering exactly `seatedIds`,
// or null when the item names no clue modes (rules.yml presentation applies).
export function presentationFor(params, seatedIds) {
  const modes = params?.clue_modes;
  if (!modes || typeof modes !== 'object' || Array.isArray(modes) || !Object.keys(modes).length) return null;
  return {
    schema: 'charades-presentation/v1',
    by_participant: Object.fromEntries(seatedIds.map(id => [id, MODES.includes(modes[id]) ? modes[id] : 'text'])),
  };
}
