/**
 * Process Revision Input Use Case
 * @module nutribot/usecases/ProcessRevisionInput
 *
 * Processes user's revision text and updates the pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { formatFoodList, formatDateHeader } from '#domains/nutrition/entities/formatters.mjs';
import { repairTruncatedJson } from '../lib/repairJson.mjs';
import { buildCommittedChoices } from '../lib/committedChoices.mjs';
import { confineIcon, iconVocabulary } from '#domains/nutrition/services/icons.mjs';
import { capturedFoodGrams, capturedNutrientProvenance } from '#shared/contracts/health/foodQuantity.mjs';

/**
 * Process revision input use case
 */
export class ProcessRevisionInput {
  #messagingGateway;
  #aiGateway;
  #foodLogStore;
  #nutriListStore;
  #conversationStateStore;
  #config;
  #iconVocabulary;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    // The revision flow re-parses into the same row shape as the first capture
    // (decision log 2.2), so it is a THIRD place a model-named icon can reach a
    // stored row and must be confined the same way. Without the vocabulary
    // injected, every proposed icon collapses to the neutral sentinel — safe,
    // and visibly so, rather than silently storing a slug that 404s.
    this.#iconVocabulary = iconVocabulary(deps.foodIconsString, deps.foodIconNames);
    this.#logger = deps.logger || console;
  }

  /**
   * Get timezone from config
   * @private
   */
  #getTimezone() {
    return this.#config?.getDefaultTimezone?.() || 'America/Los_Angeles';
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
      const originalMessageId = state.flowState?.originalMessageId;

      // 2. Delete user's revision message
      if (messageId) {
        try {
          await messaging.deleteMessage(messageId);
        } catch (e) {
          // Ignore
        }
      }

      // 3. Show processing indicator on original message
      if (originalMessageId) {
        try {
          const processingButton = [[{ text: '⏳ Processing...', callback_data: 'noop' }]];
          await messaging.updateMessage(originalMessageId, {
            choices: processingButton,
            inline: true,
          });
        } catch (e) {
          this.#logger.debug?.('processRevision.processingIndicator.failed', { error: e.message });
        }
      }

      // 4. Load current log
      let nutriLog = null;
      if (this.#foodLogStore) {
        nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
      }

      if (!nutriLog) {
        return { success: false, error: 'Log not found' };
      }

      // 5. Call AI to apply revisions
      const prompt = this.#buildRevisionPrompt(nutriLog.items, text);
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

      // 6. Parse revised items
      const revisedItems = this.#carryForwardSettlement(
        nutriLog.items,
        this.#parseRevisionResponse(response),
      );

      if (revisedItems.length === 0) {
        await messaging.sendMessage("❓ I couldn't understand that revision. Try being more specific.", {});
        return { success: false, error: 'Could not parse revision' };
      }

      // 7. Commit to the authoritative ledger BEFORE updating capture evidence.
      // A concurrent web correction must reject the revision, not silently keep
      // the old ledger while the bot reports new totals as successfully saved.
      if (this.#nutriListStore?.syncFromLog) {
        await this.#nutriListStore.syncFromLog({
          id: nutriLog.id, uuid: nutriLog.uuid, userId, meal: nutriLog.meal,
          createdAt: nutriLog.createdAt, status: nutriLog.status,
          isAccepted: nutriLog.isAccepted ?? nutriLog.status === 'accepted', items: revisedItems,
        }, { revision: true });
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

      // 9. Show revised items with buttons
      const logDate = nutriLog.meal?.date || nutriLog.date;
      const dateHeader = logDate ? formatDateHeader(logDate, { timezone: this.#getTimezone(), now: new Date() }) : '';
      const foodList = formatFoodList(revisedItems);
      const buttons = this.#buildActionButtons(logUuid);
      const messageText = dateHeader ? `${dateHeader}\n\n${foodList}` : foodList;

      const isImageLog = nutriLog?.metadata?.source === 'image';
      if (originalMessageId) {
        const updatePayload = isImageLog ? { caption: messageText, choices: buttons, inline: true } : { text: messageText, choices: buttons, inline: true };
        await messaging.updateMessage(originalMessageId, updatePayload);
      } else {
        await messaging.sendMessage(messageText, {
          choices: buttons,
          inline: true,
        });
      }

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

Current items:
${currentJson}

Respond in JSON format with the COMPLETE revised list:
{
  "items": [
    {
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
          id: uuidv4(),
          label: item.name || item.label || 'Unknown',
          grams: capturedFoodGrams(item),
          originalQuantity: { grams: item.grams ?? null, amount: item.quantity ?? item.amount ?? null, unit: item.unit ?? null },
          nutrientProvenance: capturedNutrientProvenance(item, 'ai', capturedFoodGrams(item)),
          unit: item.unit || 'serving',
          amount: item.quantity || item.amount || 1,
          color: this.#normalizeNoomColor(item.noom_color || item.color),
          icon: confineIcon(item.icon, this.#iconVocabulary, item.name || item.label),
          calories: item.calories ?? 0,
          protein: item.protein ?? 0,
          carbs: item.carbs ?? 0,
          fat: item.fat ?? 0,
          fiber: item.fiber ?? 0,
          sugar: item.sugar ?? 0,
          sodium: item.sodium ?? 0,
          cholesterol: item.cholesterol ?? 0,
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

  /**
   * Carry the log's settlement state onto freshly re-parsed items.
   *
   * The AI returns raw items with no `settled` key, so without this a revision
   * would silently strip `settled: false` off an unsettled entry — split-brain
   * against rows already written at capture time. The absence rule still
   * governs: if the existing items carry no `settled` key (legacy row), the
   * revised ones don't either. Never defaulted.
   *
   * @private
   */
  #carryForwardSettlement(existingItems, revisedItems) {
    const wasUnsettled = (existingItems || []).some(item => item?.settled === false);
    if (!wasUnsettled) return revisedItems;
    return revisedItems.map(item => ({ ...item, settled: false }));
  }

  /**
   * Build action buttons.
   *
   * The log is already committed by the time a revision runs, so this offers the
   * committed keyboard (Undo / Edit) — never Accept, which `AcceptFoodLog`
   * would refuse with 'Log already processed'.
   * @private
   */
  #buildActionButtons(logUuid) {
    return buildCommittedChoices(logUuid);
  }
}

export default ProcessRevisionInput;
