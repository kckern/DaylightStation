import { describe, expect, it, vi } from 'vitest';
import { FitnessUserHydrator } from "./FitnessUserHydrator.mjs";

const profileReader = {
  getProfile: (id) => ({ username: id, display_name: id.toUpperCase(), birthyear: id === 'parent' ? 1984 : 2018 }),
};

describe('FitnessUserHydrator school learner projection', () => {
  it('marks profile references and inline users from the authoritative learner directory', () => {
    const schoolLearnerDirectory = { hasLearner: (id) => id === 'kid' };
    const hydrator = new FitnessUserHydrator({ profileReader, schoolLearnerDirectory });

    const result = hydrator.hydrateConfig({
      users: {
        primary: ['kid', 'parent'],
        family: [{ id: 'other-adult', name: 'Other Adult' }],
      },
    });

    expect(result.users.primary).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'kid', schoolLearner: true }),
      expect.objectContaining({ id: 'parent', schoolLearner: false }),
    ]));
    expect(result.users.family[0]).toMatchObject({ id: 'other-adult', schoolLearner: false });
  });

  it('does not declare an adult exemption when learner membership cannot be resolved', () => {
    const logger = { warn: vi.fn() };
    const hydrator = new FitnessUserHydrator({
      profileReader,
      schoolLearnerDirectory: { hasLearner: () => { throw new Error('school config unavailable'); } },
      logger,
    });

    const [user] = hydrator.hydrateUsers(['parent']);

    expect(user.schoolLearner).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('fitness.user.school_membership_unavailable', expect.objectContaining({ userId: 'parent' }));
  });
});

it('hydrates explicit shared guest references with Fitness overlays and rejects collisions', () => {
 const hydrator=new FitnessUserHydrator({profileReader, guestResolver:(id)=>id==='visitor'?{person:{kind:'guest',id},display:{name:'Visitor',avatar:{kind:'user-avatar',userId:id}}}:null});
 const config=hydrator.hydrateConfig({users:{friends:[{person:{kind:'guest',id:'visitor'},group_label:'Friend'}]}});
 expect(config.users.friends[0]).toMatchObject({id:'visitor',name:'Visitor',group_label:'Friend',avatar:{kind:'user-avatar',userId:'visitor'}});
 expect(()=>hydrator.hydrateConfig({users:{primary:['visitor'],friends:[{person:{kind:'guest',id:'visitor'}}]}})).toThrow(/collision/i);
});
