import { describe, expect, it } from 'vitest';
import { UserManager } from './UserManager.js';

describe('UserManager — school learner identity', () => {
  it('preserves explicit learner membership from the configured roster', () => {
    const manager = new UserManager();
    manager.configure({
      primary: [
        { id: 'kid', name: 'Kid', schoolLearner: true },
        { id: 'parent', name: 'Parent', schoolLearner: false },
      ],
    }, []);

    expect(manager.getUser('kid')?.schoolLearner).toBe(true);
    expect(manager.getUser('parent')?.schoolLearner).toBe(false);
  });

  it('updates learner membership when roster configuration changes', () => {
    const manager = new UserManager();
    manager.registerUser({ id: 'person', name: 'Person', schoolLearner: true });
    manager.registerUser({ id: 'person', name: 'Person', schoolLearner: false });

    expect(manager.getUser('person')?.schoolLearner).toBe(false);
  });
});
