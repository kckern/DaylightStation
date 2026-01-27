// backend/src/3_applications/nutribot/ports/INutriLogDatastore.mjs

/**
 * Port interface for NutriLog persistence
 * @interface INutriLogDatastore
 */
export const INutriLogDatastore = {
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
 * Validate object implements INutriLogDatastore
 * @param {Object} obj
 * @returns {boolean}
 */
export function isNutriLogDatastore(obj) {
  return (
    obj &&
    typeof obj.save === 'function' &&
    typeof obj.findById === 'function' &&
    typeof obj.findPending === 'function' &&
    typeof obj.updateStatus === 'function'
  );
}
