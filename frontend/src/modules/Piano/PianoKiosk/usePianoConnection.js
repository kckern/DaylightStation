// usePianoConnection.js — the hook half of PianoConnectionContext.jsx, split
// out so Fast Refresh can hot-reload the provider component on its own.
import { useContext } from 'react';
import { Ctx } from './PianoConnectionContext.jsx';

export function usePianoConnection() {
  const value = useContext(Ctx);
  if (!value) throw new Error('usePianoConnection must be used within PianoConnectionProvider');
  return value;
}
