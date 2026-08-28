import { useContext } from 'react';
import ScreenSceneContext from './ScreenSceneContext.jsx';

export function useScreenScene() { return useContext(ScreenSceneContext); }
