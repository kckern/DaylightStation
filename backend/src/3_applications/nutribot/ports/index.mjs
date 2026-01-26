// backend/src/3_applications/nutribot/ports/index.mjs

// Persistence ports (class-based, moved from domain layer)
export { IFoodLogStore, isFoodLogStore, assertFoodLogStore } from './IFoodLogStore.mjs';
export { INutriCoachStore, isNutriCoachStore } from './INutriCoachStore.mjs';
export { INutriListStore, isNutriListStore } from './INutriListStore.mjs';
export { INutriLogStore, isNutriLogStore } from './INutriLogStore.mjs';

// Gateway ports
export { IMessagingGateway, isMessagingGateway } from './IMessagingGateway.mjs';
export { IResponseContext, isResponseContext } from './IResponseContext.mjs';
export { IFoodParser, isFoodParser } from './IFoodParser.mjs';
export { INutritionLookup, isNutritionLookup } from './INutritionLookup.mjs';
