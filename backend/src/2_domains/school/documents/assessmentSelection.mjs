import { DomainInvariantError } from '#domains/core/errors/index.mjs';
/** Shared render/scan selection; ids refer to the pinned form's stable questions. */
export function selectAssessmentQuestions(document, itemIds = null) {
  if (itemIds == null) return document;
  if (!Array.isArray(itemIds) || !itemIds.length || new Set(itemIds).size !== itemIds.length) throw new DomainInvariantError('assessment selection must contain unique question ids');
  const wanted = new Set(itemIds);
  const found = new Set();
  const select = (blocks) => blocks.flatMap((block) => {
    if (block.type === 'question') {
      if (!wanted.has(block.itemId)) return [];
      found.add(block.itemId);
      return [block];
    }
    if (Array.isArray(block.blocks)) return [{ ...block, blocks: select(block.blocks) }];
    return [block];
  });
  const selected = { ...document, blocks: select(document.blocks) };
  const missing = itemIds.filter((id) => !found.has(id));
  if (missing.length) throw new DomainInvariantError(`assessment form has no question: ${missing.join(', ')}`);
  return selected;
}
