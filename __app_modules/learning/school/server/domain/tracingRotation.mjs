/** Per-learner semantic rotation, independent of worksheet titles and page ids. */
import { countsAsIssuedActivity } from './printedActivity.mjs';
export function remainingTracingCharacters({ characters, history }) {
  const allowed = new Set(characters);
  const seen = new Set();
  const rows = history.filter(countsAsIssuedActivity)
    .sort((a,b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt));
  for (const row of rows) {
    const character = String(row.character ?? '').toUpperCase();
    if (!/^[A-Z0-9]$/.test(character)) throw new Error('Tracing history has no verified character');
    if (!allowed.has(character)) continue;
    if (seen.size === allowed.size) seen.clear();
    seen.add(character);
  }
  return seen.size === allowed.size ? characters : [...characters].filter(c => !seen.has(c)).join('');
}
