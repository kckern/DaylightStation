import { createTool } from "../ports/ITool.mjs";
import { serializeFoodItem } from "#shared/contracts/nutrition/foodItemRecord.mjs";
import { CLEANUP_NUMBERS, entryKey } from "#domains/nutrition/services/cleanupPolicy.mjs";

/** Reusable read-only nutrition evidence tools. Ownership is bound by the application, never by model arguments. */
export class NutritionEvidenceToolFactory {
  constructor(deps) { Object.assign(this, deps); }
  createTools({ userId, snapshot, remember }) {
    return [
      createTool({ name: 'search_food_history', description: 'Search this user’s complete nutrition history; reference only, never proof of current consumption.',
        parameters: { type: 'object', properties: { query: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['query'] },
        execute: async ({ query, offset = 0 }) => {
          const all = await this.items.findByDateRange(userId, '0001-01-01', '9999-12-31');
          const found = all.filter(row => String(row.name || row.label || row.item).toLowerCase().includes(query.toLowerCase()));
          return remember('history', { rows: found.slice(offset, offset + 30), total: found.length, nextOffset: offset + 30 < found.length ? offset + 30 : null });
        } }),
      createTool({ name: 'read_capture', description: 'Read original capture text, barcode, source metadata and pending items for this user.',
        parameters: { type: 'object', properties: { logId: { type: 'string' } }, required: ['logId'] },
        execute: async ({ logId }) => {
          const log = await this.foodLogs.findById(userId, logId);
          if (!log) return { error: 'Capture unavailable' };
          return remember('capture', { id: log.id, meal: log.meal, source: log.metadata?.source,
            text: log.text || log.metadata?.text || log.metadata?.transcription || log.metadata?.originalText,
            sourceUpc: log.metadata?.sourceUpc, nutritionLookup: log.metadata?.nutritionLookup,
            items: log.items.map(serializeFoodItem) });
        } }),
      createTool({ name: 'common_foods_and_meals', description: 'Read saved meals and matching common foods; do not assume historical portions were eaten today.',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
        execute: async ({ query = '' }) => remember('history', {
          foods: query ? await this.catalog.search(query, userId, 20) : await this.catalog.getRecent(userId, 20),
          meals: (await this.meals.list(userId)).slice(0, 20),
        }) }),
      createTool({ name: 'read_correction_precedents', description: 'Read past cleanup changes and undo decisions; do not repeat a rejected correction.',
        parameters: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 } } },
        execute: async ({ offset = 0 }) => remember('history', await this.items.listCleanupAudit(userId, { offset, limit: 20 })) }),
      createTool({ name: 'find_food_art', description: 'Search actual available icon slugs and reviewed semantic matches. Unknown matches should stay neutral.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        execute: async ({ query }) => remember('icons', { candidates: this.icons?.search(query, 30) || [],
          reviewed: this.icons?.foodNames?.()[query.toLowerCase()] ?? null }) }),
      createTool({ name: 'lookup_barcode_product', description: 'Lookup the exact barcode already attached to a capture. Returns serving-specific facts only when the captured quantity has the same verified unit.',
        parameters: { type: 'object', properties: { logId: { type: 'string' } }, required: ['logId'] },
        execute: async ({ logId }) => {
          const log = await this.foodLogs.findById(userId, logId);
          const upc = log?.metadata?.sourceUpc || log?.metadata?.upc || log?.metadata?.barcode;
          if (!upc) return { error: 'No barcode evidence on this capture' };
          const product = await this.upc.lookup(upc);
          if (!product) return { error: 'Product lookup unavailable' };
          const facts = [];
          // Legacy/uncertain lookup records are deliberately not numerical authority.
          if (log.metadata.nutritionLookup && product.nutritionLookup && !product.nutritionLookup.warnings?.length) {
            const rows = [...snapshot.rows, ...snapshot.pending.flatMap(p => p.items)];
            const captured = rows.filter(row => row.kind !== 'group' && (row.logUuid || row.log_uuid || row.logId) === log.id);
            // A barcode identifies the packaged product, not every ingredient
            // in a subsequently split capture. Only an unambiguous single food
            // can inherit its serving facts.
            for (const item of captured.length === 1 ? captured : []) {
              if (item.unit === product.serving?.unit && product.serving.size > 0 && item.amount > 0) {
                for (const [field, value] of Object.entries(product.nutrition || {})) {
                  if (CLEANUP_NUMBERS.includes(field) && Number.isFinite(value)) facts.push({
                    entryId: entryKey(item), field, value: Math.round(value * item.amount / product.serving.size * 1000) / 1000,
                  });
                }
              }
            }
          }
          return remember('product', { upc, product, fetchedAt: new Date(this.clock.now()).toISOString() }, facts);
        } }),
    ];
  }
}
