/**
 * Process Revision Input Use Case
 * @module nutribot/usecases/ProcessRevisionInput
 *
 * Applies an explicit user revision against a versioned current-ledger snapshot.
 */

import { v4 as uuidv4 } from 'uuid';
import { repairTruncatedJson } from '../lib/repairJson.mjs';
import { confineIcon, iconVocabulary } from '#domains/nutrition/services/icons.mjs';
import { capturedFoodGrams, capturedNutrientProvenance } from '#shared/contracts/health/foodQuantity.mjs';
import { confirmReview } from '#shared/contracts/nutrition/reviewLifecycle.mjs';
import { validateFoodItem, validateMealTime } from '#domains/nutrition/entities/schemas.mjs';
import { isISODate } from '#shared/contracts/health/isoDate.mjs';

/**
 * Process revision input use case
 */
export class ProcessRevisionInput {
  #receipts;
  #messagingGateway;
  #aiGateway;
  #foodLogStore;
  #nutriListStore;
  #conversationStateStore;
  #iconVocabulary;
  #logger;

  constructor(deps) {
    this.#receipts = deps.receipts || (() => null);
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#conversationStateStore = deps.conversationStateStore;
    // The revision flow re-parses into the same row shape as the first capture
    // (decision log 2.2), so it is a THIRD place a model-named icon can reach a
    // stored row and must be confined the same way. Without the vocabulary
    // injected, every proposed icon collapses to the neutral sentinel — safe,
    // and visibly so, rather than silently storing a slug that 404s.
    this.#iconVocabulary = iconVocabulary(deps.foodIconsString, deps.foodIconNames);
    this.#logger = deps.logger || console;
  }

