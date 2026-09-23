/**
 * Test mode's recordings sink (spec §8 Test mode): the same interface as
 * FilesystemWordLadderRecordings, but a take is counted and dropped — nothing
 * is kept in memory beyond the per-word take counter, and nothing reaches disk.
 */
export class DiscardingRecordings {
  #takes = new Map();
  save({ package: pkg, learnerId, day, wordId } = {}) {
    const key = `${pkg}|${learnerId}|${day}|${wordId}`;
    const take = (this.#takes.get(key) ?? 0) + 1;
    this.#takes.set(key, take);
    return { take };
  }
  latest() { return null; }
}
export default DiscardingRecordings;
