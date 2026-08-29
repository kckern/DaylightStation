/** Projects flashcard scheduler policy without exposing ConfigService to the application layer. */
export class ConfigFlashcardSchedulerPolicySource {
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdAppConfig || !configService?.getUserProfile) {
      throw new Error('ConfigFlashcardSchedulerPolicySource requires configService');
    }
    this.configService = configService;
  }

  householdScheduler = () => (
    this.configService.getHouseholdAppConfig(null, 'school')?.flashcards?.scheduler ?? {}
  );

  learnerScheduler = (userId) => (
    this.configService.getUserProfile(userId)?.apps?.school?.flashcards?.scheduler ?? {}
  );
}

export default ConfigFlashcardSchedulerPolicySource;
