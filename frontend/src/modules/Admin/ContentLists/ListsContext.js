// frontend/src/modules/Admin/ContentLists/ListsContext.js
import { createContext, useContext } from 'react';

export const ListsContext = createContext({
  items: [],
  contentInfoMap: new Map(),
  setContentInfo: () => {},
  getNearbyItems: () => [],
});

export function useListsContext() {
  return useContext(ListsContext);
}
