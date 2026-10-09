export class IHealthCoachWorkspaceRepository {
  getHealthProfile() { throw new Error('getHealthProfile must be implemented'); }
  getBaselines() { throw new Error('getBaselines must be implemented'); }
  saveBaselines() { throw new Error('saveBaselines must be implemented'); }
  saveDashboard() { throw new Error('saveDashboard must be implemented'); }
  getGoals() { throw new Error('getGoals must be implemented'); }
  getProgramState() { throw new Error('getProgramState must be implemented'); }
  saveProgramState() { throw new Error('saveProgramState must be implemented'); }
  listRecentFitnessProgress() { throw new Error('listRecentFitnessProgress must be implemented'); }
}

export function isHealthCoachWorkspaceRepository(value) {
  return value != null
    && typeof value.getHealthProfile === 'function'
    && typeof value.getBaselines === 'function'
    && typeof value.saveBaselines === 'function'
    && typeof value.saveDashboard === 'function'
    && typeof value.getGoals === 'function'
    && typeof value.getProgramState === 'function'
    && typeof value.saveProgramState === 'function'
    && typeof value.listRecentFitnessProgress === 'function';
}
