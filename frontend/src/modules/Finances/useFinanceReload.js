// useFinanceReload.js — the reload trigger for FinanceDataContext.jsx, split
// out so Fast Refresh can hot-reload files that only export components.
import { useContext } from 'react';
import { FinanceDataContext } from './FinanceDataContext.jsx';

export const useFinanceReload = () => useContext(FinanceDataContext).reload;
