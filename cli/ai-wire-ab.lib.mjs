/**
 * Scoring for the JSON-vs-TOON food-logging A/B. Models are not deterministic,
 * so TOON is judged against the JSON path's OWN run-to-run spread per text.
 */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const mode = (xs) => [...xs].sort((a, b) => xs.filter((v) => v === b).length - xs.filter((v) => v === a).length)[0];

export function summarize(results) {
  const perPath = {};
  for (const path of ['json', 'toon']) {
    const rows = results.filter((r) => r.path === path);
    perPath[path] = {
      runs: rows.length,
      meanMs: mean(rows.map((r) => r.ms)),
      meanReplyChars: mean(rows.map((r) => r.replyChars)),
      fallbacks: rows.filter((r) => r.fallback).length,
    };
  }

  const texts = [...new Set(results.map((r) => r.text))];
  let countOk = 0;
  let kcalOk = 0;
  for (const text of texts) {
    const json = results.filter((r) => r.text === text && r.path === 'json');
    const toon = results.filter((r) => r.text === text && r.path === 'toon');
    if (!json.length || !toon.length) continue;
    const modal = mode(json.map((r) => r.itemCount));
    if (toon.every((r) => r.itemCount === modal)) countOk += 1;
    const lo = Math.min(...json.map((r) => r.kcal)) * 0.85;
    const hi = Math.max(...json.map((r) => r.kcal)) * 1.15;
    if (toon.every((r) => r.kcal >= lo && r.kcal <= hi)) kcalOk += 1;
  }

  const reasons = [];
  const toonRuns = perPath.toon.runs || 1;
  if (perPath.toon.fallbacks / toonRuns > 0.05) reasons.push(`fallback rate ${perPath.toon.fallbacks}/${toonRuns} exceeds 5%`);
  if (countOk / texts.length < 0.9) reasons.push(`item count matched JSON's modal count for only ${countOk}/${texts.length} texts`);
  if (kcalOk / texts.length < 0.9) reasons.push(`kcal inside JSON spread ±15% for only ${kcalOk}/${texts.length} texts`);
  return { perPath, verdict: { pass: reasons.length === 0, reasons } };
}
