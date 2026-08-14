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

/** One-address-at-a-time source/destination policy for instrument input. */
export function resolveAddressedSelection({ selected = null, address, sources, destinations }) {
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
  if (sourceSet.has(address)) return { selected: address, committed: null, rejection: null };
  return { selected, committed: null, rejection: 'select_destination' };
}
