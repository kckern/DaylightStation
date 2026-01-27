// backend/src/3_applications/nutribot/ports/INutriLogDatastore.mjs

/**
 * Port interface for NutriLog persistence
 * @class INutriLogDatastore
 */
export class INutriLogDatastore {
  async save(nutriLog) {
    throw new Error('INutriLogDatastore.save must be implemented');
  }

  async findById(userId, id) {
    throw new Error('INutriLogDatastore.findById must be implemented');
  }

  async findByDate(userId, date) {
    throw new Error('INutriLogDatastore.findByDate must be implemented');
  }

  async findByDateRange(userId, startDate, endDate) {
    throw new Error('INutriLogDatastore.findByDateRange must be implemented');
  }

  async findPending(userId) {
    throw new Error('INutriLogDatastore.findPending must be implemented');
  }

  async findAccepted(userId) {
    throw new Error('INutriLogDatastore.findAccepted must be implemented');
  }

  async updateStatus(userId, id, status) {
    throw new Error('INutriLogDatastore.updateStatus must be implemented');
  }

  async delete(userId, id) {
    throw new Error('INutriLogDatastore.delete must be implemented');
  }
}

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
