import { serializeFoodItem } from '#shared/contracts/nutrition/foodItemRecord.mjs';
export { serializeFoodItem };

export function serializeNutriLog(log) {
  const record = {
    id: log.id,
    userId: log.userId,
    status: log.status,
    text: log.text,
    meal: log.meal,
    items: log.items.map(serializeFoodItem),
    questions: log.questions,
    nutrition: log.nutrition,
    metadata: log.metadata,
    timezone: log.timezone,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
    acceptedAt: log.acceptedAt,
  };
  if (log.conversationId !== log.userId) record.conversationId = log.conversationId;
  return record;
}
