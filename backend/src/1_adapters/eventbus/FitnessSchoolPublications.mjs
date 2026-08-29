export const FITNESS_SCHOOL_ASSESSED_TOPIC = 'fitness.school-attempt.assessed';
export const FITNESS_SCHOOL_ACCEPTED_TOPIC = 'fitness.school-attempt.accepted';

export class FitnessSchoolPublications {
  constructor({ eventBus }) { this.eventBus = eventBus; }
  accepted(payload) { return this.eventBus?.publish?.(FITNESS_SCHOOL_ACCEPTED_TOPIC, payload); }
  assessed(payload) { return this.eventBus?.publish?.(FITNESS_SCHOOL_ASSESSED_TOPIC, payload); }
}

export default FitnessSchoolPublications;
