// backend/src/3_applications/nutribot/ports/index.mjs

// Persistence ports (class-based, moved from domain layer)
export { IFoodLogDatastore, isFoodLogDatastore, assertFoodLogDatastore } from './IFoodLogDatastore.mjs';
export { INutriCoachDatastore, isNutriCoachDatastore } from './INutriCoachDatastore.mjs';
export { INutriListDatastore, isNutriListDatastore } from './INutriListDatastore.mjs';
export { INutriLogDatastore, isNutriLogDatastore } from './INutriLogDatastore.mjs';

// Gateway ports
export { IMessagingGateway, isMessagingGateway } from './IMessagingGateway.mjs';
export { IResponseContext, isResponseContext } from './IResponseContext.mjs';
export { IFoodParser, isFoodParser } from './IFoodParser.mjs';
export { INutritionLookup, isNutritionLookup } from './INutritionLookup.mjs';
