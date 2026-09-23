/**
 * Log Food From UPC Use Case
 * @module nutribot/usecases/LogFoodFromUPC
 *
 * Looks up product by UPC barcode and creates a pending log.
 */

import { createNutriLog } from '../nutriLogRecords.mjs';
import { createLocalNutritionResponse } from '../services/LocalNutritionResponse.mjs';
import { getMealTimeFromHour, MealTimes } from '#domains/nutrition/entities/schemas.mjs';
import { formatLocalTimestamp } from '#domains/core/utils/time.mjs';
import { provisionalReview } from '#shared/contracts/nutrition/reviewLifecycle.mjs';
import { sha256Text } from '#system/utils/sha256.mjs';
import { confineIcon, iconVocabulary } from '#domains/nutrition/services/icons.mjs';
import { parseGtin } from '#domains/nutrition/services/gtin.mjs';
import { isQuarantined, quarantineMarker } from '#domains/nutrition/services/quarantine.mjs';
import { InvalidInputError } from '#apps/common/errors/SemanticErrors.mjs';
import { usableServing } from '#domains/health/entities/FoodCatalogEntry.mjs';

// The largest mass one label serving can plausibly be; an AI estimate above it is refused.
const MAX_ESTIMATED_SERVING_GRAMS = 500;
/** An AI calorie estimate for one serving outside this range is not used. */
const MAX_ESTIMATED_SERVING_KCAL = 2000;
const ESTIMATED_KEYS = ['calories', 'protein', 'carbs', 'fat'];
const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
// '' is unknown, not zero (`Number('')` is 0) — the same guard normalizeProductNutrition applies.
const finiteNutrient = value => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
// The code a capture is stored under: the collapsed GTIN when the raw read
// parses, else the raw input (which #execute will refuse).
const storedUpc = raw => { const gtin = parseGtin(raw); return gtin.ok ? gtin.code : raw; };

/** Code on the error a malformed barcode raises; every entry point translates it. */
export const UPC_REJECTED = 'NUTRIBOT_UPC_REJECTED';

/**
 * The label's own serving when it names a measurable one (`30 g`, `240 ml`),
 * else null (`1 serving`). An estimate asked FOR this serving shares its basis
 * with every other number the label gives.
 */
const measurableLabelServing = product => {
  const size = Number(product?.serving?.size);
  const unit = String(product?.serving?.unit || '').toLowerCase();
  return Number.isFinite(size) && size > 0 && unit && !['serving', 'servings'].includes(unit) ? { size, unit } : null;
};

/** No calories and no per-100 basis: only an estimate can make this countable. */
const needsNutritionEstimate = product => finiteNutrient(product?.nutrition?.calories) === null
  && product?.nutritionLookup?.servingFallback !== 'per100';

/**
 * The classifier's nutrition estimate, if it is usable: the product is food and
 * the calories are a finite number in 0–2000 for one serving. The serving mass
 * is kept only within the same bounds as a label-serving estimate (0 < g ≤ 500
 * and ≤ the package). Returns null when it cannot be used.
 */
export function usableNutritionEstimate(classification, { packageGrams = null } = {}) {
  if (classification?.isFood !== true || !classification.estimate || typeof classification.estimate !== 'object') return null;
  const { estimate } = classification;
  const calories = finiteNutrient(estimate.calories);
  if (calories === null || calories > MAX_ESTIMATED_SERVING_KCAL) return null;
  const maxGrams = Math.min(MAX_ESTIMATED_SERVING_GRAMS, Number(packageGrams) > 0 ? Number(packageGrams) : Infinity);
  const rawGrams = Number(estimate.servingGrams);
  const grams = Number.isFinite(rawGrams) && rawGrams > 0 && rawGrams <= maxGrams ? rawGrams : null;
  const values = { calories };
  for (const key of ESTIMATED_KEYS.slice(1)) { const value = finiteNutrient(estimate[key]); if (value !== null) values[key] = value; }
  return { grams, values };
}
// The message IS the sentence the person sees, on every transport.
const REFUSALS = {
  'check-digit': "That isn't a food barcode (check digit).",
  isbn: "That's a book (ISBN), not a food.",
  length: "That isn't a food barcode (wrong length).",
  empty: 'No barcode was read.',
};
const upcRejected = (reason, upc) => new InvalidInputError(REFUSALS[reason] || "That isn't a food barcode.",
  { code: UPC_REJECTED, context: { reason, upc } });

