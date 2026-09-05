import { serializeFoodItem } from '#shared/contracts/nutrition/foodItemRecord.mjs';

/**
 * HTTP projection for a pending NutriLog on the web Today view's
 * "Needs review" surface (root-cause fix: pending logs created off-surface —
 * Telegram, the scale bridge, a failed AI call — were invisible there since
 * a pending log never syncs into the nutrilist).
 */

/**
 * A pending NutriLog's originating surface. `metadata.source` on the log
 * records the INPUT TYPE (text/image/upc/voice/scale), not the platform —
 * text/image/upc/voice all run through both Telegram and the web UI. The
 * scale bridge is the one input type that's platform-exclusive, so it's
 * checked first; otherwise the platform is read off conversationId, which
 * WebNutribotAdapter always stamps `web:{userId}` and the Telegram webhook
 * always stamps a bare chat id (see IInputEvent#toInputEvent).
 */
export function deriveNutritionLogSource(log) {
  if (log?.metadata?.source === 'scale') return 'scale';
  const conversationId = log?.conversationId;
  if (typeof conversationId === 'string' && conversationId.startsWith('web:')) return 'web';
  if (typeof conversationId === 'string' && conversationId.startsWith('device:')) return 'scanner';
  return 'telegram';
}

export function presentPendingNutritionLog(log) {
  return {
    id: log.id,
    createdAt: log.createdAt,
    version: log.version,
    date: log.meal?.date,
    captureMethod: log.metadata?.source ?? 'unknown',
    nutritionLookup: log.metadata?.nutritionLookup ?? null,
    source: deriveNutritionLogSource(log),
    mealTime: log.meal?.time ?? null,
    items: (log.items || []).map(serializeFoodItem),
  };
}
