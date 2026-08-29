export class DataServiceJournalistInteractionLogStore {
  constructor({ dataService }) {
    if (!dataService?.user?.write) throw new Error('DataServiceJournalistInteractionLogStore requires dataService');
    this.dataService = dataService;
  }
  save(username, record) {
    return this.dataService.user.write('lifelog/journalist/last_gpt.yml', record, username);
  }
}
