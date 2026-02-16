// backend/src/1_adapters/feed/sources/TodoistFeedAdapter.mjs
/**
 * TodoistFeedAdapter
 *
 * Reads Todoist task data from UserDataService and normalizes to FeedItem shape.
 *
 * @module adapters/feed/sources/TodoistFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class TodoistFeedAdapter extends IFeedSourceAdapter {
  #userDataService;
  #logger;

  constructor({ userDataService, logger = console }) {
    super();
    if (!userDataService) throw new Error('TodoistFeedAdapter requires userDataService');
    this.#userDataService = userDataService;
    this.#logger = logger;
  }

  get sourceType() { return 'tasks'; }

  async fetchItems(query, username) {
    try {
      const data = this.#userDataService.getLifelogData(username, 'tasks');
      if (!data) return [];

      let tasks = Array.isArray(data) ? data : [];
      tasks = tasks.filter(t => !t.isCompleted);

      if (query.params?.filter === 'overdue_or_due_today') {
        const today = new Date().toISOString().split('T')[0];
        tasks = tasks.filter(t => {
          if (!t.due?.date) return true;
          return t.due.date <= today;
        });
      }

      tasks.sort((a, b) => (b.priority || 1) - (a.priority || 1));

      return tasks.slice(0, 5).map(task => ({
        id: `todoist:${task.id}`,
        type: query.feed_type || 'grounding',
        source: 'tasks',
        title: task.content || 'Task',
        body: task.description || null,
        image: null,
        link: task.url || null,
        timestamp: task.due?.date || task.createdAt || new Date().toISOString(),
        priority: query.priority || 25,
        meta: {
          projectId: task.projectId,
          isOverdue: task.due?.date ? new Date(task.due.date) < new Date() : false,
          taskPriority: task.priority,
          labels: task.labels,
          sourceName: 'Todoist',
          sourceIcon: null,
        },
      }));
    } catch (err) {
      this.#logger.warn?.('todoist.adapter.error', { error: err.message });
      return [];
    }
  }
}
