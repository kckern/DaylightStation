/** Persistence boundary for published language reels and learner sessions. */
export class ILanguageReelRepository {
  findReel(_reelId) { throw new Error('findReel not implemented'); }
  listReels() { throw new Error('listReels not implemented'); }
  readSession(_userId, _reelId) { throw new Error('readSession not implemented'); }
  sessionExists(_userId, _reelId) { throw new Error('sessionExists not implemented'); }
  writeSession(_userId, _reelId, _session) { throw new Error('writeSession not implemented'); }
  readDailySelections(_userId) { throw new Error('readDailySelections not implemented'); }
  writeDailySelections(_userId, _selections) { throw new Error('writeDailySelections not implemented'); }
  resolveMediaResource(_reel) { throw new Error('resolveMediaResource not implemented'); }
}

export default ILanguageReelRepository;
