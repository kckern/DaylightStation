import { useContext } from 'react';
import ScreenAmbientContext from './ScreenAmbientContext.jsx';

export function useScreenAmbient() {
  return useContext(ScreenAmbientContext);
}
