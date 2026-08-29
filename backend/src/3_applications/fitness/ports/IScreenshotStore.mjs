export class IScreenshotStore {
  /** Decode and persist one capture, returning its semantic storage receipt. */
  saveCapture(_request) { throw new Error('IScreenshotStore.saveCapture must be implemented'); }
}
