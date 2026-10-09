import { MealInstructionService } from "../application/health/MealInstructionService.mjs";
import { scopedGateway } from "#apps/common/ports/IAIGateway.mjs";
import { MealFoodCommands } from "../application/health/MealFoodCommands.mjs";
import { ReviseEntryService } from "../application/health/ReviseEntryService.mjs";
import { ReviseDishService } from "../application/health/ReviseDishService.mjs";
import { VoiceMemoStore } from "../adapters/persistence/VoiceMemoStore.mjs";

/** The Health services used by a web nutrition capture surface. */
export function createNutritionWebDependencies({ applicationInputRouter, aiGatewayAvailable, logger, nutribotServices, dataService }) {
  return {
    inputRouter: applicationInputRouter,
    mealInstructions: aiGatewayAvailable ? new MealInstructionService({
      logger,
      nutritionItems: nutribotServices.nutriListStore,
      foodLogStore: nutribotServices.foodLogStore,
      aiGateway: scopedGateway(nutribotServices.nutribotContainer.getAIGateway(), { feature: 'meal-instruction' }),
      mealCommands: new MealFoodCommands({ nutritionItems: nutribotServices.nutriListStore, logger }),
    }) : null,
    transcribeVoice: (fileId) => nutribotServices.nutribotContainer.getMessagingGateway().transcribeVoice(fileId),
    entryRevisions: aiGatewayAvailable ? new ReviseEntryService({
      logger,
      nutritionItems: nutribotServices.nutriListStore,
      aiGateway: scopedGateway(nutribotServices.nutribotContainer.getAIGateway(), { feature: 'revision' }),
    }) : null,
    dishRevisions: aiGatewayAvailable ? new ReviseDishService({
      logger,
      nutritionItems: nutribotServices.nutriListStore,
      aiGateway: scopedGateway(nutribotServices.nutribotContainer.getAIGateway(), { feature: 'revision' }),
      mealCommands: new MealFoodCommands({ nutritionItems: nutribotServices.nutriListStore, logger }),
    }) : null,
    foodLogStore: nutribotServices.foodLogStore,
    voiceMemoStore: new VoiceMemoStore({ dataService, logger }),
    logger,
  };
}
