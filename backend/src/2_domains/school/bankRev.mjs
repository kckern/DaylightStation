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
 * Pure: no IO, no clock, no node imports (the domain purity gate forbids
 * node:crypto here) — FNV-1a 64-bit over the canonical JSON is plenty for
 * distinguishing revisions of one bank over time; this is a drift marker,
 * not a security digest.
 */
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

function fnv1a64(text) {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}
export function bankContentRev(bank) {
  if (!bank || !Array.isArray(bank.items)) return null;
  const isV2 = bank.schema === 'school.question-bank/v2';
  const substance = bank.items.map((item) => ({
    id: item.id ?? null,
    type: item.type ?? null,
    prompt: item.prompt ?? null,
    prompt_by_profile: item.prompt_by_profile ?? null,
    prompt_prefix_by_profile: item.prompt_prefix_by_profile ?? null,
    prompt_suffix_by_profile: item.prompt_suffix_by_profile ?? null,
    answer: item.answer ?? null,
    choices: item.choices ?? null,
    ...(isV2 ? { answers: item.answers ?? null, decoys: item.decoys ?? null } : {}),
    pairs: item.pairs ?? null,
    accept: item.accept ?? null,
    regions: item.regions ?? null,
    asset: item.asset ?? null,
    stimulus: item.stimulus ?? null,
    ...(item.schoolcalc !== undefined ? { schoolcalc: item.schoolcalc } : {}),
  }));
  const canonical = JSON.stringify(substance, (key, value) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]))
      : value
  ));
  return fnv1a64(canonical).slice(0, 12);
}

export default bankContentRev;
