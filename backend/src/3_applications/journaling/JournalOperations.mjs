export class JournalOperations {
  constructor({ journal, entries }) { this.journal = journal; this.entries = entries; }
  listDates(userId) { return this.entries.listDates(userId); }
  listTags(userId) { return this.entries.getAllTags(userId); }
  readByDate(userId, date) { return this.journal.getEntryByDate(userId, date); }
  create(input, timestamp) { return this.journal.createEntry(input, timestamp); }
  update(id, changes, timestamp) { return this.journal.updateEntry(id, changes, timestamp); }
  delete(id) { return this.journal.deleteEntry(id); }
  readRange(userId, startDate, endDate) { return this.journal.getEntriesInRange(userId, startDate, endDate); }
  readByTag(userId, tag) { return this.journal.getEntriesByTag(userId, tag); }
  moodSummary(userId, startDate, endDate) { return this.journal.getMoodSummary(userId, startDate, endDate); }
}
