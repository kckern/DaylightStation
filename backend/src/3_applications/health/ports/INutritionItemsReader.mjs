/**
 * Read-only port for structured nutrition items by date.
 * Decouples health domain from nutribot's INutriListDatastore.
 */
export class INutritionItemsReader {
  async findByDateRange(userId, startDate, endDate) {
    throw new Error('Not implemented');
  }
}

export default INutritionItemsReader;
