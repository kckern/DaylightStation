// backend/src/3_applications/agents/health-coach/index.mjs
// Barrel export for health-coach agent directory

export { HealthCoachAgent } from './HealthCoachAgent.mjs';
export { DailyDashboard } from './assignments/DailyDashboard.mjs';
export { HealthToolFactory } from './tools/HealthToolFactory.mjs';
export { FitnessContentToolFactory } from './tools/FitnessContentToolFactory.mjs';
export { DashboardToolFactory } from './tools/DashboardToolFactory.mjs';
export { dashboardSchema } from './schemas/dashboard.mjs';
