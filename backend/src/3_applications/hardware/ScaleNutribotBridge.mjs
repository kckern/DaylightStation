//
// Bridges the food-scale event-bus topic into nutribot. The relay re-broadcasts the
// FULL ~4 Hz stream (each frame carries a `stable` flag), so we latch to fire exactly
// once per settle cycle — the same policy foodScaleRelay uses for persistence.
//
// Target chat + user are resolved at wiring time (household head) and passed in; the
// bridge itself is device-agnostic.

const DEFAULT_TOPICS = ['food-scale'];

export function createScaleNutribotBridge({ eventBus, nutribotContainer, userId, conversationId, scaleConfig, topics, logger = console }) {
  if (!eventBus?.subscribe) throw new Error('createScaleNutribotBridge: eventBus with subscribe required');
  if (!nutribotContainer?.getLogFoodFromScale) throw new Error('createScaleNutribotBridge: nutribotContainer required');

  const minGrams = scaleConfig?.minGrams ?? 5;
  const editDeltaG = scaleConfig?.editDeltaG ?? 3;
  const state = new Map();     // scaleId -> { logUuid, messageId, lastGrams }
  const inflight = new Set();  // scaleId currently dispatching (re-entrancy guard)

  const dispatch = (grams, extra) =>
    nutribotContainer.getLogFoodFromScale().execute({ userId, conversationId, grams, unit: 'g', ...extra });

  const onPayload = async (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    const grams = Math.round(Number(payload.grams));
    if (!Number.isFinite(grams)) return;

    // Item removed → re-arm for the next item.
    if (grams < minGrams) { state.delete(id); return; }
    // Wobble while loaded → ignore. This is what kills bump / re-settle spam.
    if (payload.stable !== true) return;

    const cur = state.get(id);
    // No-op fast paths that need no dispatch (checked before the in-flight guard so a
    // steady stable stream at the same weight never blocks on the guard).
    if (cur && Math.abs(grams - cur.lastGrams) < editDeltaG) return;
    if (inflight.has(id)) return; // a create/edit is already in flight for this scale
    inflight.add(id);

    try {
      if (!cur) {
        const res = await dispatch(grams, { scaleId: id });
        if (res?.success && res.logUuid) {
          state.set(id, { logUuid: res.logUuid, messageId: res.messageId || null, lastGrams: grams });
        }
      } else {
        const res = await dispatch(grams, { scaleId: id, existingLogUuid: cur.logUuid, messageId: cur.messageId });
        if (res?.success && res.logUuid) {
          state.set(id, { logUuid: res.logUuid, messageId: res.messageId || cur.messageId, lastGrams: grams });
        } else {
          state.set(id, { ...cur, lastGrams: grams });
        }
      }
    } catch (err) {
      logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message });
    } finally {
      inflight.delete(id);
    }
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', { conversationId, userId, minGrams, editDeltaG, topics: topics || DEFAULT_TOPICS });

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
