// An auxiliary Player (music behind a slideshow, a clip shown briefly) is not
// the household's "what was watched": it must never write play-ledger or
// resume-progress rows. Player provides this; the media controller reads it.
import { createContext, useContext } from 'react';

export const AuxiliaryPlayerContext = createContext(false);
export const useIsAuxiliaryPlayer = () => useContext(AuxiliaryPlayerContext);
