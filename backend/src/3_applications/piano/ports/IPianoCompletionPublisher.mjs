/** Publishes completed Piano milestones to interested application workflows. */
export class IPianoCompletionPublisher {
  publishSchoolChallengeCompleted(_event) {
    throw new Error('publishSchoolChallengeCompleted must be implemented');
  }
}

export default IPianoCompletionPublisher;
