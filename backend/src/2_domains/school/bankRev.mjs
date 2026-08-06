import crypto from 'node:crypto';

/**
 * bankContentRev — a stable content hash of what a bank actually ASKS.
 *
 * The print path pins a content-hashed `rev` on every published document and
 * refuses drift; the screen path recorded nothing (admin advocacy A3), so an
 * answer-key fix in October silently rewrote what every September attempt
 * appeared to answer. This is the screen path's rev: a hash over the graded
 * SUBSTANCE of each item (id, type, prompt, answer material) in item order.
 * Presentation-only fields (title, topics, audience) are deliberately outside
 * the hash — reshelving a bank is not a content change.
 *
 * Pure: no IO, no clock. Canonical JSON via sorted keys so property order
 * never changes the hash.
 */
export function bankContentRev(bank) {
  if (!bank || !Array.isArray(bank.items)) return null;
  const substance = bank.items.map((item) => ({
    id: item.id ?? null,
    type: item.type ?? null,
    prompt: item.prompt ?? null,
    answer: item.answer ?? null,
    choices: item.choices ?? null,
    pairs: item.pairs ?? null,
    accept: item.accept ?? null,
    regions: item.regions ?? null,
    asset: item.asset ?? null,
  }));
  const canonical = JSON.stringify(substance, (key, value) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]))
      : value
  ));
  return crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 12);
}

export default bankContentRev;
