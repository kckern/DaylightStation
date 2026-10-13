import { ConfiguredSchoolLearningDirectory } from '../adapters/progress/ConfiguredSchoolLearningDirectory.mjs';

/** Household School roster policy; callers receive its read-side directory. */
export function createSchoolLearnerDirectory({userService,configService,householdId,logger}) {
  return new ConfiguredSchoolLearningDirectory({
    userService,
    config: configService.getHouseholdAppConfig(householdId, 'school') || {},
    householdId,
    logger,
  });
}
