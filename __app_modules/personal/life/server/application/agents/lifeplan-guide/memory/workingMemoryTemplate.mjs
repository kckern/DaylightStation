// __backend/src/3_applications/agents/lifeplan-guide/memory/workingMemoryTemplate.mjs
import { userWorkingMemoryTemplate as healthCoachWorkingMemoryTemplate } from "#apps/agents/framework/userWorkingMemoryTemplate.mjs";

/**
 * Lifeplan-guide reads/writes the SAME working memory template as
 * health-coach. Resource-scoped sharing means goal/focus updates
 * from either agent are visible to both.
 *
 * If lifeplan-guide grows its own observation fields, fork the
 * template here.
 */
export const lifeplanGuideWorkingMemoryTemplate = healthCoachWorkingMemoryTemplate;
export default lifeplanGuideWorkingMemoryTemplate;
