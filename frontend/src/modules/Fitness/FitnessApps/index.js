export * from './registry.js';
import { registerApp } from './registry.js';

// Auto-register apps
import * as FitnessChartApp from './apps/FitnessChartApp/index.jsx';
import * as CameraViewApp from './apps/CameraViewApp/index.jsx';
import * as JumpingJackGame from './apps/JumpingJackGame/index.jsx';

registerApp(FitnessChartApp);
registerApp(CameraViewApp);
registerApp(JumpingJackGame);