  #getMessaging(responseContext, conversationId) {
    if (responseContext) return responseContext;
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
    };
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, text, messageId, responseContext } = input;

    this.#logger.debug?.('processRevision.start', { conversationId });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 1. Get current state
      let state = null;
      if (this.#conversationStateStore) {
        state = await this.#conversationStateStore.get(conversationId);
      }

      if (!state || state.activeFlow !== 'revision') {
        return { success: false, error: 'Not in revision mode' };
      }

      const logUuid = state.flowState?.pendingLogUuid;

      // 2. Delete user's revision message
      if (messageId) {
        try {
          await messaging.deleteMessage(messageId);
        } catch (e) {
          // Ignore
        }
      }

      await this.#receipts()?.interaction(userId, logUuid, 'processing');

      // 4. Load current log
      let nutriLog = null;
      if (this.#foodLogStore) {
        nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
      }

      if (!nutriLog) {
        return { success: false, error: 'Log not found' };
      }

      // The model sees the CURRENT ledger, including prior Health/Mastra edits.
      // Keep its version snapshot through the AI call for commit-time fencing.
      const ledger = nutriLog.status !== 'pending' && this.#nutriListStore?.findByLogId
        ? await this.#nutriListStore.findByLogId(userId, nutriLog.id) : null;
      if (ledger && !ledger.length) throw Object.assign(new Error('Food entries no longer exist'), { status: 409 });
      const currentItems = ledger || nutriLog.items;
      const prompt = this.#buildRevisionPrompt(currentItems, text);
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

      // 6. Parse revised items
      const revisedItems = this.#mergeUserRevision(
        currentItems,
        this.#parseRevisionResponse(response),
      );

      if (revisedItems.length === 0) {
        await this.#receipts()?.interaction(userId, logUuid, 'revision');
        await messaging.sendMessage("❓ I couldn't understand that revision. Try being more specific.", {});
        return { success: false, error: 'Could not parse revision' };
      }

      // 7. Commit to the authoritative ledger BEFORE updating capture evidence.
      // A concurrent web correction must reject the revision, not silently keep
      // the old ledger while the bot reports new totals as successfully saved.
      if (this.#nutriListStore?.syncFromLog) {
        await this.#nutriListStore.syncFromLog({
          id: nutriLog.id, uuid: nutriLog.uuid, userId, meal: nutriLog.meal,
          createdAt: nutriLog.createdAt, status: ledger?.length ? 'accepted' : nutriLog.status,
          isAccepted: !!ledger?.length || (nutriLog.isAccepted ?? nutriLog.status === 'accepted'), items: revisedItems,
        }, { revision: true, expectedVersions: ledger?.map(row => ({ id: row.uuid || row.id, version: row.version ?? 1 })) });
      }
      if (this.#foodLogStore) {
        await this.#foodLogStore.updateItems(userId, logUuid, revisedItems);
      }

      // 8. Update state back to confirmation
      if (this.#conversationStateStore) {
        const newState = {
          conversationId,
          activeFlow: 'food_confirmation',
          flowState: { pendingLogUuid: logUuid },
        };
        await this.#conversationStateStore.set(conversationId, newState);
      }

      await this.#receipts()?.interaction(userId, logUuid, null);

      this.#logger.info?.('processRevision.complete', {
        conversationId,
        logUuid,
        itemCount: revisedItems.length,
      });

      return {
        success: true,
        logUuid,
        itemCount: revisedItems.length,
      };
    } catch (error) {
      const state = await this.#conversationStateStore?.get(conversationId);
      if (state?.flowState?.pendingLogUuid) await this.#receipts()?.interaction(userId, state.flowState.pendingLogUuid, 'revision');
      this.#logger.error?.('processRevision.error', { conversationId, error: error.message });
      throw error;
    }
  }

  /**
   * Build revision prompt
   * @private
   */
  #buildRevisionPrompt(currentItems, revisionText) {
    const currentJson = JSON.stringify(currentItems, null, 2);

    return [
      {
        role: 'system',
        content: `You are a food log editor. Given the current food items and a revision instruction:
1. Apply the requested changes
2. Keep unchanged items as-is (including their noom_color)
3. Re-estimate macros for any modified items
4. Assign noom_color for new items: "green" (low cal density), "yellow" (moderate), or "orange" (high cal density)
5. Use Title Case for all food names (e.g., "Grilled Chicken Breast", "Mashed Potatoes")
6. Keep each existing item's id (use uuid when present), kind, parentId, date and mealTime. Use id:null only for genuinely new food requested by the user. Never invent new group headers.
7. Keep unknown nutrients null and unchanged fields exactly as supplied. Preserve groups and quantities unless the user asked to change them.

Current items:
${currentJson}

Respond in JSON format with the COMPLETE revised list:
{
  "items": [
    {
      "id": "existing uuid, or null for new food",
      "name": "Food Name In Title Case",
      "noom_color": "green|yellow|orange",
      "quantity": 1,
      "unit": "piece|cup|tbsp|g|oz",
      "grams": 100,
      "calories": 150,
      "protein": 10,
      "carbs": 15,
      "fat": 5
    }
  ]
}

Noom colors:
- green: lowest calorie density (vegetables, fruits, lean proteins, whole grains)
- yellow: moderate calorie density (grains, legumes, lean meats, dairy)
- orange: highest calorie density (nuts, oils, sweets, fried foods, processed foods)`,
      },
      {
        role: 'user',
        content: `Apply this revision: "${revisionText}"`,
      },
    ];
  }

  /**
   * Parse revision response
   * @private
   */
  #parseRevisionResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}?/);
      if (jsonMatch) {
        let data;
        try {
          data = JSON.parse(jsonMatch[0]);
        } catch {
          data = repairTruncatedJson(jsonMatch[0]);
          if (data) {
            this.#logger.warn?.('processRevision.parseRepaired', { itemCount: data.items?.length || 0 });
          }
        }
        if (!data) return [];
        const rawItems = data.items || [];

        return rawItems.map((item) => ({
          id: item.id || item.uuid || null,
          ...Object.fromEntries(['date', 'mealTime', 'kind', 'parentId', 'unit', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol']
            .filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])),
          ...(item.name || item.label ? { label: item.name || item.label } : {}),
          ...(Object.hasOwn(item, 'grams') ? { grams: capturedFoodGrams(item) } : {}),
          ...(Object.hasOwn(item, 'quantity') || Object.hasOwn(item, 'amount') ? { amount: item.quantity ?? item.amount } : {}),
          ...(item.noom_color || item.color ? { color: this.#normalizeNoomColor(item.noom_color || item.color) } : {}),
          ...(Object.hasOwn(item, 'icon') ? { icon: confineIcon(item.icon, this.#iconVocabulary, item.name || item.label) } : {}),
        }));
      }
      return [];
    } catch (e) {
      this.#logger.warn?.('processRevision.parseError', { error: e.message });
      return [];
    }
  }

  /**
   * Normalize Noom color
   * @private
   */
  #normalizeNoomColor(color) {
    if (!color) return 'yellow';
    const normalized = color.toLowerCase().trim();
    if (['green', 'yellow', 'orange', 'red'].includes(normalized)) {
      return normalized === 'red' ? 'orange' : normalized;
    }
    return 'yellow';
  }

  /** Keep stable identity, grouping, placement and provenance from the ledger.
   * Only explicit changed fields become user-protected; missing AI keys are not
   * permission to erase a prior Health or reviewer correction. */
  #mergeUserRevision(existingItems, revisedItems) {
    const used = new Set();
    const merged = revisedItems.map(item => {
      const original = existingItems.find(row => item.id && [row.uuid, row.id].includes(item.id))
        || (!item.id && existingItems.find(row => (row.name || row.label || row.item) === item.label));
      if (item.id && !original) throw Object.assign(new Error('Revision returned an unknown food ID'), { status: 409 });
      const id = original?.uuid || original?.id || uuidv4();
      if (used.has(id)) throw new Error('Revision repeated a food item');
      used.add(id);
      const values = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
      const fields = Object.keys(values).filter(key => !['id', 'originalQuantity', 'nutrientProvenance'].includes(key)
        && JSON.stringify(values[key]) !== JSON.stringify(key === 'label' ? original?.name || original?.label || original?.item : original?.[key]));
      if (values.kind === 'group' && original?.kind !== 'group') throw new Error('Revision cannot invent a group');
      if (original?.kind === 'group' && values.kind && values.kind !== 'group') throw new Error('Revision cannot turn a group into food');
      const result = { ...original, ...values, id: original?.id || id, uuid: id,
        ...(fields.length ? confirmReview(original || item, Date.now()) : {}),
        manualFields: [...new Set([...(original?.manualFields || []), ...fields])],
      };
      if (!original) {
        result.grams = capturedFoodGrams(result);
        result.unit ??= 'serving'; result.amount ??= 1;
        result.color ??= 'yellow'; result.label ??= 'Unknown';
        result.icon ??= confineIcon(null, this.#iconVocabulary, result.label);
        result.originalQuantity = { grams: result.grams, amount: result.amount, unit: result.unit };
        result.nutrientProvenance = capturedNutrientProvenance(result, 'ai', result.grams);
      }
      if (result.kind === 'group') {
        result.grams = null;
        for (const field of ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol']) result[field] = 0;
      }
      result.label ??= result.name || result.item;
      const validation = validateFoodItem(result);
      if (!validation.valid || (result.date && !isISODate(result.date))
        || (result.mealTime != null && !validateMealTime(result.mealTime).valid)) {
        throw Object.assign(new Error('Invalid food revision; check the quantities and nutrition'), { status: 400 });
      }
      return result;
    });
    for (const item of merged) {
      if (item.parentId && !merged.some(parent => parent.kind === 'group' && [parent.id, parent.uuid].includes(item.parentId))) {
        throw new Error('Revision would leave food without its group');
      }
    }
    return merged;
  }
}

export default ProcessRevisionInput;
