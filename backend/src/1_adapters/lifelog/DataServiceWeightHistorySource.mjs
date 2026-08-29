import { IWeightHistorySource } from '#apps/lifelog/ports/IWeightHistorySource.mjs';

export class DataServiceWeightHistorySource extends IWeightHistorySource {
  constructor({ dataService }) {
    super();
    if (!dataService?.user?.read) throw new Error('DataServiceWeightHistorySource requires dataService');
    this.dataService = dataService;
  }
  read(username) { return this.dataService.user.read('lifelog/weight', username); }
}
