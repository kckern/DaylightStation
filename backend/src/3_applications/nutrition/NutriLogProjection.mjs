export function serializeFoodItem(item) {
  return {
    id: item.id,
    uuid: item.uuid,
    label: item.label,
    icon: item.icon,
    grams: item.grams,
    unit: item.unit,
    amount: item.amount,
    color: item.color,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    fiber: item.fiber,
    sugar: item.sugar,
    sodium: item.sodium,
    cholesterol: item.cholesterol,
    // Lifecycle / group fields. `settled` is absence-sensitive: an absent key
    // means "legacy row, treat as settled", so it is only emitted when present.
    kind: item.kind,
    parentId: item.parentId,
    photoRef: item.photoRef,
    ...(item.settled !== undefined ? { settled: item.settled } : {}),
    settledBy: item.settledBy,
    settledAt: item.settledAt,
    microsSource: item.microsSource,
  };
}

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
