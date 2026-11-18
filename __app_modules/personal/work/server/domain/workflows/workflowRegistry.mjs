const local = Object.freeze(['keep_active', 'snooze', 'retire']);
const rows = {
  housekeeping: {
    allowedActions: local,
    nextState: {
      keep_active: 'active',
      snooze: 'paused',
      retire: 'retired'
    }
  },
  reactivate: {
    allowedActions: local,
    nextState: {
      keep_active: 'active',
      snooze: 'paused',
      retire: 'retired'
    }
  },
  wrap_up: {
    allowedActions: local,
    nextState: {
      keep_active: 'active',
      snooze: 'paused',
      retire: 'retired'
    }
  },
  reconcile: {
    allowedActions: Object.freeze(['refresh', ...local]),
    nextState: {}
  },
  coverage_repair: {
    allowedActions: Object.freeze(['refresh', 'later', 'dismiss']),
    nextState: {}
  },
  create_link: {
    allowedActions: Object.freeze(['review_link', 'later', 'dismiss']),
    nextState: {}
  },
  knowledge_review: {
    allowedActions: Object.freeze(['review', 'later', 'dismiss']),
    nextState: {}
  }
};
for (const row of Object.values(rows)) {
  Object.freeze(row.nextState);
  Object.freeze(row);
}
Object.freeze(rows);
export const WORKFLOW_TYPES = Object.freeze(Object.keys(rows));
export const workflowRegistry = Object.freeze({
  get: type => rows[type] ?? null
});
