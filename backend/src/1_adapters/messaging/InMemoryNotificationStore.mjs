/** Process-local notification repository for the legacy messaging surface. */
export class InMemoryNotificationStore {
  #records = new Map();

  async save(notification) {
    this.#records.set(notification.id, { ...notification, metadata: { ...(notification.metadata || {}) } });
  }

  async findById(id) {
    const record = this.#records.get(id);
    return record ? structuredClone(record) : null;
  }

  async findByRecipient(recipient) {
    return [...this.#records.values()]
      .filter((record) => record.recipient === recipient)
      .map((record) => structuredClone(record));
  }
}

export default InMemoryNotificationStore;