/**
 * Log food from UPC use case
 */
export class LogFoodFromUPC {
  #receipts;
  #messagingGateway;
  #upcGateway;
  #aiGateway;
  #googleImageGateway;
  #foodLogStore;
  #conversationStateStore;
  #config;
  #logger;
  #encodeCallback;
  #foodIconsString;
  #iconVocabulary;
  #barcodeGenerator;
  #catalogService;
  #reviewService;
  #photoStore;
  #inflight = new Map();
  #clock;

  constructor(deps) {
    this.#receipts = deps.receipts || (() => null);
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#upcGateway = deps.upcGateway;
    this.#aiGateway = deps.aiGateway;
    this.#googleImageGateway = deps.googleImageGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
    this.#foodIconsString = deps.foodIconsString || 'default';
    this.#iconVocabulary = iconVocabulary(this.#foodIconsString, deps.foodIconNames);
    this.#barcodeGenerator = deps.barcodeGenerator; // Optional: for generating barcode images
    this.#catalogService = deps.catalogService || null;
    this.#reviewService = deps.reviewService;
    this.#photoStore = deps.photoStore || null;
    this.#clock = deps.clock || { now: () => Date.now() };
  }

  /**
   * Download the product's own photo and stamp its `photoRef` onto the item.
   *
   * NEVER THROWS, and never blocks the food log: no photoStore, no URL, a dead
   * CDN link or a disk error all leave `photoRef` unset, which is the state
   * every UPC capture was in before this existed.
   *
   * The image is re-fetched per scan rather than cached against the catalog
   * entry, so scanning the same product twice stores the picture twice. That is
   * a handful of kilobytes against a pipeline that already round-trips a model
   * call; a `photoRef` on `FoodCatalogEntry` is the place to fix it properly.
   * @private
   */
  async #persistProductPhoto({ userId, upc, product, foodItem }) {
    // The catalog already holds this product's photo: reuse it, don't store a copy.
    if (product?.photoRef) { foodItem.photoRef = product.photoRef; return; }
    if (!this.#photoStore || !this.#upcGateway?.fetchImage || !product?.imageUrl) return;
    const buffer = await this.#upcGateway.fetchImage(product.imageUrl);
    if (!buffer) return;
    try {
      foodItem.photoRef = await this.#photoStore.save(userId, buffer);
      this.#logger.info?.('upc.photo.saved', { upc, userId, photoRef: foodItem.photoRef, bytes: buffer.length });
    } catch (error) {
      this.#logger.warn?.('upc.photo.save.failed', { upc, userId, error: error.message });
    }
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      sendPhoto: (src, caption, options) => this.#messagingGateway.sendPhoto(conversationId, src, caption, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const eventId = input.operationId || (input.messageId ? `${input.conversationId}:${input.messageId}` : null);
    if (!eventId) return this.#execute(input);
    const hash = sha256Text(`${input.userId}:upc:${eventId}`);
    const logId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    if (this.#inflight.has(logId)) {
      const active = this.#inflight.get(logId);
      if (active.upc !== storedUpc(input.upc)) throw Object.assign(new Error('Capture operation ID reused for another barcode'), { status: 409 });
      return active.promise;
    }
    const pending = (async () => {
      const existing = await this.#foodLogStore?.findById?.(input.userId, logId);
      if (existing) {
        if (existing.metadata?.sourceUpc !== storedUpc(input.upc)) throw Object.assign(new Error('Capture operation ID reused for another barcode'), { status: 409 });
        // A quarantined capture is pending on purpose; a replay must not accept it.
        const quarantined = isQuarantined(existing);
        if (existing.status === 'pending' && this.#reviewService && !quarantined) await this.#reviewService.capture({ userId: input.userId, logUuid: logId });
        return { success: true, nutrilogUuid: logId,
          committed: existing.status === 'accepted' || (existing.status === 'pending' && !!this.#reviewService && !quarantined),
          quarantined, mealTime: existing.meal.time, alreadyProcessed: true };
      }
      return this.#execute({ ...input, captureId: logId });
    })();
    this.#inflight.set(logId, { upc: storedUpc(input.upc), promise: pending });
    try { return await pending; } finally { this.#inflight.delete(logId); }
  }
  async #execute(input) {
    const {
      userId, conversationId, upc: rawUpc, messageId,
      // The day the client is LOOKING AT (`YYYY-MM-DD`). ABSENT MEANS TODAY,
      // and absent is the ONLY thing Telegram/the scale ever send — which is
      // why `meal` is passed only when a date arrives, leaving NutriLog's own
      // clock default byte-identical for every existing caller.
      date: viewedDate = null,
      responseContext,
    } = input;

    // Shape before lookup. Every UPC path (relay, HTTP, Telegram, web) lands here,
    // and only the relay parses the code first. A bad check digit, an ISBN from the
    // shared reader, or two reads glued together must not become a food.
    const gtin = parseGtin(rawUpc);
    if (!gtin.ok) {
      this.#logger.info?.('upc.rejected', { upc: rawUpc, reason: gtin.reason });
      throw upcRejected(gtin.reason, rawUpc);
    }
    const upc = gtin.code;
    if (gtin.collapsed) this.#logger.info?.('upc.collapsed', { raw: rawUpc, upc });

    this.#logger.debug?.('logUPC.start', { conversationId, upc, hasResponseContext: !!responseContext });

    let messaging = input.headless ? createLocalNutritionResponse() : this.#getMessaging(responseContext, conversationId);
    let status = null;
    let statusMsgId = null;
    let capturedLog = null;

    try {
      // 1. Delete original user message
      if (messageId) {
        try {
          await messaging.deleteMessage(messageId);
        } catch (e) {
          this.#logger.warn?.('logUPC.deleteOriginalFailed', { error: e.message });
        }
      }

      // 2. Create status indicator — photo with barcode if available, text otherwise
      const animationOpts = { frames: ['.', '..', '...'], interval: 2000 };
      const statusCaption = `🔍 Looking up barcode ${upc}`;

      if (this.#barcodeGenerator && messaging.createPhotoStatusIndicator) {
        let barcodeBuffer;
        try {
          barcodeBuffer = await this.#barcodeGenerator.generate(upc);
        } catch (e) {
          this.#logger.warn?.('logUPC.barcodeGenFailed', { upc, error: e.message });
        }
        if (barcodeBuffer) try {
          status = await messaging.createPhotoStatusIndicator(barcodeBuffer, statusCaption, animationOpts);
          statusMsgId = status.messageId;
        } catch (e) {
          this.#logger.warn?.('logUPC.deliveryUnavailable', { upc, error: e.message });
          // Telegram may have accepted the photo despite a lost response. Do
          // not fall back to another Telegram send and create a duplicate.
          messaging = createLocalNutritionResponse();
        }
      }

      if (!status) {
        try {
        if (messaging.createStatusIndicator) {
          status = await messaging.createStatusIndicator(statusCaption, animationOpts);
          statusMsgId = status.messageId;
        } else {
          const statusMsg = await messaging.sendMessage(`${statusCaption}...`);
          statusMsgId = statusMsg.messageId;
        }
        } catch (error) {
          this.#logger.warn?.('logUPC.deliveryUnavailable', { upc, error: error.message });
          messaging = createLocalNutritionResponse();
          status = null; statusMsgId = (await messaging.sendMessage(statusCaption)).messageId;
        }
      }

      // 3. Resolve product: user's catalog first (custom mappings win and can
      // override bad upstream data — spec Data model §3), then the gateway.
      let product = null;
      let catalogEntry = null;
      if (this.#catalogService?.getByUpc) {
        try {
          const entry = await this.#catalogService.getByUpc(upc, userId);
          if (entry) {
            catalogEntry = entry;
            // The mass the numbers describe, else the label serving an earlier
            // scan kept (a 325 ml shake has no grams, and is still a known
            // serving — not "one serving of unknown size").
            const known = entry.canonicalGrams > 0 ? { size: entry.canonicalGrams, unit: 'g' }
              : entry.serving?.grams > 0 ? { size: entry.serving.grams, unit: 'g' }
                : entry.serving ? { size: entry.serving.amount, unit: entry.serving.unit } : null;
            product = {
              name: entry.name,
              brand: null,
              imageUrl: null,
              serving: known || { size: 1, unit: 'serving' },
              icon: entry.icon,
              foodId: entry.id,
              photoRef: entry.photoRef || null,
              nutrition: { ...entry.nutrients },
              nutritionLookup: { source: 'catalog', basis: known ? 'serving' : 'unknown',
                missing: NUTRIENTS.filter(key => finiteNutrient(entry.nutrients?.[key]) === null),
                warnings: known ? [] : ['Catalog serving mass is unknown; using one serving.'] },
            };
            this.#logger.info?.('logUPC.catalogHit', { upc, name: entry.name });
          }
        } catch (e) {
          this.#logger.warn?.('logUPC.catalogLookupFailed', { upc, error: e.message });
        }
      }
      const incomplete = product && (product.nutritionLookup.basis === 'unknown' || product.nutritionLookup.missing.length);
      if ((!product || (incomplete && !catalogEntry?.manualPortion)) && this.#upcGateway) {
        try {
          const fresh = await this.#upcGateway.lookup(upc);
          if (fresh) product = { ...fresh, foodId: catalogEntry?.id || fresh.foodId,
            // Identity and explicit icon pins survive nutrition refreshes.
            ...(catalogEntry?.iconOverride ? { icon: catalogEntry.iconOverride } : {}),
            ...(catalogEntry?.photoRef ? { photoRef: catalogEntry.photoRef } : {}) };
        } catch (error) {
          if (!product) throw error;
          this.#logger.warn?.('logUPC.refreshFailed', { upc, error: error.message });
        }
      }

      if (!product) {
        if (status) {
          await status.finish(`❓ Product not found for barcode: ${upc}\n\nYou can describe the food instead.`);
        } else {
          await messaging.updateMessage(statusMsgId, {
            text: `❓ Product not found for barcode: ${upc}\n\nYou can describe the food instead.`,
          });
        }
        return { success: false, error: 'Product not found', unknownUpc: true, upc };
      }

      // 4. Classify product if AI available
      let classification = { icon: confineIcon(product.icon, this.#iconVocabulary, product.name), noomColor: 'yellow' };
      if (this.#aiGateway) {
        try {
          classification = await this.#classifyProduct(product);
          classification.icon = confineIcon(classification.icon, this.#iconVocabulary, product.name);
        } catch (e) {
          this.#logger.warn?.('upc.classify.failed', { upc, error: e.message });
        }

        if (!classification?.icon || classification.icon === 'default') {
          try {
            const icon = await this.#selectIconFromList(product);
            classification.icon = icon || 'default';
          } catch (e) {
            this.#logger.warn?.('upc.iconSelect.failed', { upc, error: e.message });
          }
        }
      }

      // 4b. A per-100 fallback is honest but rarely the portion eaten. The
      // classifier already running for the icon also estimates the label's
      // serving ("2 tbsp") in grams; the row stays unconfirmed, so the estimate is
      // reviewed like any other. Grams only: a millilitre fallback is never
      // turned into mass. One label serving is at most 500 g, and never more
      // than the whole package when its mass is known.
      let servingAssumption = product.nutritionLookup?.servingFallback === 'per100' ? 'per100' : 'one-serving';
      if (product.nutritionLookup?.servingFallback === 'per100' && product.serving?.unit === 'g'
        && classification?.servingGrams != null) {
        const estimate = Number(classification.servingGrams);
        const packageGrams = Number(product.nutritionLookup.packageGrams);
        const maxGrams = Math.min(MAX_ESTIMATED_SERVING_GRAMS, packageGrams > 0 ? packageGrams : Infinity);
        if (Number.isFinite(estimate) && estimate > 0 && estimate <= maxGrams) {
          const factor = estimate / 100;
          product = { ...product, serving: { size: estimate, unit: 'g' },
            nutrition: Object.fromEntries(Object.entries(product.nutrition || {})
              .map(([key, value]) => [key, value == null ? null : Math.round(value * factor * 1000) / 1000])),
            nutritionLookup: { ...product.nutritionLookup, servingEstimate: { source: 'ai', grams: estimate } } };
          servingAssumption = 'ai-serving-estimate';
          this.#logger.info?.('upc.serving.estimated', { upc, name: product.name, servingText: product.nutritionLookup.servingText || null, grams: estimate });
        } else {
          this.#logger.info?.('upc.serving.estimateRejected', { upc, name: product.name,
            servingText: product.nutritionLookup.servingText || null, grams: classification.servingGrams, maxGrams });
        }
      }

      // 4c. No calories and no per-100 basis. Quarantine used to be the only
      // outcome, which parks real food in Needs Review with a blank the person
      // must look up. The classifier's estimate for one typical serving is
      // logged instead, as an UNCONFIRMED AI estimate (per-nutrient provenance
      // 'ai', provisional review like every capture). Not food, or no usable
      // number: quarantine as before.
      let aiNutrition = null;
      if (this.#aiGateway && needsNutritionEstimate(product)) {
        const estimate = usableNutritionEstimate(classification, { packageGrams: product.nutritionLookup?.packageGrams });
        if (estimate) {
          // ONE basis for every number on the row:
          //  - the label names a measurable serving → the model was asked for
          //    exactly that serving, so label values stay as facts and the
          //    estimate only fills what the label lacks;
          //  - it does not → the estimate is for a typical serving whose mass
          //    the model gave. Label-only values describe a serving of unknown
          //    mass, so there is no common basis: they are dropped (null, no
          //    provenance). A rejected mass is "1 serving", never a gram mass
          //    that the numbers do not describe.
          const labelServing = measurableLabelServing(product);
          const label = product.nutrition || {};
          const nutrition = Object.fromEntries(NUTRIENTS.map(key => [key, labelServing ? finiteNutrient(label[key]) : null]));
          const filled = [];
          for (const [key, value] of Object.entries(estimate.values)) {
            if (nutrition[key] === null) { nutrition[key] = value; filled.push(key); }
          }
          const dropped = labelServing ? [] : NUTRIENTS.filter(key => finiteNutrient(label[key]) !== null && !filled.includes(key));
          const serving = labelServing
            ? product.serving
            : estimate.grams ? { size: estimate.grams, unit: 'g' } : { size: 1, unit: 'serving' };
          aiNutrition = { filled, grams: labelServing ? null : estimate.grams };
          product = { ...product, serving, nutrition,
            nutritionLookup: { ...(product.nutritionLookup || {}), aiEstimate: true,
              aiEstimateBasis: labelServing ? 'label-serving' : 'typical-serving',
              missing: NUTRIENTS.filter(key => nutrition[key] === null),
              ...(dropped.length ? { droppedLabelNutrients: dropped } : {}),
              ...(aiNutrition.grams ? { servingEstimate: { source: 'ai', grams: aiNutrition.grams } } : {}) } };
          servingAssumption = 'ai-nutrition-estimate';
          this.#logger.info?.('upc.nutrition.estimated', { upc, name: product.name, basis: labelServing ? 'label-serving' : 'typical-serving',
            grams: aiNutrition.grams, calories: nutrition.calories, dropped });
        } else {
          this.#logger.info?.('upc.nutrition.estimateRejected', { upc, name: product.name,
            isFood: classification?.isFood ?? null, calories: classification?.estimate?.calories ?? null });
        }
      }

      // 5. Create food item from product
      const grams = ['g', 'gram', 'grams'].includes(String(product.serving?.unit).toLowerCase())
        && Number(product.serving?.size) > 0 ? Number(product.serving.size) : null;
      // `confineIcon` answers 'default' for any slug outside the manifest, which
      // is the right refusal and was a SILENT one: a product could be scanned
      // nine times, classify cleanly every time (the Noom colour proves the model
      // answered), and land on the neutral dot without a single log line saying
      // the model's guess was not a slug we own. Name the miss.
      // Only a slug we own can outrank the classifier; the gateway used to stamp
      // every product with an emoji that won this contest and then failed it.
      const proposedIcon = product.icon && product.icon !== 'default' && this.#iconVocabulary.has(product.icon)
        ? product.icon : classification.icon;
      const resolvedIcon = catalogEntry?.iconOverride
        || confineIcon(proposedIcon, this.#iconVocabulary, product.name);
      if (resolvedIcon === 'default') {
        this.#logger.info?.('upc.icon.unresolved', { upc, name: product.name, proposedIcon: proposedIcon || null,
          fromCatalog: !!catalogEntry, hadClassifier: !!this.#aiGateway });
      }
      const foodItem = {
        label: product.name,
        icon: resolvedIcon,
        foodId: product.foodId || null,
        grams,
        unit: grams ? 'g' : product.serving?.unit || 'serving',
        amount: grams || (product.serving?.unit === 'ml' ? product.serving.size : 1),
        originalQuantity: { amount: product.serving?.size ?? 1, unit: product.serving?.unit || 'serving', grams },
        color: classification.noomColor,
        ...Object.fromEntries(NUTRIENTS.map(key => [key, finiteNutrient(product.nutrition?.[key])])),
        ...provisionalReview({}, this.#clock.now(), 'upc'),
        captureEvidence: { source: 'upc', upc, serving: product.serving, assumption: servingAssumption },
        ...(aiNutrition ? { nutrientProvenance: Object.fromEntries(aiNutrition.filled
          .map(key => [key, { source: 'ai', grams }])) } : {}),
      };
      if (this.#catalogService?.resolveIdentity) Object.assign(foodItem, await this.#catalogService.resolveIdentity(foodItem, userId));
      // Unknown calories (a known 0 is known) is not a food we can count. It stays
      // a pending capture — shown in Needs Review, outside the budget — instead of a
      // committed row that puts "+" on the day's totals. The marker on the log is
      // what keeps auto-report, confirm-all and capture recovery off it.
      const quarantined = foodItem.calories == null;

      // 5b. Keep the manufacturer's own photo. The row renders `photoRef` ahead
      // of any icon (EntryRow), so a real picture of the product beats the best
      // slug we could have guessed — and this pipeline was already FETCHING the
      // image URL and reporting `hasImage: true` before throwing it away.
      // Best-effort throughout: no photoStore, a dead link, or a disk error
      // leaves `photoRef` unset and the icon does its job.
      await this.#persistProductPhoto({ userId, upc, product, foodItem });

      // 6. Create NutriLog entity
      const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
      const now = new Date(this.#clock.now());
      // Decision 2.24: on a day that is not today the clock's hour names no
      // meal on that day, so the day is filled from its first one.
      const meal = viewedDate || MealTimes.includes(input.bucket)
        ? {
          date: viewedDate || formatLocalTimestamp(now, timezone).split(' ')[0],
          time: MealTimes.includes(input.bucket) ? input.bucket : viewedDate === formatLocalTimestamp(now, timezone).split(' ')[0]
            ? getMealTimeFromHour(Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(now)))
            : 'morning',
        }
        : undefined;
      let nutriLog = createNutriLog({
        userId,
        conversationId,
        items: [foodItem],
        ...(meal ? { meal } : {}),
        metadata: {
          source: 'upc',
          sourceUpc: upc,
          ...(product.nutritionLookup ? { nutritionLookup: product.nutritionLookup } : {}),
          ...(quarantined ? { ...quarantineMarker(), nutritionLookup: { ...product.nutritionLookup,
            missing: [...new Set([...(product.nutritionLookup?.missing || []), 'calories'])] } } : {}),
        },
        timezone,
        timestamp: now,
      }, input.captureId ? { newId: () => input.captureId } : {});

      // 7. Save NutriLog
      if (this.#foodLogStore) {
        await this.#foodLogStore.save(nutriLog);
        // Saved is final for a quarantined capture: nothing after this may undo it.
        if (quarantined) capturedLog = nutriLog;
      }
      if (this.#reviewService && !quarantined) {
        await this.#reviewService.capture({ userId, logUuid: nutriLog.id });
        nutriLog = await this.#foodLogStore.findById(userId, nutriLog.id);
        capturedLog = nutriLog;
      }
      if (quarantined) this.#logger.info?.('upc.quarantined', { upc, name: product.name, logUuid: nutriLog.id });

      // 7b. Record food item in catalog for quick-add
      // An AI estimate is not a label: it never seeds the catalog's UPC entry.
      if (this.#catalogService && !product.nutritionLookup?.warnings?.length && !quarantined && !aiNutrition) {
        try {
          await this.#catalogService.recordUsage({
            foodId: foodItem.foodId,
            name: foodItem.label,
            calories: foodItem.calories,
            protein: foodItem.protein,
            carbs: foodItem.carbs,
            fat: foodItem.fat,
            fiber: foodItem.fiber,
            sugar: foodItem.sugar,
            sodium: foodItem.sodium,
            cholesterol: foodItem.cholesterol,
            // The serving the panel describes, which is what makes this row an
            // observation rather than a bare total.
            grams: foodItem.grams,
            unit: foodItem.unit,
            amount: foodItem.amount,
            // PROVENANCE. This use case has always had the barcode in scope and
            // has always thrown it away, hard-coding `source: 'nutritionix'`
            // like the two AI capture paths — which is why all 683 catalog
            // entries claimed the same source and not one carried a UPC, across
            // 224 UPC logs. Writing it revives `getByUpc` and the UPC index,
            // and lets the derivation weight a manufacturer's own panel above a
            // model's guess. It does NOT gate anything: a source gate would
            // freeze 84% of these foods at whichever row wrote first.
            source: 'upc',
            barcodeUpc: upc,
            // What a later quick-add needs to reproduce THIS row: the label
            // serving (325 ml, grams only when the label gave them), the
            // product photo, and the picture. The resolved icon, never the
            // neutral 'default' — donating that would pin the food to the dot.
            serving: usableServing({ amount: product.serving?.size, unit: product.serving?.unit, grams }),
            photoRef: foodItem.photoRef || null,
            icon: foodItem.icon && foodItem.icon !== 'default' ? foodItem.icon : null,
            // The meal this row landed in and the capture that wrote it, so the
            // entry's bucket history advances and its observation is keyed.
            mealTime: nutriLog.meal?.time,
            logId: nutriLog.id,
          }, userId);
        } catch (err) {
          this.#logger.warn?.('nutribot.catalog.record_failed', { name: foodItem.label, error: err.message });
        }
      }

      // Keep the known status message. No delete-and-resend, and no uncertain
      // second send that could duplicate a successfully captured serving.
      await status?.release?.();
      const photoMsgId = statusMsgId;
      const caption = status?.kind === 'photo';

      // Reload after ledger acceptance so messaging never restores pending state.
      if (this.#foodLogStore && photoMsgId) {
        const latest = this.#foodLogStore.findById ? await this.#foodLogStore.findById(userId, nutriLog.id) : nutriLog;
        const updatedLog = latest.with({
          metadata: { ...latest.metadata, messageId: String(photoMsgId), messageKind: caption ? 'photo' : 'text' },
        }, new Date());
        await this.#foodLogStore.save(updatedLog);
      }
      await this.#receipts()?.bind(userId, nutriLog.id, { conversationId, messageId: photoMsgId, caption });

      this.#logger.info?.('logUPC.complete', {
        conversationId,
        upc,
        productName: product.name,
        logUuid: nutriLog.id,
      });

