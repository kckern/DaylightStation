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

const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
const finiteNutrient = value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

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
    this.#foodIconsString = deps.foodIconsString || 'apple banana bread cheese chicken default';
    this.#iconVocabulary = iconVocabulary(this.#foodIconsString, deps.foodIconNames);
    this.#barcodeGenerator = deps.barcodeGenerator; // Optional: for generating barcode images
    this.#catalogService = deps.catalogService || null;
    this.#reviewService = deps.reviewService;
    this.#clock = deps.clock || { now: () => Date.now() };
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
      if (active.upc !== input.upc) throw Object.assign(new Error('Capture operation ID reused for another barcode'), { status: 409 });
      return active.promise;
    }
    const pending = (async () => {
      const existing = await this.#foodLogStore?.findById?.(input.userId, logId);
      if (existing) {
        if (existing.metadata?.sourceUpc !== input.upc) throw Object.assign(new Error('Capture operation ID reused for another barcode'), { status: 409 });
        if (existing.status === 'pending' && this.#reviewService) await this.#reviewService.capture({ userId: input.userId, logUuid: logId });
        return { success: true, nutrilogUuid: logId, committed: existing.status === 'accepted' || (existing.status === 'pending' && !!this.#reviewService),
          mealTime: existing.meal.time, alreadyProcessed: true };
      }
      return this.#execute({ ...input, captureId: logId });
    })();
    this.#inflight.set(logId, { upc: input.upc, promise: pending });
    try { return await pending; } finally { this.#inflight.delete(logId); }
  }
  async #execute(input) {
    const {
      userId, conversationId, upc, messageId,
      // The day the client is LOOKING AT (`YYYY-MM-DD`). ABSENT MEANS TODAY,
      // and absent is the ONLY thing Telegram/the scale ever send — which is
      // why `meal` is passed only when a date arrives, leaving NutriLog's own
      // clock default byte-identical for every existing caller.
      date: viewedDate = null,
      responseContext,
    } = input;

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
            product = {
              name: entry.name,
              brand: null,
              imageUrl: null,
              serving: entry.canonicalGrams > 0 ? { size: entry.canonicalGrams, unit: 'g' } : { size: 1, unit: 'serving' },
              icon: entry.icon,
              foodId: entry.id,
              nutrition: { ...entry.nutrients },
              nutritionLookup: { source: 'catalog', basis: entry.canonicalGrams > 0 ? 'serving' : 'unknown',
                missing: NUTRIENTS.filter(key => finiteNutrient(entry.nutrients?.[key]) === null),
                warnings: entry.canonicalGrams > 0 ? [] : ['Catalog serving mass is unknown; using one serving.'] },
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
            ...(catalogEntry?.iconOverride ? { icon: catalogEntry.iconOverride } : {}) };
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

      // 5. Create food item from product
      const grams = ['g', 'gram', 'grams'].includes(String(product.serving?.unit).toLowerCase())
        && Number(product.serving?.size) > 0 ? Number(product.serving.size) : null;
      const foodItem = {
        label: product.name,
        icon: catalogEntry?.iconOverride || confineIcon(product.icon && product.icon !== 'default' ? product.icon : classification.icon, this.#iconVocabulary, product.name),
        foodId: product.foodId || null,
        grams,
        unit: grams ? 'g' : product.serving?.unit || 'serving',
        amount: grams || (product.serving?.unit === 'ml' ? product.serving.size : 1),
        originalQuantity: { amount: product.serving?.size ?? 1, unit: product.serving?.unit || 'serving', grams },
        color: classification.noomColor,
        ...Object.fromEntries(NUTRIENTS.map(key => [key, finiteNutrient(product.nutrition?.[key])])),
        ...provisionalReview({}, this.#clock.now(), 'upc'),
        captureEvidence: { source: 'upc', upc, serving: product.serving, assumption: 'one-serving' },
      };
      if (this.#catalogService?.resolveIdentity) Object.assign(foodItem, await this.#catalogService.resolveIdentity(foodItem, userId));

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
        },
        timezone,
        timestamp: now,
      }, input.captureId ? { newId: () => input.captureId } : {});

      // 7. Save NutriLog
      if (this.#foodLogStore) {
        await this.#foodLogStore.save(nutriLog);
      }
      if (this.#reviewService) {
        await this.#reviewService.capture({ userId, logUuid: nutriLog.id });
        nutriLog = await this.#foodLogStore.findById(userId, nutriLog.id);
        capturedLog = nutriLog;
      }

      // 7b. Record food item in catalog for quick-add
      if (this.#catalogService && !product.nutritionLookup?.warnings?.length) {
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
        mealTime: nutriLog.meal.time,
      };
    } catch (error) {
      if (capturedLog) {
        this.#logger.warn?.('logUPC.savedDeliveryFailed', { upc, logUuid: capturedLog.id, error: error.message });
        return { success: true, nutrilogUuid: capturedLog.id, committed: true, mealTime: capturedLog.meal.time, deliveryFailed: true };
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

    const prompt = [
      {
        role: 'system',
        content: `You are matching food products to icon filenames. Available icons:
${this.#foodIconsString}

Choose the MOST relevant icon filename for the product and assign a Noom color:
- green: whole fruits, vegetables, leafy greens
- yellow: lean proteins, whole grains, legumes
- orange: processed foods, high-calorie items

Respond ONLY in JSON: { "icon": "apple", "noomColor": "green" }`,
      },
      {
        role: 'user',
        content: `Product: ${product.name}${product.brand ? ` by ${product.brand}` : ''}\nCalories: ${product.nutrition?.calories || 'unknown'}`,
      },
    ];

    const response = await this.#aiGateway.chat(prompt, { maxTokens: 100 });
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
