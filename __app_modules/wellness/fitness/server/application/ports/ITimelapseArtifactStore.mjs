/**
 * Owns the disposable frame workspace and durable MP4 artifacts produced by a
 * fitness recap. Workspace and artifact values are opaque handles; callers do
 * not receive storage locations.
 */
export class ITimelapseArtifactStore {
  async createWorkspace(_sessionId) {
    throw new Error('ITimelapseArtifactStore.createWorkspace must be implemented');
  }

  async writeFrame(_workspace, _frame) {
    throw new Error('ITimelapseArtifactStore.writeFrame must be implemented');
  }

  async encode(_workspace, _request) {
    throw new Error('ITimelapseArtifactStore.encode must be implemented');
  }

  async publishPlexCopy(_artifact, _request) {
    throw new Error('ITimelapseArtifactStore.publishPlexCopy must be implemented');
  }

  async discardWorkspace(_workspace) {
    throw new Error('ITimelapseArtifactStore.discardWorkspace must be implemented');
  }
}
