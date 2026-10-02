/**
 * Scoring for the JSON-vs-TOON food-logging A/B. Models are not deterministic,
 * so TOON is judged against the JSON path's OWN run-to-run spread per text.
 */
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// All most-frequent values: on a tie, any tied value counts as matching.
const modalSet = (xs) => {
  const counts = new Map();
  for (const v of xs) counts.set(v, (counts.get(v) || 0) + 1);
  const top = Math.max(...counts.values());
  return new Set([...counts].filter(([, n]) => n === top).map(([v]) => v));
};

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

  const reasons = [];
  const texts = [...new Set(results.map((r) => r.text))];
  if (texts.length === 0) {
    reasons.push('no texts measured');
    return { perPath, verdict: { pass: false, reasons } };
  }

  const failed = results.filter((r) => r.error || r.success !== true).length;
  if (failed > 0) reasons.push(`${failed} of ${results.length} runs failed (errored or success !== true)`);

  let compared = 0;
  let missing = 0;
  let countOk = 0;
  let kcalOk = 0;
  let emptyBaseline = 0;
  for (const text of texts) {
    const json = results.filter((r) => r.text === text && r.path === 'json');
    const toon = results.filter((r) => r.text === text && r.path === 'toon');
    if (!json.length || !toon.length) { missing += 1; continue; }
    if (json.every((r) => !r.itemCount)) emptyBaseline += 1;
    compared += 1;
    const modal = modalSet(json.map((r) => r.itemCount));
    if (toon.every((r) => modal.has(r.itemCount))) countOk += 1;
    const lo = Math.min(...json.map((r) => r.kcal)) * 0.85;
    const hi = Math.max(...json.map((r) => r.kcal)) * 1.15;
    if (toon.every((r) => r.kcal >= lo && r.kcal <= hi)) kcalOk += 1;
  }

  if (missing > 0) reasons.push(`${missing} texts missing a JSON or TOON run`);
  if (emptyBaseline > 0) reasons.push(`JSON baseline produced 0 items in every run for ${emptyBaseline} texts`);
  const toonRuns = perPath.toon.runs || 1;
  if (perPath.toon.fallbacks / toonRuns > 0.05) reasons.push(`fallback rate ${perPath.toon.fallbacks}/${toonRuns} exceeds 5%`);
  if (compared === 0) {
    reasons.push('no text had both a JSON and a TOON run');
  } else {
    if (countOk / compared < 0.9) reasons.push(`item count matched JSON's modal count for only ${countOk}/${compared} texts`);
    if (kcalOk / compared < 0.9) reasons.push(`kcal inside JSON spread ±15% for only ${kcalOk}/${compared} texts`);
  }
  return { perPath, verdict: { pass: reasons.length === 0, reasons } };
}
