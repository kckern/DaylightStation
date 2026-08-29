export class IFeedCacheRepository {
  load(_username) { throw new Error('IFeedCacheRepository.load must be implemented'); }
  save(_username, _entries) { throw new Error('IFeedCacheRepository.save must be implemented'); }
}
