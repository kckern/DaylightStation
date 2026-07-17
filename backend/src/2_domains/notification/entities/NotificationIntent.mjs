import { NotificationCategory } from '../value-objects/NotificationCategory.mjs';
import { NotificationUrgency } from '../value-objects/NotificationUrgency.mjs';

export class NotificationIntent {
  constructor({ title, body, category, urgency, actions = [], metadata = {}, dedupeKey } = {}) {
    if (!NotificationCategory.isValid(category)) {
      throw new Error(`Invalid notification category: "${category}". Valid: ${NotificationCategory.values().join(', ')}`);
    }
    if (!NotificationUrgency.isValid(urgency)) {
      throw new Error(`Invalid notification urgency: "${urgency}". Valid: ${NotificationUrgency.values().join(', ')}`);
    }

    this.title = title;
    this.body = body;
    this.category = category;
    this.urgency = urgency;
    this.actions = actions;
    this.metadata = metadata;
    this.dedupeKey = dedupeKey;
    this.createdAt = new Date().toISOString();
  }

  toJSON() {
    return {
      title: this.title,
      body: this.body,
      category: this.category,
      urgency: this.urgency,
      actions: this.actions,
      metadata: this.metadata,
      dedupeKey: this.dedupeKey,
      createdAt: this.createdAt,
    };
  }
}
