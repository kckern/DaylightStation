export function createColumnDropState() {
  return { hovered: null };
}

export function applyColumnDropEvent(state, event) {
  if (event?.type === 'address') return { ...state, hovered: event.value };
  if (event?.type === 'cancel') return { ...state, hovered: null };
  if (event?.type === 'confirm' && state.hovered !== null) {
    return { ...state, hovered: null, committed: state.hovered };
  }
  return state;
}

export function createSourceDestinationState() {
  return { source: null, hovered: null };
}

export function applySourceDestinationEvent(state, event) {
  if (event?.type === 'address') return { ...state, hovered: event.value };
  if (event?.type === 'cancel') return createSourceDestinationState();
  if (event?.type !== 'confirm' || state.hovered === null) return state;
  if (state.source === null) return { source: state.hovered, hovered: null };
  return { source: null, hovered: null, committed: { from: state.source, to: state.hovered } };
}

/**
 * One-address-at-a-time source/destination policy for instrument input.
 *
 * `locked` means the game — not the player — chose the source, as with a
 * checkers multi-jump that must continue from the square the piece landed on.
 * A locked selection cannot be cleared or swapped, so the only escape from
 * destination mode is a legal destination. Say so with a rejection of its own:
 * an unexplained refusal here is indistinguishable from dead input, and a
 * player who cannot see WHY the board is refusing has nothing to try but the
 * same address again.
 */
export function resolveAddressedSelection({
  selected = null, address, sources, destinations, locked = false,
}) {
  const sourceSet = new Set(sources || []);
  if (selected === null) {
    return sourceSet.has(address)
      ? { selected: address, committed: null, rejection: null }
      : { selected: null, committed: null, rejection: 'select_source' };
  }
  const destinationSet = new Set(destinations || []);
  if (destinationSet.has(address)) {
    return { selected: null, committed: { from: selected, to: address }, rejection: null };
  }
  if (locked) return { selected, committed: null, rejection: 'forced_source' };
  // Addressing the selected square again puts it back down. Without this the
  // only way out of destination mode is guessing a square that happens to be
  // legal, which is how a player ends up mashing one address at a board that
  // will never accept it.
  if (address === selected) return { selected: null, committed: null, rejection: null };
  if (sourceSet.has(address)) return { selected: address, committed: null, rejection: null };
  return { selected, committed: null, rejection: 'select_destination' };
}
