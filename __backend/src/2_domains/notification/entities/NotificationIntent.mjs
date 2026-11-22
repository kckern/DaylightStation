import { NotificationCategory } from '../value-objects/NotificationCategory.mjs';
import { NotificationUrgency } from '../value-objects/NotificationUrgency.mjs';
import { NotificationAction } from '../value-objects/NotificationAction.mjs';
import { NotificationPresentation } from '../value-objects/NotificationPresentation.mjs';

export class NotificationIntent {
  constructor({ id = null, title, body, category, urgency, recipient = null, presentation = null, actions = [], metadata = {}, dedupeKey, createdAt } = {}) {
    if (!NotificationCategory.isValid(category)) {
      throw new Error(`Invalid notification category: "${category}". Valid: ${NotificationCategory.values().join(', ')}`);
    }
    if (!NotificationUrgency.isValid(urgency)) {
      throw new Error(`Invalid notification urgency: "${urgency}". Valid: ${NotificationUrgency.values().join(', ')}`);
    }

    this.id = id;
    this.title = title;
    this.body = body;
    this.category = category;
    this.urgency = urgency;
    this.recipient = recipient?.username ? { username: recipient.username }
      : metadata?.username ? { username: metadata.username } : null;
    this.presentation = presentation ? NotificationPresentation.from(presentation)
      : NotificationPresentation.fromPushData(metadata?.pushData);
    // An action with an id is a push action (NotificationAction). One without is
    // an older in-app action ({label, action, data}) the frontend reads; it stays
    // as given and push adapters skip it.
    this.actions = (actions || []).map(a => (a instanceof NotificationAction || a?.id) ? NotificationAction.from(a) : a);
    this.metadata = metadata;
    this.dedupeKey = dedupeKey;
    this.createdAt = createdAt;
  }

}
