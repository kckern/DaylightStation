import { createContext, useContext } from 'react';

/** Lets deeply-nested drawer content trigger a data reload without prop drilling. */
export const FinanceDataContext = createContext({ reload: async () => {} });
export const useFinanceReload = () => useContext(FinanceDataContext).reload;
