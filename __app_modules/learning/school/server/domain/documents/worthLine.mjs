/**
 * The worksheet header's price line ("Worth 2 silver · 1 gem · +5 silver if it
 * finishes your day"), or null when there is nothing to print.
 *
 * `price` is the economy's `ifDone` quote: `{silver, gems, dayBonus:{silver,gems}}`.
 * The day bonus never prints on its own — a sheet whose own price is zero
 * prints no worth line at all.
 */
export function worthLine(price) {
  if (!price) return null;
  const silver = price.silver ?? 0;
  const gems = price.gems ?? 0;
  if (silver <= 0 && gems <= 0) return null;
  const gemText = `${gems} ${gems === 1 ? 'gem' : 'gems'}`;
  const parts = silver > 0 ? [`Worth ${silver} silver`] : [`Worth ${gemText}`];
  if (silver > 0 && gems > 0) parts.push(gemText);
  const bonus = price.dayBonus?.silver ?? 0;
  if (bonus > 0) parts.push(`+${bonus} silver if it finishes your day`);
  return parts.join(' · ');
}
