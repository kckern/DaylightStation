import { JudgeLessonSitting } from '../application/JudgeLessonSitting.mjs';
import { NodeAsyncScheduler } from '#adapters/scheduling/NodeAsyncScheduler.mjs';

/**
 * The session-level good-faith judge the piano progress store asks once per
 * finished lesson sitting. On when `videos.practice.good_faith_model` is true
 * (re-read per call, so a config reload takes effect). `decisionGateway`
 * arrives scoped to { app: 'piano', feature: 'lesson-good-faith' }.
 */
export function createLessonSittingJudge({ decisionGateway, configService, logger }) {
  return new JudgeLessonSitting({
    decisionGateway,
    enabled: () => configService?.getHouseholdAppConfig?.(null, 'piano')?.videos?.practice?.good_faith_model === true,
    timeoutMs: 8000,
    scheduler: new NodeAsyncScheduler(),
    logger: logger?.child ? logger.child({ module: 'piano-lesson-good-faith' }) : logger,
  });
}

export default createLessonSittingJudge;
