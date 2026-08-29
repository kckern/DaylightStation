/** Semantic read/delete facade for the household workout shelf. */
export class WorkoutCatalogService {
  constructor({ workoutRepository }) { this.workoutRepository = workoutRepository; }
  list(householdId) { return this.workoutRepository.list(householdId); }
  get(workoutId, householdId) { return this.workoutRepository.get(workoutId, householdId); }
  delete(workoutId, householdId) { return this.workoutRepository.delete(workoutId, householdId); }
}
export default WorkoutCatalogService;
