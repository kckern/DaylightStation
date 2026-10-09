/** Existing fitness pose runtime assembly; preserves construction order. */
import { createPoseLogHandler as createPoseLogHandler } from "../adapters/PoseLogHandler.mjs";

export async function registerFitnessPoseRuntime(dependencies) {
  const { configService, rootLogger, eventBus } = dependencies;
const poseLogHandler = createPoseLogHandler(configService, rootLogger.child({ module: 'pose-log' }));
  eventBus.onClientMessage(poseLogHandler);
  eventBus.onClientDisconnection(poseLogHandler.onDisconnect);
  return {  };
}
