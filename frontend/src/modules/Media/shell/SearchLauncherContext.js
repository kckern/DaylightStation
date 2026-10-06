// frontend/src/modules/Media/shell/SearchLauncherContext.js
// Lets a view open the one search surface — today, a screen's Remote opening
// it for one addition to that screen's queue (STEER.1b/AC7). Provided by the
// shell, which owns the search surface.
import { createContext, useContext } from 'react';

export const SearchLauncherContext = createContext(null);

export function useSearchLauncher() {
  return useContext(SearchLauncherContext);
}

export default SearchLauncherContext;
