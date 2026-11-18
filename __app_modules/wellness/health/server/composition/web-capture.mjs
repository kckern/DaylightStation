import { MealInstructionService } from "../application/health/MealInstructionService.mjs";
import { scopedGateway } from "#apps/common/ports/IAIGateway.mjs";
import { MealFoodCommands } from "../application/health/MealFoodCommands.mjs";
import { ReviseEntryService } from "../application/health/ReviseEntryService.mjs";
import { ReviseDishService } from "../application/health/ReviseDishService.mjs";
import { DayInstructionService } from "../application/health/DayInstructionService.mjs";
import { DayInstructionReader } from "../application/health/DayInstructionReader.mjs";
import { VoiceMemoStore } from "../adapters/persistence/VoiceMemoStore.mjs";

/** The Health services used by a web nutrition capture surface. */
export function createNutritionWebDependencies({ applicationInputRouter, aiGatewayAvailable, logger, nutribotServices, dataService }) {
  const container = nutribotServices.nutribotContainer;
  const nutritionItems = nutribotServices.nutriListStore;
  const mealCommands = new MealFoodCommands({ nutritionItems, logger });
  const entryRevisions = aiGatewayAvailable ? new ReviseEntryService({
    logger, nutritionItems, aiGateway: scopedGateway(container.getAIGateway(), { feature: 'revision' }),
  }) : null;
  const decisionGateway = container.getDecisionGateway();
  return {
    inputRouter: applicationInputRouter,
    mealInstructions: aiGatewayAvailable ? new MealInstructionService({
      logger, nutritionItems, foodLogStore: nutribotServices.foodLogStore,
      aiGateway: scopedGateway(container.getAIGateway(), { feature: 'meal-instruction' }), mealCommands,
    }) : null,
    dayInstructions: aiGatewayAvailable ? new DayInstructionService({
      logger, nutritionItems, mealCommands, entryRevisions,
      reader: new DayInstructionReader({ decisionGateway: scopedGateway(decisionGateway, { feature: 'day-instruction' }) }),
    }) : null,
    transcribeVoice: (fileId) => container.getMessagingGateway().transcribeVoice(fileId),
    entryRevisions,
    dishRevisions: aiGatewayAvailable ? new ReviseDishService({
      logger, nutritionItems, aiGateway: scopedGateway(container.getAIGateway(), { feature: 'revision' }), mealCommands,
    }) : null,
    foodLogStore: nutribotServices.foodLogStore,
    voiceMemoStore: new VoiceMemoStore({ dataService, logger }),
    logger,
  };
}
