// backend/src/3_applications/nutribot/ports/INutriListStore.mjs

/**
 * Port interface for denormalized NutriList persistence
 * @interface INutriListStore
 */
export const INutriListStore = {
  async syncFromLog(nutriLog) {},
  async addItem(userId, item) {},
  async getItemsForDate(userId, date) {},
  async getItemsForDateRange(userId, startDate, endDate) {},
  async findByLogId(userId, logId) {},
  async updateItem(userId, itemId, updates) {},
  async removeItem(userId, itemId) {},
  async removeByLogId(userId, logId) {}
};

export function isNutriListStore(obj) {
  return (
    obj &&
    typeof obj.syncFromLog === 'function' &&
    typeof obj.getItemsForDate === 'function' &&
    typeof obj.removeItem === 'function'
  );
}
