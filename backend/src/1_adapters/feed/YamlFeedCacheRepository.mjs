import { IFeedCacheRepository } from '#apps/feed/ports/IFeedCacheRepository.mjs';

const CACHE_ADDRESS = 'current/feed/_cache';

export class YamlFeedCacheRepository extends IFeedCacheRepository {
  #users;
  constructor({ dataService }) {
    super();
    if (!dataService?.user) throw new Error('YamlFeedCacheRepository requires dataService');
    this.#users = dataService.user;
  }
  load(username) { return this.#users.read(CACHE_ADDRESS, username); }
  save(username, entries) { return this.#users.write(CACHE_ADDRESS, entries, username); }
}

export default YamlFeedCacheRepository;
