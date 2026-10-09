import { useFitnessContext } from "../context/FitnessContext.jsx";

export * from "./fitness/types.js";
export { Device, DeviceManager } from "./fitness/DeviceManager.js";
export { User } from "./fitness/UserManager.js";
export { FitnessSession, setFitnessTimeouts, getFitnessTimeouts } from "./fitness/FitnessSession.js";
export { FitnessTreasureBox } from "./fitness/TreasureBox.js";
export { VoiceMemoManager } from "./fitness/VoiceMemoManager.js";

export const useFitnessSession = () => {
  return useFitnessContext();
};
