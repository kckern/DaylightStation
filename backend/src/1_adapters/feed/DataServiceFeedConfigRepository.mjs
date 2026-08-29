import { IFeedConfigRepository } from '#apps/feed/ports/IFeedConfigRepository.mjs';

export class DataServiceFeedConfigRepository extends IFeedConfigRepository {
  #dataService;
  constructor({ dataService }) {
    super();
    if (!dataService?.user?.read) throw new Error('DataServiceFeedConfigRepository requires dataService.user.read');
    this.#dataService = dataService;
  }
  #load(username) { return this.#dataService.user.read('config/feed', username) || {}; }
  getHeadlineConfig(username) { return this.#load(username); }
  getScrollConfig(username) { return this.#load(username).scroll || {}; }
}
export default DataServiceFeedConfigRepository;
