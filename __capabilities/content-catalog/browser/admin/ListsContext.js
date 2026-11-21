// frontend/src/modules/Admin/ContentLists/ListsContext.js
import { createContext, useContext } from 'react';

export const ListsContext = createContext({
  sections: [],
  flatItems: [],
  contentInfoMap: new Map(),
  setContentInfo: () => {},
  inUseImages: new Set(),
});

export function useListsContext() {
  return useContext(ListsContext);
}
