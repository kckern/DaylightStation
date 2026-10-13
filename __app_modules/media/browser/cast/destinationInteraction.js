// frontend/src/modules/Media/cast/destinationInteraction.js
// The header's destination control and the dock's search field are siblings.
// While someone is changing the destination (the popover is open, or a press on
// its control is in flight) an open search must stay open — its query, scope and
// results are what they were choosing a destination FOR (FIND.1b). The dock
// provides this one flag; the control raises it, the search reads it.
import { createContext, useContext } from 'react';

const NOOP = () => {};

export const DestinationInteractionContext = createContext({ active: false, setActive: NOOP });

export function useDestinationInteraction() {
  return useContext(DestinationInteractionContext);
}
