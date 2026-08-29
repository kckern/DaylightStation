/** Pure queue policy; engine-specific scheduling belongs outside the domain. */
const date = (value, fallback) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
};

export function selectReviewCards(deck, progressByCard = {}, { now, newLimit = 20, limit = 20 } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('selectReviewCards requires a valid now');
  const due = []; const fresh = [];
  for (const card of deck?.cards || []) {
    const progress = progressByCard[card.cardId];
    if (progress?.state === 'suspended') continue;
    if (!progress || progress.state === 'new') fresh.push(card);
    else if (date(progress.dueAt, now).getTime() <= now.getTime()) due.push(card);
  }
  due.sort((a, b) => date(progressByCard[a.cardId]?.dueAt, now) - date(progressByCard[b.cardId]?.dueAt, now));
  return [...due, ...fresh.slice(0, newLimit)].slice(0, limit);
}
export default selectReviewCards;
