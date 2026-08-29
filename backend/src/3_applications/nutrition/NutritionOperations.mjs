export class NutritionOperations {
  constructor({ foodLogs, logIndex, today }) {
    this.foodLogs = foodLogs;
    this.logIndex = logIndex;
    this.today = today;
  }
  listDates(userId) { return this.logIndex.listDates(userId); }
  currentDate() { return this.today(); }
  readLog(userId, date) { return this.foodLogs.getLog(userId, date); }
  logFood(userId, date, entry) { return this.foodLogs.logFood(userId, date, entry); }
  removeEntry(userId, date, index) { return this.foodLogs.removeEntry(userId, date, index); }
  dailySummary(userId, date) { return this.foodLogs.getDailySummary(userId, date); }
  weeklySummary(userId, weekStart) { return this.foodLogs.getWeeklySummary(userId, weekStart); }
  readRange(userId, startDate, endDate) { return this.foodLogs.getLogsInRange(userId, startDate, endDate); }
}
