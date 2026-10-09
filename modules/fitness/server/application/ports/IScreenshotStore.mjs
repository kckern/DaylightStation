export class IScreenshotStore {
  /** Decode and persist one capture, returning its semantic storage receipt. */
  saveCapture(_request) { throw new Error('IScreenshotStore.saveCapture must be implemented'); }
  /** Persist one whole-screen kiosk capture (not tied to a session), returning its receipt. */
  saveKioskCapture(_request) { throw new Error('IScreenshotStore.saveKioskCapture must be implemented'); }
}
