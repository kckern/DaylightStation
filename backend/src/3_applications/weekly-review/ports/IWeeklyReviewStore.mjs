/** Persistence boundary for weekly-review recordings, transcripts, and drafts. */
export class IWeeklyReviewStore {
  saveRecordingAudio(_recording) { throw new Error('saveRecordingAudio not implemented'); }
  convertRecordingToMp3(_recordingArtifact, _runCommand) { throw new Error('convertRecordingToMp3 not implemented'); }
  saveTranscript(_week, _transcript, _manifest) { throw new Error('saveTranscript not implemented'); }
  appendDraftChunk(_chunk) { throw new Error('appendDraftChunk not implemented'); }
  listDrafts(_week) { throw new Error('listDrafts not implemented'); }
  beginFinalization(_sessionId, _week) { throw new Error('beginFinalization not implemented'); }
  completeFinalization(_token) { throw new Error('completeFinalization not implemented'); }
  sweepStaleDrafts(_cutoff) { throw new Error('sweepStaleDrafts not implemented'); }
  discardDraft(_sessionId, _week) { throw new Error('discardDraft not implemented'); }
  getRecordingStatus(_week) { throw new Error('getRecordingStatus not implemented'); }
}

export default IWeeklyReviewStore;
