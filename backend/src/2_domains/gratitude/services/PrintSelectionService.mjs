/**
 * Weighted print selection for gratitude items.
 *
 * Items bucketed by age (0-7d, 7-14d, 14-30d, 30+d) with weights (50, 20, 15, 15).
 * Within each bucket, items with lowest printCount are prioritized.
 *
 * @module 2_domains/gratitude/services/PrintSelectionService
 */

/**
 * Select items for print using weighted bucket selection based on age.
 * Items are bucketed by days old (0-7, 7-14, 14-30, 30+) with weights (50, 20, 15, 15).
 * Within each bucket, items with lowest printCount are prioritized.
 *
 * @param {Array} items - Items to select from, each with datetime and printCount properties
 * @param {number} count - Number of items to select
 * @returns {Array} Selected items
 */
export function selectItemsForPrint(items, count) {
  if (!items || items.length === 0) return [];
  if (items.length <= count) return [...items];

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const bucketDefs = [
    { maxDays: 7, weight: 50 },
    { maxDays: 14, weight: 20 },
    { maxDays: 30, weight: 15 },
    { maxDays: Infinity, weight: 15 }
  ];

  const buckets = bucketDefs.map(() => []);

  for (const item of items) {
    const itemDate = new Date(item.datetime).getTime();
    const ageMs = now - itemDate;
    const ageDays = ageMs / DAY_MS;

    let prevMax = 0;
    for (let i = 0; i < bucketDefs.length; i++) {
      if (ageDays >= prevMax && ageDays < bucketDefs[i].maxDays) {
        buckets[i].push(item);
        break;
      }
      prevMax = bucketDefs[i].maxDays;
    }
  }

  for (const bucket of buckets) {
    bucket.sort((a, b) => a.printCount - b.printCount);
  }

  function pickFromBucket(bucket) {
    if (bucket.length === 0) return null;
    const minPrintCount = bucket[0].printCount;
    const candidates = bucket.filter(i => i.printCount === minPrintCount);
    const idx = Math.floor(Math.random() * candidates.length);
    const picked = candidates[idx];
    const bucketIdx = bucket.findIndex(i => i.id === picked.id);
    if (bucketIdx !== -1) bucket.splice(bucketIdx, 1);
    return picked;
  }

  function getAvailableBuckets() {
    const available = [];
    const pendingWeights = [];

    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length > 0) {
        const totalWeight = bucketDefs[i].weight + pendingWeights.reduce((a, b) => a + b, 0);
        available.push({ bucketIndex: i, weight: totalWeight });
        pendingWeights.length = 0;
      } else {
        pendingWeights.push(bucketDefs[i].weight);
      }
    }

    if (pendingWeights.length > 0 && available.length > 0) {
      available[available.length - 1].weight += pendingWeights.reduce((a, b) => a + b, 0);
    }

    return available;
  }

  function selectBucketByWeight() {
    const available = getAvailableBuckets();
    if (available.length === 0) return -1;

    const totalWeight = available.reduce((sum, b) => sum + b.weight, 0);
    let random = Math.random() * totalWeight;

    for (const { bucketIndex, weight } of available) {
      random -= weight;
      if (random <= 0) return bucketIndex;
    }

    return available[available.length - 1].bucketIndex;
  }

  const selected = [];

  while (selected.length < count) {
    const bucketIndex = selectBucketByWeight();
    if (bucketIndex === -1) break;

    const picked = pickFromBucket(buckets[bucketIndex]);
    if (picked) {
      selected.push(picked);
    }
  }

  return selected;
}
