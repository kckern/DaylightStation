export class ICameraArchiveArtifacts {
  async beginDay(_cameraId, _day) { throw new Error('ICameraArchiveArtifacts.beginDay must be implemented'); }
  segment(_day, _index) { throw new Error('ICameraArchiveArtifacts.segment must be implemented'); }
  sheetCollection(_day) { throw new Error('ICameraArchiveArtifacts.sheetCollection must be implemented'); }
  sessionClip(_day, _request) { throw new Error('ICameraArchiveArtifacts.sessionClip must be implemented'); }
  audioSidecar(_day, _request) { throw new Error('ICameraArchiveArtifacts.audioSidecar must be implemented'); }
  timelapse(_day, _phase) { throw new Error('ICameraArchiveArtifacts.timelapse must be implemented'); }
  concatManifest(_day, _index) { throw new Error('ICameraArchiveArtifacts.concatManifest must be implemented'); }
  async discard(_day) { throw new Error('ICameraArchiveArtifacts.discard must be implemented'); }
}
