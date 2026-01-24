// backend/src/3_applications/nutribot/ports/INutriLogStore.mjs

/**
 * Port interface for NutriLog persistence
 * @interface INutriLogStore
 */
export const INutriLogStore = {
  async save(nutriLog) {},
  async findById(userId, id) {},
  async findByDate(userId, date) {},
  async findByDateRange(userId, startDate, endDate) {},
  async findPending(userId) {},
  async findAccepted(userId) {},
  async updateStatus(userId, id, status) {},
  async delete(userId, id) {}
};

/**
 * Validate object implements INutriLogStore
 * @param {Object} obj
 * @returns {boolean}
 */
export function isNutriLogStore(obj) {
  return (
    obj &&
    typeof obj.save === 'function' &&
    typeof obj.findById === 'function' &&
    typeof obj.findPending === 'function' &&
    typeof obj.updateStatus === 'function'
  );
}
