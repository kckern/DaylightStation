import { useFitnessContext } from '../context/FitnessContext.jsx';

export * from './fitness/types';
export { Device, DeviceManager } from './fitness/DeviceManager';
export { User } from './fitness/UserManager';
export { FitnessSession, setFitnessTimeouts, getFitnessTimeouts } from './fitness/FitnessSession';
export { FitnessTreasureBox } from './fitness/TreasureBox';
export { VoiceMemoManager } from './fitness/VoiceMemoManager';

export const useFitnessSession = () => {
  return useFitnessContext();
};
