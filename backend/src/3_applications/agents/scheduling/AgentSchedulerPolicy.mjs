export function agentSchedulerEnabled({ nodeEnv, enableCron, isContainer = false } = {}) {
  return nodeEnv === 'production' || isContainer || enableCron === 'true';
}
