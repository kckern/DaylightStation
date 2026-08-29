/** Explicit null adapter for households without a configured School media target. */
export class UnavailableSchoolMediaDispatcher {
  selectableTargets() {
    return [];
  }

  async execute({ sessionId }) {
    return {
      status: 'unavailable',
      sessionId,
      dispatchId: null,
      target: null,
      contentId: null,
      durationSec: null,
      message: 'There is nowhere to play this right now. Tell a grown-up.',
      document: null,
    };
  }
}
