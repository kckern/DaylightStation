/**
 * Extracts productivity metrics from Todoist lifelog data.
 */
export class TodoistMetricAdapter {
  #userLoadFile;

  constructor({ userLoadFile }) {
    this.#userLoadFile = userLoadFile;
  }

  getMetricValue(username, measure, date) {
    const data = this.#userLoadFile?.(username, 'todoist');
    if (!data) return null;

    const tasks = Array.isArray(data)
      ? data.filter(t => t.completed_date === date || t.date === date)
      : (data[date] || []);

    if (!Array.isArray(tasks)) return null;

    switch (measure) {
      case 'tasks_completed': return tasks.filter(t => t.completed || t.checked).length;
      case 'tasks_created': return tasks.filter(t => t.created_date === date).length;
      case 'high_priority_completed': return tasks.filter(t =>
        (t.completed || t.checked) && (t.priority >= 3 || t.priority === 'high')
      ).length;
      default: return null;
    }
  }
}
