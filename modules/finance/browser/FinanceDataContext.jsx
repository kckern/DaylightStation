import { createContext } from 'react';

/** Lets deeply-nested drawer content trigger a data reload without prop drilling. */
export const FinanceDataContext = createContext({ reload: async () => {} });