      return {
        success: true,
        nutrilogUuid: nutriLog.id,
        product,
        committed: nutriLog.status === 'accepted',
        quarantined,
        ...(aiNutrition ? { aiEstimate: true } : {}),
        mealTime: nutriLog.meal.time,
      };
    } catch (error) {
      if (capturedLog) {
        this.#logger.warn?.('logUPC.savedDeliveryFailed', { upc, logUuid: capturedLog.id, error: error.message });
        return { success: true, nutrilogUuid: capturedLog.id, committed: capturedLog.status === 'accepted',
          quarantined: isQuarantined(capturedLog), mealTime: capturedLog.meal.time, deliveryFailed: true };
      }
      this.#logger.error?.('logUPC.error', { conversationId, upc, error: error.message });

      if (status || statusMsgId) {
        try {
          const isNetworkError = error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'EAI_AGAIN';
          const errorMsg = isNetworkError ? `⚠️ Network timeout looking up barcode ${upc}\n\nPlease try again.` : `❌ Error looking up barcode ${upc}\n\n${error.message}`;
          if (status) {
            await status.finish(errorMsg);
          } else {
            await messaging.updateMessage(statusMsgId, { text: errorMsg });
          }
        } catch (e) {
          this.#logger.debug?.('logUPC.updateError.failed', { error: e.message });
        }
      }

      throw error;
    } finally {
      await status?.release?.();
    }
  }

  /**
   * Select icon from list
   * @private
   */
  async #selectIconFromList(product) {
    if (!this.#aiGateway) return 'default';

    const availableIcons = this.#foodIconsString.split(' ');

    const prompt = [
      {
        role: 'system',
        content: `Pick the best matching icon filename for the product from this list:
${this.#foodIconsString}

Respond ONLY as JSON: { "icon": "<filename>" }`,
      },
      {
        role: 'user',
        content: `Product: ${product.name}${product.brand ? ` by ${product.brand}` : ''}
Calories: ${product.nutrition?.calories ?? 'unknown'}`,
      },
    ];

    const response = await this.#aiGateway.chat(prompt, { maxTokens: 40 });
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) return 'default';
    const parsed = JSON.parse(match[0]);
    const icon = parsed.icon;
    if (availableIcons.includes(icon)) return icon;
    return 'default';
  }

  /**
   * Classify product using AI
   * @private
   */
  async #classifyProduct(product) {
    const availableIcons = this.#foodIconsString.split(' ');
    // Only a per-100 GRAM fallback asks for a serving estimate; every other
    // product keeps the original { icon, noomColor } contract. A volume is never
    // turned into grams, so a millilitre fallback is not asked.
    const askServing = product.nutritionLookup?.servingFallback === 'per100' && product.serving?.unit === 'g';
    const servingText = product.nutritionLookup?.servingText || null;
    // No calories and no per-100 basis: nothing on the label can be counted.
    // The same call also says whether this is food at all and, if so, what one
    // typical serving holds — logged as an unconfirmed AI estimate, never a fact.
    const askNutrition = needsNutritionEstimate(product);
    const labelServing = askNutrition ? measurableLabelServing(product) : null;
    const example = askNutrition
      ? '{ "icon": "apple", "noomColor": "green", "isFood": true, "estimate": { "servingGrams": 30, "calories": 120, "protein": 3, "carbs": 20, "fat": 4 } }'
      : askServing ? '{ "icon": "apple", "noomColor": "green", "servingGrams": 30 }' : '{ "icon": "apple", "noomColor": "green" }';
    const servingRule = askNutrition
      ? '\nThe label gives no calories. Set "isFood" to false if this product is not something people eat or drink (a magazine, soap, a gift card, pet supplies). '
        + (labelServing
          ? `If it is food, estimate for THE LABEL SERVING OF ${labelServing.size} ${labelServing.unit} as "estimate": its calories, protein, carbs and fat in grams for exactly that serving (numbers; "servingGrams" is ${labelServing.unit === 'g' ? labelServing.size : 'null'}).`
          : 'If it is food, estimate one typical serving as "estimate": its mass in grams ("servingGrams") and its calories, protein, carbs and fat in grams for that serving (numbers).')
      : askServing
        ? (servingText
          ? '\nThe calories given are per 100 g. Also estimate the mass in grams of the label serving as "servingGrams" (number, or null if unknowable).'
          : '\nThe calories given are per 100 g and the label gives no serving size. Also estimate the mass in grams of ONE TYPICAL SERVING of this product as "servingGrams" (a number: e.g. shredded cheese is about 28, peanut butter about 32).')
        : '';
    const caloriesLine = askNutrition && labelServing
      ? `Calories: unknown\nLabel serving: ${labelServing.size} ${labelServing.unit}`
      : askServing
      ? `Calories per 100 g: ${product.nutrition?.calories ?? 'unknown'}\nLabel serving: ${servingText || 'unknown'}`
      : `Calories: ${product.nutrition?.calories ?? 'unknown'}`;
    const prompt = [
      {
        role: 'system',
        content: `You are matching food products to icon filenames. Available icons:
${this.#foodIconsString}

Choose the MOST relevant icon filename for the product and assign a Noom color:
- green: whole fruits, vegetables, leafy greens
- yellow: lean proteins, whole grains, legumes
- orange: processed foods, high-calorie items

Respond ONLY in JSON: ${example}${servingRule}`,
      },
      {
        role: 'user',
        content: `Product: ${product.name}${product.brand ? ` by ${product.brand}` : ''}\n${caloriesLine}`,
      },
    ];

    const response = await this.#aiGateway.chat(prompt, { maxTokens: askNutrition ? 200 : 100 });
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (!availableIcons.includes(parsed.icon)) {
        parsed.icon = 'default';
      }
      return parsed;
    }
    return { icon: 'default', noomColor: 'yellow' };
  }


}

export default LogFoodFromUPC;
