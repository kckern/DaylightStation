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
  const latched = new Map(); // scaleId -> boolean

  const onPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';
    const grams = Math.round(Number(payload.grams));
    const settled = payload.stable === true && Number.isFinite(grams) && grams >= minGrams;

    if (!settled) { latched.set(id, false); return; } // re-arm on change / near-zero
    if (latched.get(id)) return;                       // already fired this settle
    latched.set(id, true);

    Promise.resolve(
      nutribotContainer.getLogFoodFromScale().execute({
        userId, conversationId, grams, unit: payload.unit || 'g', scaleId: id,
      })
    ).catch((err) => logger.warn?.('scaleNutribot.dispatch.failed', { id, error: err.message }));
  };

  const unsubs = (topics && topics.length ? topics : DEFAULT_TOPICS).map((t) => eventBus.subscribe(t, onPayload));
  logger.info?.('scaleNutribot.bridge.ready', { conversationId, userId, minGrams, topics: topics || DEFAULT_TOPICS });

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createScaleNutribotBridge;
